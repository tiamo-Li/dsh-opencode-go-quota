// Structural smoke test for client.js without a browser:
// fake window.__ModuleLoader__, fake React, fake Cordis ctx.
// Verifies: bundle registration, factory purity, locale/styles/slot registration,
// dock entry descriptor, inject(sessionId) contract, and the visibility gate by
// rendering the registered component through a tiny hook-aware React shim.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '..', 'client.js')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

const requireShim = (specifier) => {
  if (specifier === 'react') {
    return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      Fragment: Symbol('Fragment'),
      useCallback: (fn) => fn,
      useEffect: () => {},
      useLayoutEffect: () => {},
      useRef: (value) => ({ current: value }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useId: () => 'r0',
    }
  }
  if (specifier === 'react-dom') return { createPortal: (node) => node }
  throw new Error(`unexpected require: ${specifier}`)
}

const require = createRequire(import.meta.url)
require(clientPath)
assert.ok(captured !== null, 'client.js must call window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-opencode-go-quota')

const moduleExports = captured.factory(requireShim)
assert.ok(moduleExports && typeof moduleExports.apply === 'function', 'factory must return { apply }')
assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'modelDirectories'])

// ---- fake Cordis context -------------------------------------------------
const log = { locales: [], effects: [], slotInjections: [] }
const styleTags = []
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: (el) => styleTags.push(el) },
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
}
globalThis.document.querySelector = (selector) =>
  styleTags.find((el) => selector.includes(el.dataset.plugin)) ?? null

const ctx = {
  effect: (factory, label) => {
    log.effects.push(label)
    const dispose = factory()
    if (typeof dispose === 'function') log.effects.push(`${label}:disposer`)
  },
  locale: {
    register: (ns, dictionaries) => {
      log.locales.push({ ns, dictionaries })
    },
    bind: (ns) => (key, params) => {
      const dict = log.locales.find((entry) => entry.ns === ns)?.dictionaries?.zh ?? {}
      let text = dict[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
      return text
    },
  },
  slots: {
    inject: (name, callback) => {
      log.slotInjections.push(name)
      const iterator = callback()
      const registered = []
      let step = iterator.next()
      while (!step.done) {
        registered.push(step.value)
        step = iterator.next()
      }
      log.registered = registered
      return () => {}
    },
    register: (descriptor, component) => ({ descriptor, component }),
  },
  modelDirectories: {
    directoryFor: (sessionId) => {
      assert.equal(sessionId, 'session-1')
      let value = { current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } }
      return {
        store: {
          getSnapshot: () => value,
          subscribe: () => () => {},
        },
        setForTest: (next) => {
          value = next
        },
      }
    },
  },
}

moduleExports.apply(ctx)

// ---- assertions ----------------------------------------------------------
assert.equal(log.locales.length, 1)
assert.equal(log.locales[0].ns, 'opencodeGoQuota')
assert.ok(log.locales[0].dictionaries.zh && log.locales[0].dictionaries.en)
assert.ok(log.locales[0].dictionaries.zh['aria'].includes('{percent}'))

assert.equal(styleTags.length, 1, 'one plugin style tag')
assert.ok(styleTags[0].textContent.includes('.ogq-trigger'))
assert.ok(styleTags[0].textContent.includes('var(--dsw-radius-sm)'))
assert.ok(styleTags[0].textContent.includes('.ogq-panel'))
assert.match(styleTags[0].textContent, /\.ogq-root\s*\{[^}]*order:\s*1/, 'root uses CSS order to sit after the context meter')
assert.match(styleTags[0].textContent, /\.ogq-rows\s*\{[^}]*grid-template-columns:\s*max-content max-content max-content/, 'shared grid keeps the three row columns aligned')
assert.match(styleTags[0].textContent, /\.ogq-rows\s*\{[^}]*column-gap:\s*14px/, 'a 14px gap separates the usage group from the reset column')
assert.match(styleTags[0].textContent, /\.ogq-panel\s*\{[^}]*width:\s*fit-content/, 'panel shrinks to its content instead of leaving dead space')
assert.match(styleTags[0].textContent, /\.ogq-panel\s*\{[^}]*min-width:\s*272px/, 'panel minimum width is compact')
assert.match(styleTags[0].textContent, /\.ogq-panel\s*\{[^}]*padding:\s*10px 12px 10px 16px/, 'panel keeps a slightly larger left inset')
assert.match(styleTags[0].textContent, /\.ogq-head-value\s*\{[^}]*margin-right:\s*6px/, 'header reading is inset from the right edge')
assert.match(styleTags[0].textContent, /\.ogq-row-usage\s*\{[^}]*display:\s*flex/, 'bar and percent share one usage group')
assert.match(styleTags[0].textContent, /\.ogq-row-bar\s*\{[^}]*width:\s*48px/, 'usage bar keeps a fixed track width next to the number')
assert.match(styleTags[0].textContent, /\.ogq-row-reset\s*\{[^}]*justify-self:\s*start/, 'reset countdown is left aligned')
assert.match(styleTags[0].textContent, /\.ogq-row\s*\{\s*display:\s*contents/, 'rows are contents so one grid aligns all cells')

assert.deepEqual(log.slotInjections, ['conversation.composer.dock'])
assert.equal(log.registered.length, 1)
const { descriptor, component } = log.registered[0]
assert.equal(descriptor.name, 'conversation.composer.dock')
assert.equal(descriptor.id, 'opencode-go-quota')
assert.equal(descriptor.order, 2)
assert.equal(descriptor.locale, 'opencodeGoQuota')
assert.equal(typeof descriptor.inject, 'function')
assert.equal(typeof component, 'function')

const injected = descriptor.inject('session-1')
assert.ok(injected.directory && typeof injected.directory.getSnapshot === 'function')
assert.equal(injected.directory.getSnapshot().current.provider, 'opencode-go')

// Render the dock row: matching provider yields the indicator tree, non-matching null.
const t = ctx.locale.bind('opencodeGoQuota')
const row = component({ directory: injected.directory, t })
assert.ok(row !== null, 'row must render for an OpenCode Go model')
assert.equal(typeof row.type, 'function', 'row delegates to the indicator component')
const renderedElement = row.type(row.props)
const renderedTree = JSON.stringify(renderedElement, (key, value) => (typeof value === 'symbol' ? String(value) : value))
assert.ok(renderedTree.includes('opencode-go-quota'), 'trigger carries data-composer-stat marker')
assert.ok(renderedTree.includes('ogq-trigger'))
assert.ok(renderedTree.includes('ogq-bar'))
assert.ok(renderedTree.includes('—'), 'collapsed reading falls back to the dash while loading')

const foreignDirectory = {
  getSnapshot: () => ({ current: { provider: 'deepseek', model: 'deepseek-chat' } }),
  subscribe: () => () => {},
}
assert.equal(component({ directory: foreignDirectory, t }), null, 'row hides for a foreign provider')
assert.equal(component({ directory: null, t }), null, 'row hides without a directory')

// Missing directory resolution must not throw.
const throwingCtx = {
  ...ctx,
  modelDirectories: {
    directoryFor: () => {
      throw new Error('no scope')
    },
  },
}
const throwingInjected = descriptor.inject.call(throwingCtx, 'session-1')
assert.ok(throwingInjected !== undefined)

console.log('client-smoke: all structural checks passed')






