# dsh-opencode-go-quota

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 提供 OpenCode Go 订阅额度显示的小插件。

[English](./README.en.md) | 中文

在会话输入框下方的统计条里，位于「上下文窗口」百分比环的**右侧**，常驻一枚额度指示器：

- 只有当前会话选中的模型属于 OpenCode Go 订阅（provider 为 `opencode-go` 或 `dsh-opencode-go`）时才显示；切到其它 provider 自动隐藏。
- 折叠时显示一条迷你进度条 + **5 小时滚动（Rolling）** 窗口的已用百分比；加载中 / 不可用时显示 `—`。
- 鼠标悬停（或键盘聚焦、点击固定）展开浮层，列出 **Rolling / Weekly / Monthly** 三个窗口：周期、用量（固定 48px 进度条 + 紧挨着的百分比）、刷新时间（左对齐，与用量组间隔 16px）各成一列并在三行间对齐；浮层宽度随内容自适应（300–340px），右侧不留空白。英文紧凑格式，如 `Resets in 4h 54m`。
- 视觉与原生「上下文窗口」指示器同族：同一套主题 token、字号、圆角、悬停背景与浮层阴影，跟随明暗主题；位置随语言/会话布局自适应。
- Key 只在 Host 使用，浏览器只拿到百分比和重置时间。

## 安装

前置：DSH `0.2.2` 及以上（桌面端已验证 `0.2.2-rc.1`），并已配置 OpenCode Go 的 API Key（DSH 凭据名默认 `OPENCODE_GO_API_KEY`）。

### 方式 A：DSH 插件页安装（推荐）

1. 打开 DSH → **插件** → **添加插件**。
2. 填入 GitHub 仓库地址：`https://github.com/tiamo-Li/dsh-opencode-go-quota`
3. 安装完成后点击 **立即启用**。开启 HMR 时页面即时生效；否则刷新页面 / 重启 DSH。

### 方式 B：命令行

```powershell
# 任选一种 spec
dsh plugin --profile desktop add github:tiamo-Li/dsh-opencode-go-quota
dsh plugin --profile desktop add https://github.com/tiamo-Li/dsh-opencode-go-quota
```

安装后到 **插件** 页启用该组合包（或在 profile 的 `cordis.patch.yml` 中启用）。

### 配置 API Key

插件默认读取 DSH 凭据引用 `OPENCODE_GO_API_KEY`（与 DSH 原生 pi-ai 的 `opencode-go` 路由一致）：

- 已在用原生 `opencode-go` provider 的用户无需额外配置；
- 否则在 DSH 凭据设置中保存该名的 Key，或用启动环境变量 `OPENCODE_GO_API_KEY=...`。

## 配置

插件行的默认配置来自本包的 `cordis.patch.yml`，可在自己的 profile patch 中按 `id: opencode-go-quota` 覆盖：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | DSH 凭据 seam 引用名 |
| `baseURL` | `https://opencode.ai/zen/go/v1` | OpenCode 网关根地址，插件请求 `${baseURL}/usage` |
| `providers` | `["opencode-go", "dsh-opencode-go"]` | 视为「OpenCode Go 订阅」的 provider id；命中的模型才显示 |
| `pollMs` | `60000` | 浏览器轮询周期（页面隐藏时暂停，回前台立即刷新） |
| `cacheMs` | `20000` | Host 侧短缓存，避免多会话重复请求上游 |
| `timeoutMs` | `10000` | 上游请求超时 |

示例（profile 的 `cordis.patch.yml`）：

```yaml
- id: opencode-go-quota
  name: dsh-opencode-go-quota
  config:
    pollMs: 30000
    providers:
      - opencode-go
```

## 数据来源与隐私

- Host 使用 `apiKeyEnv` 指向的 OpenCode API Key 请求官方额度接口 `GET {baseURL}/usage`，读取 `usage.rolling / usage.weekly / usage.monthly`（`percent`、`resetsAt`、`status`）。
- Key 只留在 Host；响应与日志均不含 Key。浏览器只收到三个窗口的数值、重置时间，以及可见 provider 列表与轮询周期。
- 请求失败时降级为 `—`，不会伪造用量；可点浮层里的重试按钮手动刷新。
- 除 OpenCode 官方额度接口外，插件不向任何第三方发请求。
- 额度接口由 DSH 本机 Web 服务提供（仅监听 loopback 地址）；同一台机器上的其它进程理论上可读取这些聚合百分比，但拿不到 API Key，也不涉及会话内容。

## 排障

- **看不到指示器**：确认当前会话模型属于 `providers` 中的 provider（原生 pi-ai 路由 id 为 `opencode-go`，Duskriver 插件为 `dsh-opencode-go`）；确认插件已启用、`OPENCODE_GO_API_KEY` 已配置。
- **一直显示 `—`**：多为 Key 无效、无 Go 订阅权限或网关不可达；悬浮浮层可看到错误摘要并手动重试。
- **升级后不生效**：刷新页面；仍不生效则完全退出 DSH 后重新打开。
- **位置/样式异常**：插件依赖 DSH 原生 composer dock 布局（`display: contents` 槽位 + flex 顺序）。若未来 DSH 大版本改动布局，可用 CSS `order` 或调整 `client.js` 里的 slot 注册适配。

## 开发与测试

- 无构建步骤：`index.js` 是 ESM Host 插件；`client.js` 是手写浏览器 bundle（`window.__ModuleLoader__.load`，CJS factory，`require('react')`）。
- 契约与实现细节见 [SPEC.md](./SPEC.md)。

```bash
pnpm install            # 仅安装测试用 devDependencies（jsdom / react / react-dom）
node test/host-unit.mjs # Host 单测（mock ctx + mock fetch）
node test/client-smoke.mjs  # 浏览器 bundle 结构与注册冒烟
node test/client-render.mjs # jsdom + React 真实 DOM 渲染/交互断言
```

目录结构：

```text
.
├── index.js           Host：凭据解析 + /api/opencode-go-quota/usage 路由（20s 缓存）
├── client.js          浏览器：conversation.composer.dock 额度指示器（折叠 / 悬停展开 / 轮询）
├── cordis.patch.yml   bundle 层：插入 opencode-go-quota 插件行与默认配置
├── locale/            插件页展示文案（zh / en）
├── test/              单测与 DOM 渲染测试
└── SPEC.md            实现规范
```

## 许可

[MIT](./LICENSE) © 2026 tiamo-Li

本插件与 OpenCode / DeepSeek 官方无隶属关系，仅调用用户自己账号的额度接口。
