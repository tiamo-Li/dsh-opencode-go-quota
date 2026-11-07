# dsh-opencode-go-quota

A small [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that shows your OpenCode Go subscription quota.

中文 | [English](./README.en.md)

It adds a quota indicator to the composer dock (the stats row below the message input), **to the right of the context-window ring**:

- Only visible when the session's selected model belongs to OpenCode Go (`opencode-go` or `dsh-opencode-go`); hidden for every other provider.
- Collapsed: a mini progress bar plus the **5-hour rolling** window usage percentage; `—` while loading or unavailable.
- Hover (or focus, or click to pin) to expand a panel with **Rolling / Weekly / Monthly**: each row shows the window, the usage (bar + percentage kept together) and the reset countdown in aligned columns (e.g. `Resets in 4h 54m`).
- Same visual language as the native context-window meter: shared theme tokens, font size, radii, hover background and panel elevation, following light/dark mode.
- The API key stays in the Host; the browser only receives percentages and reset times.

## Install

Requirements: DSH `0.2.2`+ (verified on `0.2.2-rc.1`) and an OpenCode Go API key (credential reference `OPENCODE_GO_API_KEY` by default).

### Option A — DSH plugin page (recommended)

1. Open DSH → **Plugins** → **Add plugin**.
2. Enter the repository URL: `https://github.com/tiamo-Li/dsh-opencode-go-quota`
3. After it installs, click **Enable**. With file watching (HMR) the page updates immediately; otherwise refresh the page / restart DSH.

### Option B — CLI

```powershell
dsh plugin --profile desktop add github:tiamo-Li/dsh-opencode-go-quota
# or
dsh plugin --profile desktop add https://github.com/tiamo-Li/dsh-opencode-go-quota
```

Then enable the bundle on the **Plugins** page (or in the profile `cordis.patch.yml`).

### API key

The plugin reads the DSH credential reference `OPENCODE_GO_API_KEY` (the same reference the native pi-ai `opencode-go` route uses):

- If you already use the native `opencode-go` provider, nothing else is needed.
- Otherwise store that key in DSH credentials, or launch DSH with `OPENCODE_GO_API_KEY=...`.

## Configuration

Defaults live in this package's `cordis.patch.yml`; override them in your profile patch under `id: opencode-go-quota`:

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | DSH credential reference |
| `baseURL` | `https://opencode.ai/zen/go/v1` | OpenCode gateway root; the plugin calls `${baseURL}/usage` |
| `providers` | `["opencode-go", "dsh-opencode-go"]` | Provider ids treated as the Go subscription |
| `pollMs` | `60000` | Browser poll cadence (paused while the page is hidden) |
| `cacheMs` | `20000` | Host-side short cache |
| `timeoutMs` | `10000` | Upstream request timeout |

Example:

```yaml
- id: opencode-go-quota
  name: dsh-opencode-go-quota
  config:
    pollMs: 30000
    providers:
      - opencode-go
```

## Data and privacy

- The Host calls the official quota endpoint `GET {baseURL}/usage` with the configured key and reads `usage.rolling / usage.weekly / usage.monthly` (`percent`, `resetsAt`, `status`).
- The key never leaves the Host; responses and logs contain no key. The browser only receives the three window readings, reset times, the visible provider list and the poll cadence.
- On failure the indicator degrades to `—` instead of inventing numbers; the expanded panel offers a manual retry.

## Troubleshooting

- **No indicator**: check the session model belongs to one of `providers` (native pi-ai route id is `opencode-go`; the Duskriver plugin uses `dsh-opencode-go`) and that the plugin is enabled with `OPENCODE_GO_API_KEY` configured.
- **Always `—`**: usually an invalid key, no Go subscription, or an unreachable gateway; hover the panel for the error summary and retry.
- **Updates not visible**: refresh the page; if that does not help, fully quit and reopen DSH.

## Development

- No build step: `index.js` is an ESM Host plugin; `client.js` is a hand-written browser bundle (`window.__ModuleLoader__.load`, CJS factory, `require('react')`).

```bash
pnpm install                  # dev-only test dependencies (jsdom / react / react-dom)
node test/host-unit.mjs       # Host unit tests (mock ctx + mock fetch)
node test/client-smoke.mjs    # bundle structure / slot registration smoke test
node test/client-render.mjs   # jsdom + React DOM render & interaction assertions
```

See [SPEC.md](./SPEC.md) for the implementation contract.

## License

[MIT](./LICENSE) © 2026 tiamo-Li

Not affiliated with OpenCode or DeepSeek; the plugin only calls the quota endpoint for your own account.
