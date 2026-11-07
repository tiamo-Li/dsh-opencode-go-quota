// Real-DOM render test for client.js using jsdom + React 18.
// Style mirrors harness/debug-render2.mjs (validated working): top-level await,
// explicit process.exit so jsdom's window timers cannot keep the process alive.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const softFail = []
const check = (condition, message) => {
  if (!condition) softFail.push(message)
}

const dom = new JSDOM('<!doctype html><html><body><div id=root></div></body></html>', {
  url: 'http://127.0.0.1:56711/',
  pretendToBeVisual: false,
})
const w = dom.window
globalThis.window = w
globalThis.document = w.document
for (const k of ['HTMLElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) globalThis[k] = w[k]
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const require = createRequire(import.meta.url)
const React = require('react')
const ReactDOM = require('react-dom')
const { createRoot } = require('react-dom/client')

let captured = null
w.__ModuleLoader__ = {
  load(d) {
    captured = d
  },
}
require(path.resolve(here, '..', 'client.js'))
check(captured && captured.id === 'dsh-opencode-go-quota', 'bundle registers under its package id')

const mod = captured.factory((s) => (s === 'react' ? React : s === 'react-dom' ? ReactDOM : (() => { throw new Error(s) })()))

function createStore(initial) {
  let v = initial
  const ls = new Set()
  return {
    getSnapshot: () => v,
    subscribe: (l) => {
      ls.add(l)
      return () => ls.delete(l)
    },
    set: (n) => {
      v = n
      for (const l of ls) l()
    },
  }
}

const directoryStore = createStore({ current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } })
const regs = []
const dict = {
  aria: 'OpenCode Go 五小时额度已用 {percent}',
  title: 'OpenCode Go quota',
  rolling: 'Rolling',
  weekly: 'Weekly',
  monthly: 'Monthly',
  resetIn: 'Resets in {time}',
  unavailable: 'Quota unavailable',
  loading: 'Loading quota…',
  retry: 'Retry',
}
const t = (key, params) => {
  let text = dict[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
const ctx = {
  effect: (f) => {
    f()
  },
  locale: { register: () => {}, bind: () => t },
  slots: {
    inject: (n, cb) => {
      const it = cb()
      let s = it.next()
      while (!s.done) {
        regs.push(s.value)
        s = it.next()
      }
      return () => {}
    },
    register: (d, c) => ({ descriptor: d, component: c }),
  },
  modelDirectories: { directoryFor: () => ({ store: directoryStore }) },
}
mod.apply(ctx)
check(regs.length === 1, 'one dock registration')
const { descriptor, component } = regs[0]
check(descriptor.name === 'conversation.composer.dock', 'registers into the composer dock slot')
check(descriptor.id === 'opencode-go-quota', 'dock entry id')
check(descriptor.order === 2, 'dock order sits after usage(1) and before the context meter')

const payload = {
  ok: true,
  usage: {
    rolling: { status: 'ok', percent: 12, resetsAt: new Date(Date.now() + 72 * 60_000).toISOString() },
    weekly: { status: 'ok', percent: 34, resetsAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString() },
    monthly: { status: 'ok', percent: 56, resetsAt: new Date(Date.now() + 20 * 24 * 3600_000).toISOString() },
  },
  fetchedAt: Date.now(),
  config: { providers: ['opencode-go', 'dsh-opencode-go'], pollMs: 60000, label: 'OpenCode Go' },
}

let releaseFetch = null
w.fetch = () =>
  new Promise((resolve) => {
    releaseFetch = () => resolve({ ok: true, status: 200, json: async () => payload })
  })
globalThis.fetch = w.fetch

const container = w.document.getElementById('root')
const root = createRoot(container)
const dockElement = () => React.createElement(component, { directory: descriptor.inject('session-1').directory, t })
const flush = async (ms = 20) =>
  React.act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

const guard = setTimeout(() => {
  console.error('client-render: timed out')
  process.exit(2)
}, 30_000)
guard.unref?.()

await React.act(async () => {
  root.render(dockElement())
})
await flush(10)
let trigger = container.querySelector('[data-composer-stat="opencode-go-quota"]')
check(trigger !== null, 'trigger renders for an OpenCode Go model')
check(trigger.querySelector('.ogq-bar') !== null, 'collapsed trigger has a mini bar')
check(trigger.querySelector('.ogq-percent').textContent === '—', 'loading state shows the dash')
check(trigger.getAttribute('aria-label') === 'Quota unavailable', 'loading aria label')

await React.act(async () => {
  releaseFetch()
  await new Promise((r) => setTimeout(r, 10))
})
await flush(20)
check(trigger.querySelector('.ogq-percent').textContent === '12%', 'collapsed reading shows the rolling percent')
check(trigger.getAttribute('aria-label') === 'OpenCode Go 五小时额度已用 12%', 'aria label carries the reading')

await React.act(async () => {
  trigger.dispatchEvent(new w.MouseEvent('pointerover', { bubbles: true, cancelable: true }))
})
await flush(20)
const panel = w.document.querySelector('[data-opencode-go-quota-panel]')
check(panel !== null, 'hover expands the panel')
if (panel !== null) {
  check(panel.getAttribute('role') === 'dialog', 'panel is a dialog')
  check(panel.getAttribute('aria-label') === 'OpenCode Go quota', 'panel aria label')
  const labels = [...panel.querySelectorAll('.ogq-row-label')].map((n) => n.textContent)
  check(JSON.stringify(labels) === JSON.stringify(['Rolling', 'Weekly', 'Monthly']), `panel rows are the three windows (${labels.join(',')})`)
  check(panel.querySelectorAll('.ogq-row-usage .ogq-row-percent').length === 3, 'each percent sits inside its bar group')
  const percents = [...panel.querySelectorAll('.ogq-row-percent')].map((n) => n.textContent)
  check(JSON.stringify(percents) === JSON.stringify(['12%', '34%', '56%']), `usage column aligns (${percents.join(',')})`)
  const resets = [...panel.querySelectorAll('.ogq-row-reset')].map((n) => n.textContent)
  check(resets.length === 3 && resets.every((text) => text.startsWith('Resets in')), `every row has its own reset cell (${resets.join('|')})`)
  check(!panel.textContent.includes('·'), 'no middle-dot separator between usage and reset')
}
check(trigger.getAttribute('aria-expanded') === 'true', 'trigger reports expanded')

await React.act(async () => {
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
await flush(30)
await React.act(async () => {})
check(w.document.querySelector('[data-opencode-go-quota-panel]') === null, 'Escape closes the panel')
check(trigger.getAttribute('aria-expanded') === 'false', 'trigger reports collapsed')

await React.act(async () => {
  directoryStore.set({ current: { provider: 'deepseek', model: 'deepseek-chat' } })
})
check(container.querySelector('[data-composer-stat="opencode-go-quota"]') === null, 'hides for a foreign provider')
await React.act(async () => {
  directoryStore.set({ current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } })
})
check(container.querySelector('[data-composer-stat="opencode-go-quota"]') !== null, 'returns for a Go provider')

await React.act(async () => {
  root.unmount()
})

if (softFail.length > 0) {
  console.error('client-render failures:')
  for (const item of softFail) console.error(' -', item)
  process.exit(1)
}
console.log('client-render: all DOM checks passed')
process.exit(0)







