/**
 * Host half of the OpenCode Go quota indicator.
 *
 * Resolves the configured credential reference through the DSH credential seam,
 * asks the gateway usage endpoint for the rolling / weekly / monthly windows,
 * keeps a short in-process cache, and exposes the result to the browser half
 * over `GET /api/opencode-go-quota/usage`.
 *
 * The API key is only ever placed in the upstream `Authorization` header. It is
 * never logged, echoed in a response body, or stored as a readable cache key:
 * cache identity uses a one-way digest so a rotated key invalidates the entry
 * without keeping a second plaintext copy.
 */

import { createHash } from 'node:crypto'

export const name = 'opencode-go-quota'
export const inject = ['webServer', 'credentials']

const ROUTE = '/api/opencode-go-quota'
const USAGE_PATH = '/usage'

const DEFAULT_API_KEY_ENV = 'OPENCODE_GO_API_KEY'
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1'
const DEFAULT_PROVIDERS = ['opencode-go', 'dsh-opencode-go']
const DEFAULT_LABEL = 'OpenCode Go'
const DEFAULT_POLL_MS = 60_000
const DEFAULT_CACHE_MS = 20_000
const DEFAULT_TIMEOUT_MS = 10_000

const MIN_POLL_MS = 1_000
const MAX_POLL_MS = 3_600_000
const MIN_CACHE_MS = 0
const MAX_CACHE_MS = 86_400_000
const MIN_TIMEOUT_MS = 1
const MAX_TIMEOUT_MS = 120_000

const WINDOWS = ['rolling', 'weekly', 'monthly']
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const CACHE_MAX_ENTRIES = 8
const DETAIL_MAX_CHARS = 160
/** Hard cap for the upstream body kept in memory (the quota document is tiny). */
const MAX_UPSTREAM_BYTES = 1024 * 1024

const ERROR_MISSING_CREDENTIAL = 'opencode-go-quota/missing-credential'
const ERROR_USAGE_UNAVAILABLE = 'opencode-go-quota/usage-unavailable'
const ERROR_INVALID_RESPONSE = 'opencode-go-quota/invalid-response'
const ERROR_NOT_FOUND = 'not-found'
const ERROR_METHOD_NOT_ALLOWED = 'method-not-allowed'

/** A classified failure that maps onto one SPEC error code / retryable pair. */
class QuotaFailure extends Error {
  /**
   * @param {string} code - SPEC error code written into the response body.
   * @param {string} message - human-readable, already sanitized message.
   * @param {boolean} retryable - whether the browser should poll again.
   */
  constructor(code, message, retryable) {
    super(message)
    this.name = 'QuotaFailure'
    this.code = code
    this.retryable = retryable === true
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failureOf(error) {
  return error instanceof QuotaFailure
    ? error
    : new QuotaFailure(ERROR_USAGE_UNAVAILABLE, '额度查询失败，请稍后重试。', true)
}

function sendJson(res, status, value) {
  if (res.writableEnded || res.headersSent === true) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Drop `Bearer …` material, the current key, and any long token-like run. */
function sanitizeDetail(text, key) {
  if (typeof text !== 'string' || text.length === 0) return ''
  let detail = text.replace(/\s+/gu, ' ').trim()
  if (typeof key === 'string' && key.length > 0) detail = detail.split(key).join('***')
  detail = detail.replace(/Bearer\s+\S+/giu, 'Bearer ***')
  detail = detail.replace(/[A-Za-z0-9._~+/=-]{32,}/gu, '***')
  if (detail.length > DETAIL_MAX_CHARS) detail = `${detail.slice(0, DETAIL_MAX_CHARS)}…`
  return detail
}

function positiveIntegerInRange(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

/** Validate `apiKeyEnv`; anything outside the credential-ref grammar falls back. */
function normalizeApiKeyEnv(value) {
  if (typeof value !== 'string') return DEFAULT_API_KEY_ENV
  const trimmed = value.trim()
  return REF_PATTERN.test(trimmed) ? trimmed : DEFAULT_API_KEY_ENV
}

/** Validate `baseURL` into a credential-safe `scheme://host/base` string. */
function normalizeBaseURL(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return DEFAULT_BASE_URL
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return DEFAULT_BASE_URL
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_BASE_URL
  if (url.username.length > 0 || url.password.length > 0) return DEFAULT_BASE_URL
  if (url.search.length > 0 || url.hash.length > 0) return DEFAULT_BASE_URL
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

/** Validate `providers` into a non-empty list of unique non-empty strings. */
function normalizeProviders(value) {
  if (!Array.isArray(value)) return [...DEFAULT_PROVIDERS]
  const providers = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id.length === 0 || id.length > 120 || providers.includes(id)) continue
    providers.push(id)
  }
  return providers.length > 0 ? providers : [...DEFAULT_PROVIDERS]
}

/**
 * Read the credential service from either the injected service property or the
 * context lookup, so a partially composed test context still works.
 * @param {object} ctx - plugin context carrying the credentials seam.
 * @returns {object | undefined} the credential service, when present.
 */
function credentialsOf(ctx) {
  if (ctx === null || ctx === undefined) return undefined
  const direct = ctx.credentials
  if (direct !== undefined && direct !== null) return direct
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get('credentials') ?? undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Register the quota route. No network request happens here: the upstream call
 * is triggered by the first browser request.
 * @param {object} ctx - plugin context with `webServer` and `credentials`.
 * @param {object} [config] - plugin configuration from the composition.
 */
export function apply(ctx, config = {}) {
  const settings = {
    apiKeyEnv: normalizeApiKeyEnv(config.apiKeyEnv),
    baseURL: normalizeBaseURL(config.baseURL),
    providers: normalizeProviders(config.providers),
    pollMs: positiveIntegerInRange(config.pollMs, MIN_POLL_MS, MAX_POLL_MS, DEFAULT_POLL_MS),
    cacheMs: positiveIntegerInRange(config.cacheMs, MIN_CACHE_MS, MAX_CACHE_MS, DEFAULT_CACHE_MS),
    timeoutMs: positiveIntegerInRange(config.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }
  const usageURL = `${settings.baseURL}${USAGE_PATH}`

  /** @type {Map<string, { usage: object, fetchedAt: number }>} */
  const cache = new Map()
  /** @type {Set<AbortController>} */
  const activeRequests = new Set()
  /** @type {Promise<Function | null> | undefined} */
  let credentialRefBuilder

  function publicConfig() {
    return {
      providers: [...settings.providers],
      pollMs: settings.pollMs,
      label: DEFAULT_LABEL,
    }
  }

  function successBody(entry) {
    return {
      ok: true,
      usage: entry.usage,
      fetchedAt: entry.fetchedAt,
      config: publicConfig(),
    }
  }

  function failureBody(failure) {
    return {
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
      config: publicConfig(),
    }
  }

  function errorBody(failure) {
    return {
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
    }
  }

  /** The one-way cache identity; the plaintext key never enters the cache. */
  function cacheKeyOf(key) {
    const digest = createHash('sha256').update(key).digest('hex')
    return `${settings.apiKeyEnv}\u0000${settings.baseURL}\u0000${digest}`
  }

  async function brandRef() {
    if (credentialRefBuilder === undefined) {
      credentialRefBuilder = import('@deepseek-ai/dsh-credentials')
        .then((module) => (typeof module?.credentialRef === 'function' ? module.credentialRef : null))
        .catch(() => null)
    }
    const build = await credentialRefBuilder
    if (build === null) return settings.apiKeyEnv
    try {
      return build(settings.apiKeyEnv)
    } catch {
      return settings.apiKeyEnv
    }
  }

  /**
   * Resolve the live API key for this request. A rotated value is picked up on
   * the next call because nothing is cached across operations.
   * @returns {Promise<string>} the non-empty key value.
   * @throws {QuotaFailure} `missing-credential` when no usable value exists.
   */
  async function resolveApiKey() {
    const credentials = credentialsOf(ctx)
    if (credentials === undefined || typeof credentials.resolve !== 'function') {
      throw new QuotaFailure(
        ERROR_MISSING_CREDENTIAL,
        `凭据服务不可用，无法读取 ${settings.apiKeyEnv}。`,
        false,
      )
    }
    const ref = await brandRef()
    let hit
    try {
      hit = await credentials.resolve(ref)
    } catch {
      throw new QuotaFailure(
        ERROR_MISSING_CREDENTIAL,
        `读取凭据 ${settings.apiKeyEnv} 失败；请在 DSH 凭据设置中检查该 API key。`,
        false,
      )
    }
    const value = typeof hit?.value === 'string' ? hit.value.trim() : ''
    if (value.length === 0) {
      throw new QuotaFailure(
        ERROR_MISSING_CREDENTIAL,
        `未配置凭据 ${settings.apiKeyEnv}；请先在 DSH 凭据设置中保存 OpenCode Go 的 API key。`,
        false,
      )
    }
    return value
  }

  function timeoutFailure() {
    return new QuotaFailure(ERROR_USAGE_UNAVAILABLE, `请求上游额度接口超时（${settings.timeoutMs}ms）。`, true)
  }

  async function readBodyText(response, controller) {
    try {
      const declared = Number(response.headers?.get?.('content-length'))
      if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, '上游额度响应体过大。', true)
      }
      const text = await response.text()
      if (text.length > MAX_UPSTREAM_BYTES) {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, '上游额度响应体过大。', true)
      }
      return text
    } catch (error) {
      if (error instanceof QuotaFailure) throw error
      if (controller.signal.aborted) {
        throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, '额度查询已取消。', true)
      }
      throw isTimeoutError(error)
        ? timeoutFailure()
        : new QuotaFailure(ERROR_USAGE_UNAVAILABLE, '读取上游额度响应失败。', true)
    }
  }

  /** Validate the three windows per SPEC; the objects are passed through intact. */
  function validateUsage(payload) {
    if (!isRecord(payload) || !isRecord(payload.usage)) {
      throw new QuotaFailure(ERROR_INVALID_RESPONSE, '上游额度响应缺少 usage 对象。', true)
    }
    const usage = payload.usage
    const validated = {}
    for (const window of WINDOWS) {
      const entry = usage[window]
      if (!isRecord(entry)) {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, `上游额度响应缺少 ${window} 窗口。`, true)
      }
      if (typeof entry.percent !== 'number' || !Number.isFinite(entry.percent) || entry.percent < 0 || entry.percent > 100) {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, `上游额度响应中 ${window}.percent 不合法。`, true)
      }
      if (typeof entry.status !== 'string') {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, `上游额度响应中 ${window}.status 不合法。`, true)
      }
      if (typeof entry.resetsAt !== 'string' || Number.isNaN(Date.parse(entry.resetsAt))) {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, `上游额度响应中 ${window}.resetsAt 不合法。`, true)
      }
      validated[window] = entry
    }
    return validated
  }

  /** Classify one upstream response into SPEC error codes. Never echoes the key. */
  async function classifyUpstreamError(response, key, controller) {
    const status = Number(response.status) || 0
    const raw = await readBodyText(response, controller)
    const detail = sanitizeDetail(raw, key)
    const suffix = detail.length > 0 ? `：${detail}` : ''
    if (status === 401 || status === 403) {
      throw new QuotaFailure(
        ERROR_USAGE_UNAVAILABLE,
        `上游拒绝了凭据（HTTP ${status}），请检查 ${settings.apiKeyEnv} 是否有效以及是否具备 OpenCode Go 订阅权限${suffix}`,
        false,
      )
    }
    if (status === 429) {
      throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, `上游额度接口限流（HTTP 429），请稍后重试${suffix}`, true)
    }
    if (status >= 500) {
      throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, `上游额度接口暂时不可用（HTTP ${status}）${suffix}`, true)
    }
    throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, `上游额度接口返回 HTTP ${status}${suffix}`, false)
  }

  /** One upstream fetch, including timeout / network / structure classification. */
  async function fetchUsage(key) {
    const controller = new AbortController()
    activeRequests.add(controller)
    const signal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(settings.timeoutMs)])
      : AbortSignal.timeout(settings.timeoutMs)
    try {
      let response
      try {
        response = await fetch(usageURL, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${key}`,
            accept: 'application/json',
            'user-agent': 'dsh-opencode-go-quota/0.1.0',
          },
          signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, '额度查询已取消。', true)
        }
        if (isTimeoutError(error)) throw timeoutFailure()
        throw new QuotaFailure(ERROR_USAGE_UNAVAILABLE, '无法连接上游额度接口，请检查网络。', true)
      }
      if (response.ok !== true) await classifyUpstreamError(response, key, controller)
      const raw = await readBodyText(response, controller)
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        throw new QuotaFailure(ERROR_INVALID_RESPONSE, '上游额度接口返回了非 JSON 响应。', true)
      }
      return validateUsage(payload)
    } finally {
      activeRequests.delete(controller)
    }
  }

  /** Serve from cache when fresh, otherwise fetch and cache (SPEC 20s default). */
  async function loadUsage(key, refresh) {
    const id = settings.cacheMs > 0 ? cacheKeyOf(key) : ''
    if (!refresh && settings.cacheMs > 0) {
      const cached = cache.get(id)
      if (cached !== undefined) {
        if (Date.now() - cached.fetchedAt < settings.cacheMs) return cached
        cache.delete(id)
      }
    }
    const usage = await fetchUsage(key)
    const entry = { usage, fetchedAt: Date.now() }
    if (settings.cacheMs > 0) {
      cache.delete(id)
      cache.set(id, entry)
      while (cache.size > CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next()
        if (oldest.done === true) break
        cache.delete(oldest.value)
      }
    }
    return entry
  }

  async function route(req, res) {
    const method = String(req.method ?? 'GET').toUpperCase()
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 404, errorBody(new QuotaFailure(ERROR_NOT_FOUND, '未知的 OpenCode Go 额度接口。', false)))
      return
    }
    const pathname = url.pathname
    if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) {
      sendJson(res, 404, errorBody(new QuotaFailure(ERROR_NOT_FOUND, '未知的 OpenCode Go 额度接口。', false)))
      return
    }
    if (method !== 'GET') {
      if (res.writableEnded || res.headersSent === true) return
      const body = JSON.stringify(errorBody(new QuotaFailure(ERROR_METHOD_NOT_ALLOWED, '该接口仅接受 GET 请求。', false)))
      res.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        allow: 'GET',
      })
      res.end(body)
      return
    }
    const sub = pathname.slice(ROUTE.length) || '/'
    if (sub !== USAGE_PATH) {
      sendJson(res, 404, errorBody(new QuotaFailure(ERROR_NOT_FOUND, '未知的 OpenCode Go 额度接口。', false)))
      return
    }
    const refresh = url.searchParams.get('refresh') === '1'
    try {
      const key = await resolveApiKey()
      const entry = await loadUsage(key, refresh)
      sendJson(res, 200, successBody(entry))
    } catch (error) {
      sendJson(res, 200, failureBody(failureOf(error)))
    }
  }

  const handler = async (req, res) => {
    try {
      await route(req, res)
    } catch (error) {
      try {
        sendJson(res, 200, failureBody(failureOf(error)))
      } catch {
        // The socket is already gone; nothing left to answer.
      }
    }
  }

  const disposeRoute = ctx.effect(
    () => {
      const unregister = ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler,
      })
      return () => {
        for (const controller of activeRequests) {
          try {
            controller.abort()
          } catch {
            // Already settled.
          }
        }
        activeRequests.clear()
        cache.clear()
        try {
          unregister?.()
        } catch {
          // Already unregistered.
        }
      }
    },
    'opencode-go-quota: usage route',
  )

  ctx.effect(
    () => () => {
      for (const controller of activeRequests) {
        try {
          controller.abort()
        } catch {
          // Already settled.
        }
      }
      activeRequests.clear()
      cache.clear()
      try {
        disposeRoute?.()
      } catch {
        // Already disposed.
      }
    },
    'opencode-go-quota: shutdown',
  )
}

function isTimeoutError(error) {
  if (error === null || error === undefined) return false
  const name = typeof error.name === 'string' ? error.name : ''
  if (name === 'TimeoutError') return true
  if (error.code === 'ETIMEDOUT' || error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.code === 'UND_ERR_HEADERS_TIMEOUT') return true
  return name === 'AbortError'
}
