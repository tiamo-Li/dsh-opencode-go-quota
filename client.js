window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-quota',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')

    const NS = 'opencodeGoQuota'
    const PLUGIN_ID = 'dsh-opencode-go-quota'
    const ROUTE = '/api/opencode-go-quota/usage'
    const DEFAULT_PROVIDERS = ['opencode-go', 'dsh-opencode-go']
    const DEFAULT_POLL_MS = 60000
    const MIN_POLL_MS = 5000
    const MAX_POLL_MS = 3600000
    const WINDOW_KEYS = ['rolling', 'weekly', 'monthly']
    const CLOSE_DELAY_MS = 140
    const DASH = '—'

    const h = React.createElement
    const Fragment = React.Fragment

    //#region locale
    // Panel rows use English labels and English countdown units in every locale:
    // fixed-width Latin text keeps the label, bar and reading columns aligned.
    const zh = {
      'aria': 'OpenCode Go 五小时额度已用 {percent}',
      'title': 'OpenCode Go quota',
      'rolling': 'Rolling',
      'weekly': 'Weekly',
      'monthly': 'Monthly',
      'resetIn': 'Resets in {time}',
      'unavailable': 'Quota unavailable',
      'loading': 'Loading quota…',
      'retry': 'Retry',
    }

    const en = {
      'aria': 'OpenCode Go 5-hour quota {percent} used',
      'title': 'OpenCode Go quota',
      'rolling': 'Rolling',
      'weekly': 'Weekly',
      'monthly': 'Monthly',
      'resetIn': 'Resets in {time}',
      'unavailable': 'Quota unavailable',
      'loading': 'Loading quota…',
      'retry': 'Retry',
    }
    //#endregion

    //#region styles
    const CSS = `
.ogq-root { order: 1; position: relative; display: inline-flex; flex: none; align-items: center; }
.ogq-trigger {
  box-sizing: border-box;
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-variant-numeric: tabular-nums;
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
  cursor: pointer;
  background: 0 0;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px;
}
.ogq-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
@media (hover: hover) {
  .ogq-trigger:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-secondary);
  }
}
.ogq-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
.ogq-bar {
  flex: none;
  display: inline-block;
  width: 20px;
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.ogq-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: currentColor;
  transition: width 160ms ease;
}
.ogq-percent { font-variant-numeric: tabular-nums; }
.ogq-trigger[data-state="loading"] .ogq-bar,
.ogq-trigger[data-state="unavailable"] .ogq-bar,
.ogq-trigger[data-state="error"] .ogq-bar { opacity: .55; }
.ogq-panel {
  z-index: 1100;
  box-sizing: border-box;
  position: fixed;
  width: fit-content;
  min-width: 300px;
  max-width: min(340px, calc(100vw - 24px));
  max-height: var(--dsh-anchored-max-height, none);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  border: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 20px;
  overflow: hidden auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.ogq-head { display: flex; align-items: center; gap: 6px; }
.ogq-head-title { color: var(--dsw-alias-label-tertiary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ogq-head-value {
  margin-left: auto;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
/* One shared grid for all three rows: the fixed-width window label, the usage
   group (fixed-width bar + the number right next to it) and the left-aligned
   reset countdown each keep a common column. The panel shrinks to this content
   (width: fit-content) so there is no dead space on the right. */
.ogq-rows { display: grid; grid-template-columns: 62px max-content max-content; column-gap: 16px; row-gap: 8px; align-items: center; margin: 10px 0 0; }
.ogq-row { display: contents; }
.ogq-row-label { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.ogq-row-usage { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ogq-row-bar {
  flex: none;
  width: 48px;
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.ogq-row-fill { display: block; height: 100%; border-radius: 999px; background: var(--dsw-alias-label-tertiary); }
.ogq-row-percent {
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ogq-row-reset {
  justify-self: start;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ogq-row-reset { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.ogq-note { margin: 10px 0 0; color: var(--dsw-alias-label-tertiary); }
.ogq-error { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 0; }
.ogq-error-text { color: var(--dsw-alias-label-secondary); }
.ogq-retry {
  align-self: flex-start;
  background: 0 0;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-radius: var(--dsw-radius-sm);
}
.ogq-retry:hover { text-decoration: underline; }
.ogq-retry:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, currentColor); outline-offset: 1px; }
`
    //#endregion

    //#region shared state
    /** Minimal snapshot store shared with the dock row; the Host route owns these values. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot() {
          return value
        },
        set(next) {
          value = next
          for (const listener of Array.from(listeners)) {
            try {
              listener()
            } catch (error) {
              // A listener must never break the store.
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    const configStore = createStore({
      providers: DEFAULT_PROVIDERS.slice(),
      pollMs: DEFAULT_POLL_MS,
    })

    function providersOf(config) {
      if (config === null || typeof config !== 'object') return null
      const providers = config.providers
      if (!Array.isArray(providers)) return null
      const filtered = providers.filter((item) => typeof item === 'string' && item.length > 0)
      return filtered.length === 0 ? null : filtered
    }

    function pollMsOf(config) {
      if (config === null || typeof config !== 'object') return null
      const value = config.pollMs
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(value)))
    }

    function applyRemoteConfig(config) {
      const providers = providersOf(config)
      const pollMs = pollMsOf(config)
      if (providers === null && pollMs === null) return
      const current = configStore.getSnapshot()
      configStore.set({
        providers: providers === null ? current.providers : providers,
        pollMs: pollMs === null ? current.pollMs : pollMs,
      })
    }

    function toPercent(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return null
      return Math.min(100, Math.max(0, number))
    }

    function normalizeWindow(value) {
      if (value === null || typeof value !== 'object') return null
      const percent = toPercent(value.percent)
      if (percent === null) return null
      return {
        status: typeof value.status === 'string' ? value.status : '',
        percent,
        resetsAt: typeof value.resetsAt === 'string' ? value.resetsAt : null,
      }
    }

    function normalizeUsage(usage) {
      if (usage === null || typeof usage !== 'object') return null
      const normalized = {}
      let any = false
      for (const key of WINDOW_KEYS) {
        const window = normalizeWindow(usage[key])
        normalized[key] = window
        if (window !== null) any = true
      }
      return any ? normalized : null
    }

    /** Compact English countdown (always shows the next smaller unit): 29d 0h / 1d 12h / 4h 54m / 12m / <1m. */
    function formatRemaining(resetsAt, now) {
      if (typeof resetsAt !== 'string') return ''
      const target = Date.parse(resetsAt)
      if (!Number.isFinite(target)) return ''
      const remain = target - now
      if (remain <= 0) return ''
      const totalMinutes = Math.ceil(remain / 60000)
      if (totalMinutes <= 0) return '<1m'
      const days = Math.floor(totalMinutes / 1440)
      const hours = Math.floor((totalMinutes - days * 1440) / 60)
      const minutes = totalMinutes % 60
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      return `${minutes}m`
    }

    /** `12%` reading for one window, or the dash while it is unavailable. */
    function percentOf(window) {
      return window === null ? DASH : `${Math.round(window.percent)}%`
    }

    /** `Resets in 4h 54m` cell for one window; empty when the reset time is unknown. */
    function resetOf(window, now, t) {
      if (window === null) return ''
      const remaining = formatRemaining(window.resetsAt, now)
      return remaining.length > 0 ? t('resetIn', { time: remaining }) : ''
    }
    //#endregion

    //#region hooks
    /** Subscribe one Session's model directory store (provider/model selection). */
    function useDirectorySelection(directory) {
      const subscribe = React.useCallback(
        (listener) => (directory === null ? () => {} : directory.subscribe(listener)),
        [directory],
      )
      const getSnapshot = React.useCallback(
        () => (directory === null ? null : directory.getSnapshot()),
        [directory],
      )
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /**
     * Read the Host usage route: one request on mount, then the Host-declared
     * cadence, paused while the page is hidden. A 404 means the Host half is
     * not mounted, so the row disappears; retryable failures keep polling.
     */
    function useQuota() {
      const [state, setState] = React.useState({
        status: 'loading',
        usage: null,
        error: null,
        fetchedAt: 0,
      })
      const aliveRef = React.useRef(false)
      const stoppedRef = React.useRef(false)
      const abortRef = React.useRef(null)

      const load = React.useCallback(async (force) => {
        if (!aliveRef.current) return
        if (abortRef.current !== null) {
          try {
            abortRef.current.abort()
          } catch (error) {
            // Ignore.
          }
        }
        const controller = new AbortController()
        abortRef.current = controller
        let payload
        try {
          const response = await fetch(force ? `${ROUTE}?refresh=1` : ROUTE, {
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          })
          if (!aliveRef.current || controller.signal.aborted) return
          if (response.status === 404) {
            stoppedRef.current = true
            setState((previous) => ({ ...previous, status: 'unavailable', usage: null, error: null }))
            return
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          payload = await response.json()
        } catch (error) {
          if (!aliveRef.current || controller.signal.aborted) return
          setState((previous) => ({
            ...previous,
            status: 'error',
            error: { code: 'opencode-go-quota/network', message: '', retryable: true },
          }))
          return
        }
        if (!aliveRef.current || controller.signal.aborted) return
        applyRemoteConfig(payload === null || typeof payload !== 'object' ? null : payload.config)
        if (payload !== null && typeof payload === 'object' && payload.ok === true) {
          const usage = normalizeUsage(payload.usage)
          if (usage === null) {
            setState((previous) => ({
              ...previous,
              status: 'error',
              error: { code: 'opencode-go-quota/invalid-response', message: '', retryable: true },
            }))
            return
          }
          setState({
            status: 'ready',
            usage,
            error: null,
            fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : Date.now(),
          })
          return
        }
        const failure =
          payload !== null && typeof payload === 'object' && payload.error !== null && typeof payload.error === 'object'
            ? payload.error
            : { code: 'opencode-go-quota/usage-unavailable', message: '', retryable: true }
        if (failure.retryable === false) stoppedRef.current = true
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: {
            code: typeof failure.code === 'string' ? failure.code : 'opencode-go-quota/usage-unavailable',
            message: typeof failure.message === 'string' ? failure.message : '',
            retryable: failure.retryable !== false,
          },
        }))
      }, [])

      React.useEffect(() => {
        aliveRef.current = true
        stoppedRef.current = false
        let timer = null
        let disposed = false
        const schedule = () => {
          if (disposed || stoppedRef.current) return
          const pollMs = configStore.getSnapshot().pollMs
          timer = setTimeout(() => {
            timer = null
            if (disposed || stoppedRef.current) return
            if (document.visibilityState !== 'hidden') load(false)
            schedule()
          }, pollMs)
        }
        const onVisibility = () => {
          if (document.visibilityState === 'visible' && !stoppedRef.current) load(false)
        }
        load(true)
        schedule()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          disposed = true
          aliveRef.current = false
          if (timer !== null) clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisibility)
          if (abortRef.current !== null) {
            try {
              abortRef.current.abort()
            } catch (error) {
              // Ignore.
            }
          }
        }
      }, [load])

      const refresh = React.useCallback(() => {
        stoppedRef.current = false
        load(true)
      }, [load])

      return { state, refresh }
    }

    /** Anchor the portaled panel above the trigger, flipping below when clipped. */
    function usePanelPosition(open, anchorRef, panelRef, revision) {
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const requestFrame =
          typeof window.requestAnimationFrame === 'function'
            ? (callback) => window.requestAnimationFrame(callback)
            : (callback) => window.setTimeout(callback, 16)
        const cancelFrame =
          typeof window.cancelAnimationFrame === 'function'
            ? (handle) => window.cancelAnimationFrame(handle)
            : (handle) => window.clearTimeout(handle)
        let frame = 0
        const update = () => {
          const anchor = anchorRef.current
          if (anchor === null) return
          const rect = anchor.getBoundingClientRect()
          const panel = panelRef.current
          const width = panel === null ? 320 : panel.offsetWidth || 320
          const height = panel === null ? 0 : panel.offsetHeight
          const margin = 12
          const viewportWidth = window.innerWidth || 1024
          const viewportHeight = window.innerHeight || 768
          let left = rect.right - width
          left = Math.max(margin, Math.min(left, viewportWidth - width - margin))
          let top = rect.top - height - 8
          if (top < margin) top = Math.min(rect.bottom + 8, viewportHeight - height - margin)
          setPosition({ left: Math.round(left), top: Math.round(top) })
        }
        update()
        frame = requestFrame(update)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          cancelFrame(frame)
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open, revision, anchorRef, panelRef])
      return position
    }
    //#endregion

    //#region panel
    /**
     * One panel row. The three cells are direct children of the shared
     * `.ogq-rows` grid (the row itself is `display: contents`), so the window
     * label, the usage group and the reset countdown each line up across all
     * three rows. The mini bar and the percent live in one usage group so the
     * number always sits right next to the bar it describes.
     */
    function WindowRow({ label, window, now, t }) {
      const percent = window === null ? 0 : window.percent
      return h(
        'div',
        { className: 'ogq-row' },
        h('span', { className: 'ogq-row-label' }, label),
        h(
          'span',
          { className: 'ogq-row-usage' },
          h(
            'span',
            { className: 'ogq-row-bar', 'aria-hidden': true },
            h('span', { className: 'ogq-row-fill', style: { width: `${Math.round(percent)}%` } }),
          ),
          h('span', { className: 'ogq-row-percent' }, percentOf(window)),
        ),
        h('span', { className: 'ogq-row-reset' }, resetOf(window, now, t)),
      )
    }

    /** Panel body: title reading, the three windows, or the unavailable state. */
    function QuotaPanelBody({ t, state, refresh, now }) {
      const usage = state.usage
      const failed = state.status === 'error' || state.status === 'unavailable'
      // Never show a stale reading beside an error notice.
      const rolling = failed || usage === null ? null : usage.rolling
      const headerValue = rolling === null ? DASH : `${Math.round(rolling.percent)}%`
      return h(
        Fragment,
        null,
        h(
          'div',
          { className: 'ogq-head' },
          h('span', { className: 'ogq-head-title' }, t('title')),
          h('span', { className: 'ogq-head-value' }, headerValue),
        ),
        failed
          ? h(
              'div',
              { className: 'ogq-error' },
              h('span', { className: 'ogq-error-text' }, t('unavailable')),
              state.status === 'error'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'ogq-retry',
                      onClick: () => {
                        refresh()
                      },
                    },
                    t('retry'),
                  )
                : null,
            )
          : state.status === 'loading'
            ? h('p', { className: 'ogq-note' }, t('loading'))
            : h(
                'div',
                { className: 'ogq-rows' },
                h(WindowRow, { key: 'rolling', label: t('rolling'), window: usage === null ? null : usage.rolling, now, t }),
                h(WindowRow, { key: 'weekly', label: t('weekly'), window: usage === null ? null : usage.weekly, now, t }),
                h(WindowRow, { key: 'monthly', label: t('monthly'), window: usage === null ? null : usage.monthly, now, t }),
              ),
      )
    }
    //#endregion

    //#region component
    /** The dock reading: collapsed mini bar + 5-hour percent, hover/focus panel with all windows. */
    function QuotaIndicator({ t }) {
      const { state, refresh } = useQuota()
      const [open, setOpen] = React.useState(false)
      const [pinned, setPinned] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const closeTimerRef = React.useRef(null)
      /** Set while focus returns to the trigger after Escape, so that focus does not re-open the panel. */
      const suppressFocusRef = React.useRef(false)
      const panelId = React.useId()
      const position = usePanelPosition(open, triggerRef, panelRef, `${state.status}:${state.fetchedAt}`)

      const clearCloseTimer = React.useCallback(() => {
        if (closeTimerRef.current !== null) {
          clearTimeout(closeTimerRef.current)
          closeTimerRef.current = null
        }
      }, [])

      const closeNow = React.useCallback(() => {
        clearCloseTimer()
        setOpen(false)
        setPinned(false)
      }, [clearCloseTimer])

      const scheduleClose = React.useCallback(() => {
        clearCloseTimer()
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null
          setOpen(false)
          setPinned(false)
        }, CLOSE_DELAY_MS)
      }, [clearCloseTimer])

      const openNow = React.useCallback(() => {
        clearCloseTimer()
        setOpen(true)
      }, [clearCloseTimer])

      React.useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

      // Countdown text stays honest while the panel is open.
      React.useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 30000)
        return () => clearInterval(timer)
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            suppressFocusRef.current = true
            clearCloseTimer()
            setOpen(false)
            setPinned(false)
            const trigger = triggerRef.current
            if (trigger !== null && typeof trigger.focus === 'function') trigger.focus()
            window.setTimeout(() => {
              suppressFocusRef.current = false
            }, 0)
          }
        }
        const onPointerDown = (event) => {
          const target = event.target
          const root = rootRef.current
          const panel = panelRef.current
          if (root !== null && root.contains(target)) return
          if (panel !== null && panel.contains(target)) return
          closeNow()
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open, closeNow])

      const usage = state.usage
      const rolling = usage === null ? null : usage.rolling
      const percent = rolling === null ? null : Math.round(rolling.percent)
      const ariaLabel = percent === null ? t('unavailable') : t('aria', { percent: `${percent}%` })
      const statusKey = state.status === 'ready' ? 'ready' : state.status === 'unavailable' ? 'unavailable' : state.status

      const panel =
        open && typeof document !== 'undefined'
          ? ReactDOM.createPortal(
              h(
                'div',
                {
                  ref: panelRef,
                  id: panelId,
                  className: 'ogq-panel',
                  role: 'dialog',
                  'aria-label': t('title'),
                  'data-opencode-go-quota-panel': '',
                  style:
                    position === null
                      ? { visibility: 'hidden', left: 0, top: 0 }
                      : { left: `${position.left}px`, top: `${position.top}px` },
                  onPointerEnter: openNow,
                  onPointerLeave: () => {
                    if (!pinned) scheduleClose()
                  },
                  onFocus: openNow,
                  onBlur: (event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return
                    if (!pinned) scheduleClose()
                  },
                },
                h(QuotaPanelBody, { t, state, refresh, now }),
              ),
              document.body,
            )
          : null

      return h(
        Fragment,
        null,
        h(
          'span',
          {
            ref: rootRef,
            className: 'ogq-root',
            'data-opencode-go-quota': '',
            'data-state': statusKey,
          },
          h(
            'button',
            {
              ref: triggerRef,
              type: 'button',
              className: 'ogq-trigger',
              'data-composer-stat': 'opencode-go-quota',
              'data-state': statusKey,
              'aria-label': ariaLabel,
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-controls': open ? panelId : undefined,
              onPointerEnter: openNow,
              onPointerLeave: () => {
                if (!pinned) scheduleClose()
              },
              onFocus: () => {
                if (suppressFocusRef.current) return
                openNow()
              },
              onBlur: (event) => {
                const next = event.relatedTarget
                if (panelRef.current !== null && next !== null && panelRef.current.contains(next)) return
                if (!pinned) scheduleClose()
              },
              onClick: () => {
                if (pinned) {
                  closeNow()
                } else {
                  clearCloseTimer()
                  setPinned(true)
                  setOpen(true)
                }
              },
            },
            h(
              'span',
              { className: 'ogq-bar', 'aria-hidden': true },
              h('span', { className: 'ogq-bar-fill', style: { width: `${percent === null ? 0 : percent}%` } }),
            ),
            h('span', { className: 'ogq-percent' }, percent === null ? DASH : `${percent}%`),
          ),
        ),
        panel,
      )
    }

    /** Dock row wrapper: renders nothing unless the Session's model is an OpenCode Go one. */
    function QuotaDockRow({ directory, t }) {
      const config = React.useSyncExternalStore(configStore.subscribe, configStore.getSnapshot, configStore.getSnapshot)
      const selection = useDirectorySelection(directory === undefined ? null : directory)
      if (selection === null || typeof selection !== 'object') return null
      const current = selection.current
      if (current === null || typeof current !== 'object') return null
      if (typeof current.provider !== 'string' || current.provider.length === 0) return null
      if (config.providers.indexOf(current.provider) === -1) return null
      return h(QuotaIndicator, { t })
    }
    //#endregion

    //#region plugin
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'opencode-go-quota: locale')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const existing = document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`)
        if (existing !== null) return () => {}
        const style = document.createElement('style')
        style.dataset.plugin = PLUGIN_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'opencode-go-quota: styles')

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.composer.dock', function* () {
            yield ctx.slots.register(
              {
                name: 'conversation.composer.dock',
                id: 'opencode-go-quota',
                order: 2,
                locale: NS,
                inject: (sessionId) => {
                  let directory = null
                  try {
                    directory = ctx.modelDirectories.directoryFor(sessionId).store
                  } catch (error) {
                    directory = null
                  }
                  return { directory }
                },
              },
              QuotaDockRow,
            )
          }),
        'opencode-go-quota: composer dock',
      )
    }

    return {
      inject: ['slots', 'locale', 'modelDirectories'],
      apply,
    }
  },
})
