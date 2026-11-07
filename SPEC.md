# Opencode Go 额度显示插件 — 实现规范 (SPEC)

本文档是唯一权威契约。所有实现必须遵守此处冻结的接口、文件名与行为；有分歧先找 Lead 确认，不要各自发挥。

## 目标

DSH Web 会话页面底部输入框下方的统计条（`data-composer-dock`）里，位于「上下文窗口」百分比环的**右侧**，新增一个开小型额度指示器：

- 仅当当前会话选中的模型属于 OpenCode Go 订阅（provider ∈ 配置列表）时显示。
- 默认折叠：一条短横线（迷你进度条）+ 五小时窗口用量百分比；无数据时显示 `—`。
- 鼠标悬停 / 键盘聚焦时展开浮层，显示 5 小时、每周、每月三个窗口的百分比（带各自重置倒计时）。
- 视觉与 ContextMeter（上下文窗口环）完全同族：同一套 `--dsw-*` token、字号、圆角、hover 背景、面板阴影。

> 位置实现要点：`conversation.composer.dock` 槽位的 outlet 锚点使用 `display: contents`，条目是 dock flex 容器的直接 flex 项；ContextMeter 是槽位之后渲染的最后一个 flex 项。因此注册 order=2（在槽位内排在 usage 之后）只决定槽位内部顺序，要放到 ContextMeter 右侧需给根元素加 CSS `order: 1`（默认为 0），使它在视觉顺序上排到最后。不要用 `order` 值改槽位内排序。

## 包信息

- 目录：仓库根目录 `opencode-go-quota/`
- npm 包名：`dsh-opencode-go-quota`；Cordis 插件 id：`opencode-go-quota`；浏览器模块 id 同包名。
- 文件（本 spec 冻结）：
  - `package.json`（Lead）
  - `cordis.patch.yml`（Lead）
  - `index.js`（host 插件，ESM，`host-api` 负责）
  - `client.js`（浏览器 bundle，`window.__ModuleLoader__.load({id, factory})`，`client-ui` 负责）
  - `README.md`、`icon.svg`（Lead）
  - `test/`（验证脚本，`verifier` 负责；不进入发布 files 也可）
- 不引入构建步骤：client.js 手写 CJS-in-factory，用 `require('react')` / `require('react-dom')` / `require('@deepseek-ai/dsh-client-ui-primitives')`，JSX 用 `React.createElement`（别名 `h`）。可参考 DSH 生态中手写客户端 bundle 的公开插件（如 dsh-opencode-go）或 DSH 自带包 `@deepseek-ai/dsh-client-ui-conversation` 的 bundle 形态。

## 数据来源（已实测可用）

Host 用凭据 `OPENCODE_GO_API_KEY`（可通过 `ctx.credentials.resolve(credentialRef(...))` 拿到）请求：

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <key>
Accept: application/json
```

实测响应（HTTP 200）：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 1, "resetsAt": "2026-11-07T08:08:39Z" },
    "weekly":  { "status": "ok", "percent": 0, "resetsAt": "2026-11-09T00:00:00Z" },
    "monthly": { "status": "ok", "percent": 0, "resetsAt": "2026-12-06T12:31:44Z" }
  }
}
```

- `percent` 为 0–100 的数；`resetsAt` 为 ISO 时间；`status` 为字符串（`ok` 等）。
- 该 URL 同时被 `https://opencode.ai/inference/go/v1/usage` 接受；默认用 zen 那个。
- 5 小时窗口 = `rolling`。

## Host 契约（index.js）

```js
export const name = 'opencode-go-quota'
export const inject = ['webServer', 'credentials']
export function apply(ctx, config = {})
```

配置字段（全部可选，做类型/范围校验，非法值回退默认）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `'OPENCODE_GO_API_KEY'` | 凭据引用名 |
| `baseURL` | `'https://opencode.ai/zen/go/v1'` | 网关根，拼接 `/usage` |
| `providers` | `['opencode-go', 'dsh-opencode-go']` | 视为“Go 订阅”的 provider id 列表（下发给浏览器） |
| `pollMs` | `60000` | 建议浏览器轮询周期（下发给浏览器） |
| `cacheMs` | `20000` | Host 缓存 TTL |
| `timeoutMs` | `10000` | 上游请求超时 |

注册前缀路由 `ctx.webServer.register({ kind: 'prefix', path: '/api/opencode-go-quota', handler })`（用 `ctx.effect(() => ctx.webServer.register(...), '...')`）。

### `GET /api/opencode-go-quota/usage`

查询参数：`refresh=1` 时绕过 Host 缓存。

成功（HTTP 200，`cache-control: no-store`）：

```json
{
  "ok": true,
  "usage": { "rolling": {...}, "weekly": {...}, "monthly": {...} },
  "fetchedAt": 1762488000000,
  "config": { "providers": ["opencode-go","dsh-opencode-go"], "pollMs": 60000, "label": "OpenCode Go" }
}
```

失败（HTTP 200，客户端按 `ok:false` 处理；**不要**把 key 放进任何响应/日志）：

```json
{ "ok": false, "error": { "code": "opencode-go-quota/usage-unavailable", "message": "人类可读、已脱敏", "retryable": true },
  "config": { ... } }
```

错误码：`missing-credential`（不可重试）、`usage-unavailable`（HTTP 非 2xx / 网络 / 超时，可重试）、`invalid-response`（结构校验失败，可重试）。

其他注意：

- 未知子路径 → HTTP 404 `{ok:false,error:{code:'not-found',...}}`；仅接受 GET。
- 上游错误分类：401/403 → 提示检查 key 与订阅权限（不可重试）；429/5xx → 可重试。
- 不要在模块顶层发请求；首个请求按需触发。缓存按 `apiKeyEnv + baseURL` 隔离（单实例即可，但 key 变化要视为失效）。
- 结构校验：`usage` 为对象，`rolling/weekly/monthly` 每项 `percent` 为 0–100 有限数、`resetsAt` 可 `Date.parse`、`status` 为字符串；不满足 → `invalid-response`。
- 校验通过后原样透传三个窗口对象（保留 status/resetsAt）。
- 不引入新的运行时依赖（Node 内置 fetch / AbortSignal.timeout）。

## 浏览器契约（client.js）

### 模块骨架

```js
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-quota',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch { primitives = null }
    // ... 组件与 apply
    return { inject: ['slots', 'locale', 'modelDirectories'], apply }
  },
})
```

- **不要**在 factory 顶层做副作用（CSS 注入等放进 `apply`，并用 `ctx.effect` 清理）。
- `apply(ctx)` 中：
  - `ctx.locale.register(NS, { zh, en })`，`NS = 'opencodeGoQuota'`，`const t = ctx.locale.bind(NS)`；字典内置在 client.js 中。
  - 注入 `<style data-plugin="dsh-opencode-go-quota">`，`ctx.effect` 卸载时移除。
  - 注册 dock 行（见下）。

### 槽位注册

```js
ctx.effect(() => ctx.slots.inject('conversation.composer.dock', function* () {
  yield ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'opencode-go-quota',
    order: 2,                 // 槽位内排在 usage(1) 之后；要显示在 ContextMeter 右侧需 CSS `order: 1`（见上）
    locale: NS,
    inject: (sessionId) => {
      let directory = null
      try { directory = ctx.modelDirectories.directoryFor(sessionId).store } catch { directory = null }
      return { directory }
    },
  }, QuotaIndicator)
}), 'opencode-go-quota: composer dock')
```

- dock 条目 props：`inject` 返回值 + 标准 props（含 `t`）。`directory` 是 snapshot store：`directory.subscribe(listener)`、`directory.getSnapshot()`；快照 `{ current: { provider, model, reasoningEffort? }, groups, ... } | null`。
- `current.provider` 是否在 `config.providers`（来自 host 路由响应；未取到前用内置默认 `['opencode-go','dsh-opencode-go']`）决定是否渲染。
- 用 `React.useSyncExternalStore(directory.subscribe, directory.getSnapshot)` 订阅；`directory === null` 或 provider 不匹配 → `return null`。

### 组件行为

状态：`idle/loading` → 折叠显示 `—`；`ready` → 折叠显示 `[短横线进度条] {rolling.percent}%`；`error` → 折叠显示 `—`（tooltip 显示错误摘要，可点击重试）。

折叠触发器（button）：

- 内容：`<span class="ogq-bar"><span class="ogq-fill" style="width:{p}%"/></span><span>{p}%</span>`。
- 视觉 = ContextMeter 的 trigger：`color: var(--dsw-alias-label-tertiary)`、`font-size: var(--dsh-content-font-size-secondary,13px)`、`line-height: calc(20px + var(--dsh-content-font-delta-secondary,0px))`、`font-variant-numeric: tabular-nums`、`padding: 1px 8px`、`border-radius: var(--dsw-radius-sm)`、`gap: 6px`、透明背景无边框；hover / `[aria-expanded="true"]`：`background: var(--dsw-alias-interactive-bg-hover)`、`color: var(--dsw-alias-label-secondary)`。
- 进度条：宽 20px、高 4px、`border-radius: 999px`、底 `var(--dsw-alias-border-l3)`、填充 `currentColor`；百分比越高可保持同色（v1 不换色），`percent >= 100` 时填充用 `var(--dsw-alias-label-secondary)`。
- `aria-label` = `t('aria', { percent })`，例如「OpenCode Go 五小时额度已用 12%」；`aria-haspopup="dialog"`、`aria-expanded`。
- 根元素 `<span class="ogq-root" style="position:relative; display:inline-flex; flex:none">`，并带 `data-opencode-go-quota` 便于排查。

展开浮层（hover / focus / 点击固定）：

- 鼠标 enter 打开；panel 进入也保持；pointer leave 延迟约 120ms 关闭（允许从触发器移入 panel）。focus 打开，blur 且焦点不在 panel 内时关闭。Escape 关闭。点击触发器切换“固定开启”；固定时外部 pointerdown/click 关闭。
- 渲染：优先 `ReactDOM.createPortal` 到 `document.body`，用 primitives 的 `useAnchoredPosition({ open, anchorRef, panelRef, side: 'top', gap: 8, margin: 12 })` 与 `useDismissOnOutsidePointer(...)`（签名参考 ContextMeter 用法）。若 primitives 不可用，退化：`position: fixed` 自算 `getBoundingClientRect()`，`left = rect.left`、上边贴 `rect.top - panelH - 8`（可用 `bottom` 近似）。
- 面板样式（与 ContextMeter `.panel` 同族）：`z-index: 1100`、`position: fixed`、`box-sizing: border-box`、`border-radius: var(--dsw-radius-lg)`、`background: var(--dsw-specific-menu)`、`backdrop-filter: var(--dsw-menu-backdrop-filter)`、`box-shadow: var(--dsw-elevation-prominent)`、`border: 0`、`padding: 12px`、`font-size: 12px`、`line-height: 20px`、`width: min(300px, calc(100vw - 24px))`、`color: var(--dsw-alias-label-secondary)`、`max-width: var(--dsh-anchored-max-width, none)`、`max-height: var(--dsh-anchored-max-height, none)`、`overflow: hidden auto`。
- 面板内容：
  - 标题行：左侧 `t('title')`（`OpenCode Go quota`），右侧当前 Rolling 百分比（`var(--dsw-alias-label-primary)`，font-weight 500）。
  - 三行（`Rolling` / `Weekly` / `Monthly`，见下方「文案」）：三行共用一个 grid（`.ogq-rows` 为 grid，`.ogq-row` 为 `display: contents`），三列 = 周期标签（固定 62px）+ 用量组（`max-content`）+ 刷新/重置时间（`1fr`，左对齐）。**用量组是一个 flex 容器，4px 迷你进度条（固定 48px 轨道）与用量百分比以 6px 间距紧邻**，条与数字始终挨在一起、三行左缘对齐；刷新/重置时间列左对齐，三行起点一致。用量与刷新时间是两个独立单元格，**不使用「·」拼接**。数字列一律 `tabular-nums`，百分比 `var(--dsw-alias-label-primary)`、重置时间 `var(--dsw-alias-label-tertiary)`。
  - 倒计时统一英文紧凑单位：`Resets in 29d 0h` / `1d 12h` / `4h 54m` / `12m` / `<1m`（天/时可出现 0：29d 0h）。中文标签与中文单位会导致各行列宽参差，因此**面板可见文本固定英文**，`aria-label` 仍按界面语言本地化。
  - 失败时显示错误摘要 + 重试按钮（文字次要色，hover 变色），替代三行内容；此时标题行右侧读数显示 `—`，不回显上一次的陈旧百分比。
- 关闭后焦点回到触发器（不做也行，但不要报错）。

### 数据获取（浏览器侧）

- 首次挂载立即 `fetch('/api/opencode-go-quota/usage', { cache: 'no-store' })`；之后按 host 下发的 `config.pollMs`（默认 60000）轮询；`document.visibilityState === 'hidden'` 时跳过，`visibilitychange` 回前台立即刷新。
- 模型切换到 Go provider 或会话切换（sessionId 变化）时重新拉取（重新挂载即可）。
- 404（host 未启用）或 `fetch` 网络错误 → 视为不可用：折叠显示 `—`，**不要**抛错、不要 console.error 刷屏（可 console.debug 一次）。
- 响应 `ok:false` → error 态；`error.retryable` 为 true 时继续按周期重试，false 时停止轮询仅显示 `—`（可点击重试）。
- 覆盖 `config.providers` / `config.pollMs` 到本地模块级状态，供订阅组件读取。
- 卸载时 clearInterval/removeEventListener/abort。

### 文案（zh / en）

面板可见文本固定英文（布局对齐需要），`aria-label` 随界面语言本地化。

| key | zh | en |
| --- | --- | --- |
| `aria` | `OpenCode Go 五小时额度已用 {percent}` | `OpenCode Go 5-hour quota {percent} used` |
| `title` | `OpenCode Go quota` | `OpenCode Go quota` |
| `rolling` | `Rolling` | `Rolling` |
| `weekly` | `Weekly` | `Weekly` |
| `monthly` | `Monthly` | `Monthly` |
| `resetIn` | `Resets in {time}` | `Resets in {time}` |
| `unavailable` | `Quota unavailable` | `Quota unavailable` |
| `loading` | `Loading quota…` | `Loading quota…` |
| `retry` | `Retry` | `Retry` |

倒计时格式（英文单位，含下一个更小单位）：`29d 0h` / `1d 12h` / `4h 54m` / `12m` / `<1m`。

## 样式与排查要求

- 所有 class 前缀 `ogq-`；根元素 `data-opencode-go-quota`；触发器 `data-composer-stat="opencode-go-quota"`（与 dock 其他控件一致，便于样式/测试）。
- 只使用主题 token，不写死颜色（进度条可用 `currentColor`）。
- 无全局副作用泄漏；重复 enable/disable 后 DOM 中最多一个 style 标签、一个 dock 行。

## 安装与验证（Lead 负责安装）

1. 打包完成后用 `plugin_manager` 的 `install_bundle` 以 `link:<绝对路径>` 安装 `dsh-opencode-go-quota` 并启用（HMR 会热应用；如报告 restart-required 再让用户重启 DSH）。
2. 验证：
   - `dsh --profile desktop --dump-config` 输出包含 `opencode-go-quota` 行。
   - `plugin_manager` 列表显示该 bundle `installed/enabled`、rowId `opencode-go-quota`。
   - verifier 的隔离 `dsh web` e2e：boot 图含该模块行；`/plugins/dsh-opencode-go-quota/client.js` 可下载且语法可加载；`/api/opencode-go-quota/usage` 返回真实百分数。
   - jsdom 渲染测试：默认折叠、悬停展开三行、provider 不匹配不渲染。
3. 最终由用户在 GUI 目测确认样式与位置。

