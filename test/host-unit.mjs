/**
 * Unit tests for the OpenCode Go quota host half.
 *
 * Runs with plain Node: `node test/host-unit.mjs`.
 * The DSH credential package is not resolvable outside the harness, so the
 * plugin falls back to the raw reference name and this harness supplies a
 * mock `ctx.credentials`; the upstream is a mocked `globalThis.fetch`.
 */

import assert from 'node:assert/strict'
import { apply, inject, name } from '../index.js'

const API_KEY = 'sk-test-key-do-not-log-0123456789abcdef'
const ROTATED_KEY = 'sk-test-key-rotated-9876543210fedcba'
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

const SAMPLE_USAGE = {
  rolling: { status: 'ok', percent: 12.5, resetsAt: '2026-11-07T08:08:39Z' },
  weekly: { status: 'ok', percent: 42, resetsAt: '2026-11-09T00:00:00Z' },
  monthly: { status: 'ok', percent: 7, resetsAt: '2026-12-06T12:31:44Z' },
}

const results = []
let currentSuite = ''

function suite(title) {
  currentSuite = title
  console.log(`\n# ${title}`)
}

async function test(title, run) {
  try {
    await run()
    results.push({ title, ok: true })
    console.log(`ok  - ${title}`)
  } catch (error) {
    results.push({ title, ok: false, error })
    console.log(`FAIL - ${title}`)
    console.log(`       ${error instanceof Error ? error.stack?.split('\n').slice(0, 4).join('\n       ') : String(error)}`)
  }
}

/* ------------------------------------------------------------------ mocks */

function jsonResponse(payload, { status = 200, raw = JSON.stringify(payload) } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return raw
    },
    async json() {
      return JSON.parse(raw)
    },
  }
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler({ url: String(url), init, index: calls.length })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function makeCtx({ resolve } = {}) {
  const routes = []
  const disposers = []
  const resolveImpl = resolve ?? (async () => ({ value: API_KEY, source: 'stored' }))
  const ctx = {
    effect(fn) {
      const disposer = fn()
      const wrapped = () => {
        const index = disposers.indexOf(wrapped)
        if (index >= 0) disposers.splice(index, 1)
        if (typeof disposer === 'function') disposer()
      }
      disposers.push(wrapped)
      return wrapped
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    get(service) {
      return service === 'credentials' ? { resolve: resolveImpl } : undefined
    },
    credentials: { resolve: resolveImpl },
  }
  return { ctx, routes, disposers, resolve: resolveImpl }
}

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: undefined,
      headers: {},
      headersSent: false,
      writableEnded: false,
      writeHead(status, headers) {
        this.statusCode = status
        this.headers = headers
        this.headersSent = true
      },
      end(body) {
        this.writableEnded = true
        resolve({
          status: this.statusCode,
          headers: this.headers,
          raw: typeof body === 'string' ? body : '',
          body: typeof body === 'string' && body.length > 0 ? JSON.parse(body) : undefined,
        })
      },
    }
    const req = { url, method, headers: {} }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

/** Apply the plugin over a fresh mock context and return its captured route. */
function setup(config, { resolve } = {}) {
  const harness = makeCtx({ resolve })
  apply(harness.ctx, config)
  assert.equal(harness.routes.length, 1, 'the plugin registers exactly one route')
  const route = harness.routes[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/api/opencode-go-quota')
  return { ...harness, route }
}

function assertNoKey(result, key = API_KEY) {
  assert.equal(result.raw.includes(key), false, 'response body must not contain the API key')
  assert.equal(result.raw.includes('sk-test-key'), false, 'response body must not contain any test key material')
  assert.equal(result.raw.toLowerCase().includes('authorization'), false, 'response body must not echo auth headers')
}

/* ------------------------------------------------------------------ tests */

assert.equal(name, 'opencode-go-quota')
assert.deepEqual(inject, ['webServer', 'credentials'])

suite('module shape')

await test('exports name / inject / apply', () => {
  assert.equal(typeof apply, 'function')
})

await test('apply itself performs no network request and no credential lookup', async () => {
  let resolved = 0
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const harness = makeCtx({
      resolve: async () => {
        resolved += 1
        return { value: API_KEY, source: 'stored' }
      },
    })
    apply(harness.ctx, {})
    assert.equal(harness.routes.length, 1)
    assert.equal(upstream.calls.length, 0, 'apply must stay lazy')
    assert.equal(resolved, 0, 'apply must not resolve the credential')
  } finally {
    upstream.restore()
  }
})

suite('success path')

await test('GET /usage returns the three windows, fetchedAt, config and no-store', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.status, 200)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(result.body.ok, true)
    assert.deepEqual(result.body.usage, SAMPLE_USAGE)
    assert.equal(typeof result.body.fetchedAt, 'number')
    assert.ok(Math.abs(Date.now() - result.body.fetchedAt) < 5_000)
    assert.deepEqual(result.body.config, {
      providers: ['opencode-go', 'dsh-opencode-go'],
      pollMs: 60_000,
      label: 'OpenCode Go',
    })
    assertNoKey(result)
    assert.equal(upstream.calls.length, 1)
    assert.equal(upstream.calls[0].url, USAGE_URL)
    assert.equal(upstream.calls[0].init.method, 'GET')
    assert.equal(upstream.calls[0].init.headers.authorization, `Bearer ${API_KEY}`)
    assert.equal(upstream.calls[0].init.headers.accept, 'application/json')
    assert.ok(upstream.calls[0].init.signal instanceof AbortSignal)
  } finally {
    upstream.restore()
  }
})

await test('second request inside the cache window is served from memory', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const first = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    await new Promise((resolve) => setTimeout(resolve, 25))
    const second = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 1, 'cached request must not refetch')
    assert.equal(second.body.ok, true)
    assert.equal(second.body.fetchedAt, first.body.fetchedAt)
    assert.deepEqual(second.body.usage, first.body.usage)
  } finally {
    upstream.restore()
  }
})

await test('cache expires after cacheMs', async () => {
  const fixture = setup({ cacheMs: 20 })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const first = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    await new Promise((resolve) => setTimeout(resolve, 40))
    const second = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 2, 'expired cache must refetch')
    assert.ok(second.body.fetchedAt >= first.body.fetchedAt)
  } finally {
    upstream.restore()
  }
})

await test('cacheMs: 0 disables the cache', async () => {
  const fixture = setup({ cacheMs: 0 })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 2)
  } finally {
    upstream.restore()
  }
})

await test('?refresh=1 bypasses a fresh cache entry', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const first = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    const second = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage?refresh=1')
    assert.equal(upstream.calls.length, 2)
    assert.ok(second.body.fetchedAt >= first.body.fetchedAt)
    const third = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 2, 'the refreshed result repopulates the cache')
    assert.equal(third.body.fetchedAt, second.body.fetchedAt)
  } finally {
    upstream.restore()
  }
})

await test('a rotated credential value invalidates the cache', async () => {
  let currentKey = API_KEY
  const fixture = setup({}, { resolve: async () => ({ value: currentKey, source: 'stored' }) })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 1)
    currentKey = ROTATED_KEY
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 2, 'a rotated key must miss the old cache entry')
    assert.equal(upstream.calls[1].init.headers.authorization, `Bearer ${ROTATED_KEY}`)
  } finally {
    upstream.restore()
  }
})

await test('an upstream that echoes the key never leaks it into the response', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse(
    { error: `invalid token ${API_KEY}` },
    { status: 500, raw: `upstream said Bearer ${API_KEY} is wrong` },
  ))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, false)
    assertNoKey(result)
    assert.equal(result.body.error.message.includes('Bearer ***'), true)
  } finally {
    upstream.restore()
  }
})

suite('upstream failures')

await test('401 is usage-unavailable, non-retryable, and mentions the credential', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({ error: 'unauthorized' }, { status: 401 }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error.code, 'opencode-go-quota/usage-unavailable')
    assert.equal(result.body.error.retryable, false)
    assert.match(result.body.error.message, /401/u)
    assert.match(result.body.error.message, /OPENCODE_GO_API_KEY/u)
    assert.equal(typeof result.body.config, 'object')
    assertNoKey(result)
  } finally {
    upstream.restore()
  }
})

await test('403 is non-retryable', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({}, { status: 403 }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.error.code, 'opencode-go-quota/usage-unavailable')
    assert.equal(result.body.error.retryable, false)
  } finally {
    upstream.restore()
  }
})

await test('429 and 5xx are retryable', async () => {
  const fixture = setup({})
  const upstream = installFetch(({ index }) => jsonResponse({}, { status: index === 1 ? 429 : 503 }))
  try {
    const first = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    const second = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    for (const result of [first, second]) {
      assert.equal(result.body.error.code, 'opencode-go-quota/usage-unavailable')
      assert.equal(result.body.error.retryable, true)
    }
  } finally {
    upstream.restore()
  }
})

await test('timeout is usage-unavailable and retryable', async () => {
  const fixture = setup({ timeoutMs: 50 })
  const upstream = installFetch(() => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  })
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error.code, 'opencode-go-quota/usage-unavailable')
    assert.equal(result.body.error.retryable, true)
    assert.match(result.body.error.message, /超时/u)
  } finally {
    upstream.restore()
  }
})

await test('network failure is usage-unavailable and retryable', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => {
    throw new TypeError('fetch failed')
  })
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.error.code, 'opencode-go-quota/usage-unavailable')
    assert.equal(result.body.error.retryable, true)
  } finally {
    upstream.restore()
  }
})

suite('invalid upstream bodies')

await test('non-JSON body is invalid-response', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({}, { raw: '<html>gateway</html>' }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.error.code, 'opencode-go-quota/invalid-response')
    assert.equal(result.body.error.retryable, true)
  } finally {
    upstream.restore()
  }
})

const invalidBodies = [
  ['missing usage', {}],
  ['missing rolling', { usage: { weekly: SAMPLE_USAGE.weekly, monthly: SAMPLE_USAGE.monthly } }],
  ['percent out of range', { usage: { ...SAMPLE_USAGE, rolling: { ...SAMPLE_USAGE.rolling, percent: 101 } } }],
  ['percent not a number', { usage: { ...SAMPLE_USAGE, rolling: { ...SAMPLE_USAGE.rolling, percent: '12' } } }],
  ['percent not finite', { usage: { ...SAMPLE_USAGE, rolling: { ...SAMPLE_USAGE.rolling, percent: Number.NaN } } }],
  ['status not a string', { usage: { ...SAMPLE_USAGE, weekly: { ...SAMPLE_USAGE.weekly, status: 1 } } }],
  ['unparseable resetsAt', { usage: { ...SAMPLE_USAGE, monthly: { ...SAMPLE_USAGE.monthly, resetsAt: 'not-a-date' } } }],
  ['window is not an object', { usage: { ...SAMPLE_USAGE, rolling: null } }],
]

for (const [label, payload] of invalidBodies) {
  await test(`${label} → invalid-response`, async () => {
    const fixture = setup({})
    const upstream = installFetch(() => jsonResponse(payload))
    try {
      const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
      assert.equal(result.body.ok, false)
      assert.equal(result.body.error.code, 'opencode-go-quota/invalid-response')
      assert.equal(result.body.error.retryable, true)
    } finally {
      upstream.restore()
    }
  })
}

suite('credential failures')

await test('missing credential never touches the network', async () => {
  const fixture = setup({}, { resolve: async () => undefined })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error.code, 'opencode-go-quota/missing-credential')
    assert.equal(result.body.error.retryable, false)
    assert.match(result.body.error.message, /OPENCODE_GO_API_KEY/u)
    assert.equal(typeof result.body.config, 'object')
    assert.equal(upstream.calls.length, 0)
  } finally {
    upstream.restore()
  }
})

await test('an empty credential value counts as missing', async () => {
  const fixture = setup({}, { resolve: async () => ({ value: '   ', source: 'stored' }) })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.error.code, 'opencode-go-quota/missing-credential')
    assert.equal(upstream.calls.length, 0)
  } finally {
    upstream.restore()
  }
})

await test('a throwing credential resolve is reported as missing', async () => {
  const fixture = setup({}, { resolve: async () => { throw new Error('store unavailable') } })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.error.code, 'opencode-go-quota/missing-credential')
    assert.equal(result.body.error.retryable, false)
    assert.equal(upstream.calls.length, 0)
  } finally {
    upstream.restore()
  }
})

await test('a custom apiKeyEnv is resolved and named in diagnostics', async () => {
  const fixture = setup({ apiKeyEnv: 'MY_GO_KEY' }, {
    resolve: async (ref) => ref === 'MY_GO_KEY' ? { value: API_KEY, source: 'stored' } : undefined,
  })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(result.body.ok, true)
    assert.equal(fixture.resolve !== undefined, true)
  } finally {
    upstream.restore()
  }
})

suite('routing')

await test('unknown subpath → 404 not-found', async () => {
  const fixture = setup({})
  const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/other')
  assert.equal(result.status, 404)
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error.code, 'not-found')
  assert.equal(result.body.error.retryable, false)
})

await test('prefix look-alike → 404', async () => {
  const fixture = setup({})
  const result = await invoke(fixture.route.handler, '/api/opencode-go-quota-extra/usage')
  assert.equal(result.status, 404)
  assert.equal(result.body.error.code, 'not-found')
})

await test('non-GET → 405 with Allow: GET', async () => {
  const fixture = setup({})
  const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage', 'POST')
  assert.equal(result.status, 405)
  assert.equal(result.headers.allow, 'GET')
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error.code, 'method-not-allowed')
})

suite('configuration validation')

await test('illegal config values fall back to the SPEC defaults', async () => {
  const fixture = setup({
    apiKeyEnv: 'not a ref!',
    baseURL: 'ftp://example.com/api',
    providers: [],
    pollMs: -5,
    cacheMs: 'soon',
    timeoutMs: 0,
  })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.deepEqual(result.body.config, {
      providers: ['opencode-go', 'dsh-opencode-go'],
      pollMs: 60_000,
      label: 'OpenCode Go',
    })
    assert.equal(upstream.calls[0].url, USAGE_URL)
  } finally {
    upstream.restore()
  }
})

await test('valid custom config is honored', async () => {
  const fixture = setup({
    baseURL: 'https://gateway.example.com/custom/go/v1/',
    providers: ['go-one', 'go-two', 'go-one'],
    pollMs: 5_000,
    cacheMs: 1_000,
    timeoutMs: 2_000,
  })
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    const result = await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.deepEqual(result.body.config.providers, ['go-one', 'go-two'])
    assert.equal(result.body.config.pollMs, 5_000)
    assert.equal(upstream.calls[0].url, 'https://gateway.example.com/custom/go/v1/usage')
  } finally {
    upstream.restore()
  }
})

suite('lifecycle')

await test('disposing the effect unregisters the route and clears the cache', async () => {
  const fixture = setup({})
  const upstream = installFetch(() => jsonResponse({ usage: structuredClone(SAMPLE_USAGE) }))
  try {
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 1, 'cache hit before dispose')
    for (const dispose of [...fixture.disposers]) dispose()
    assert.equal(fixture.routes.length, 0, 'route unregistered on dispose')
    assert.equal(fixture.disposers.length, 0, 'all disposers ran')
    await invoke(fixture.route.handler, '/api/opencode-go-quota/usage')
    assert.equal(upstream.calls.length, 2, 'cache cleared on dispose')
  } finally {
    upstream.restore()
  }
})

/* ------------------------------------------------------------------ report */

const failed = results.filter((result) => !result.ok)
const total = results.length
console.log(`\n${total - failed.length}/${total} tests passed`)
if (failed.length > 0) {
  console.error(`failing: ${failed.map((result) => `${currentSuite} › ${result.title}`).join(', ')}`)
  process.exitCode = 1
}
