# Browser Tool 原理与实现

本文结合源码说明仓库内 `browser_tool` 的运行机制。注意这里有两个相关入口：

- 真正运行时工具：`browser_tool`
- 辅助 CLI：`bun run browser-tool`

`scripts/browser-tool.ts` 只是模板和调试入口，不负责真实浏览器执行。它只做 command discovery、JSON template 和 URL 解析，真实执行仍然走 session 内的 native browser tools。

相关源码：

- `scripts/browser-tool.ts`
- `package.json`

## 总体架构

调用链如下：

```text
模型调用 browser_tool
  -> packages/shared/src/agent/browser-tools.ts
  -> packages/shared/src/agent/browser-tool-runtime.ts
  -> BrowserPaneFns 抽象接口
  -> packages/server-core/src/sessions/SessionManager.ts 绑定具体实现
  -> apps/electron/src/main/browser-pane-manager.ts
  -> apps/electron/src/main/browser-cdp.ts
  -> Electron BrowserWindow / BrowserView / webContents.debugger / CDP
```

`browser_tool` 是一个 session-scoped tool。它对外只暴露一个工具名，参数是：

```ts
command: string | string[]
```

例如：

```text
snapshot
click @e12
fill @e5 user@example.com
["evaluate", "document.title"]
```

工具定义在 `packages/shared/src/agent/browser-tools.ts`。这个文件不直接依赖 Electron，而是依赖 `BrowserPaneFns` 接口。`BrowserPaneFns` 定义了浏览器能力集合，例如：

- `openPanel`
- `navigate`
- `snapshot`
- `click`
- `fill`
- `select`
- `screenshot`
- `waitFor`
- `evaluate`
- `releaseControl`
- `closeWindow`

这让 shared 层只关心“浏览器能力”，不关心底层是 Electron、测试替身还是其他实现。

## 为什么统一成 `browser_tool`

当前 canonical tool 是 `browser_tool`。旧的拆分工具名如 `browser_open`、`browser_snapshot`、`browser_click` 仍有兼容逻辑，但主要运行时入口已经统一。

这样设计有几个直接收益：

- 工具 schema 简单，只有一个入口。
- 命令解析、批处理、错误提示集中在一处。
- 支持 string mode 和 array mode。
- array mode 可以保留分号、换行和 tab，避免被字符串 tokenizer 误拆。

命令解析在 `packages/shared/src/agent/browser-tool-runtime.ts`：

- 如果 `command` 是数组，直接作为 token parts 执行。
- 如果是字符串，先 `trim`，再按分号拆 batch。
- batch 遇到导航类命令会停止，因为页面状态可能已经改变。
- `executeSingleCommand` 根据第一个 token 分派到具体命令。

例如：

```text
fill @e1 user@example.com; fill @e2 password; click @e3
```

会顺序执行，但遇到 `click` 这类可能改变页面的命令后停止，提示重新 snapshot。

## Session 绑定

`browser_tool` 本身不知道 Electron 窗口在哪里。它只拿到 `BrowserPaneFns`。真正把接口接到 Electron 的地方是 `packages/server-core/src/sessions/SessionManager.ts`。

会话启动后，如果存在 `browserPaneManager`，`SessionManager` 会把一组 browser callbacks merge 到当前 session callbacks 中：

```ts
mergeSessionScopedToolCallbacks(sid, {
  browserPaneFns: {
    openPanel: ...,
    navigate: ...,
    snapshot: ...,
    click: ...,
    fill: ...,
  }
})
```

核心解析函数类似：

```ts
const instanceId = bpm.createForSession(sid, { show: options?.show ?? false })
```

也就是说，每次执行浏览器命令时，都会解析当前 session 对应的 browser instance：

- 已有绑定窗口：复用
- 没有绑定窗口但有未绑定 manual window：复用并绑定
- 都没有：创建新窗口

随后命令只是薄转发：

- `snapshot` -> `bpm.getAccessibilitySnapshot(instanceId)`
- `click` -> `bpm.clickElement(instanceId, ref, options)`
- `fill` -> `bpm.fillElement(instanceId, ref, value)`
- `screenshot` -> `bpm.screenshot(instanceId, options)`
- `waitFor` -> `bpm.waitFor(instanceId, options)`

`browser_tool` 是否启用由 `browserToolEnabled` 控制。默认启用，也可以禁用内置浏览器工具，改用 Playwright 或 Puppeteer。

相关源码：

- `packages/shared/src/agent/session-scoped-tools.ts`
- `packages/shared/src/config/storage.ts`
- `packages/server-core/src/sessions/SessionManager.ts`

## Electron 窗口模型

真正浏览器实例由 `apps/electron/src/main/browser-pane-manager.ts` 管理。

`BrowserPaneManager` 维护：

```ts
private instances: Map<string, BrowserInstance> = new Map()
```

每个 `BrowserInstance` 包含：

- `BrowserWindow`
- `toolbarView`
- `pageView`
- `nativeOverlayView`
- `BrowserCDP`
- 当前 URL、标题、favicon、加载状态
- session 绑定信息
- console/network/download logs
- 最近一次 browser action
- agent control overlay 状态

创建实例时，它不是简单打开普通浏览器窗口，而是创建一个 frameless `BrowserWindow`，再挂多个 `BrowserView`：

- `toolbarView`：浏览器工具栏
- `pageView`：真实网页
- `nativeOverlayView`：agent 控制 overlay

所有浏览器窗口共享 `persist:browser-pane` partition，所以 cookie 和 session 是持久共享的。

session 与窗口的绑定策略：

1. 优先复用当前 session 已绑定窗口。
2. 没有则复用未绑定 manual window。
3. 再没有才创建新窗口。
4. `open --foreground` 会 focus，后台命令默认不弹窗。

这就是为什么模型可以连续执行：

```text
snapshot
click @e12
fill @e5 value
```

而不需要每次传 window id。

## CDP 和 `@eN` ref

最关键的底层实现是 `apps/electron/src/main/browser-cdp.ts`。

它使用 Electron 的 `webContents.debugger` 连接 Chrome DevTools Protocol：

- `Accessibility.getFullAXTree` 生成 accessibility tree。
- 从 tree 中筛出可交互或有意义的节点。
- 给每个 DOM backend node 分配稳定 ref，如 `@e1`、`@e2`。
- `refMap` 保存 `@eN -> backendDOMNodeId`。
- 后续 `click`、`fill`、`select` 都靠这个 ref 回到真实 DOM 节点。

核心状态：

```ts
private refMap: Map<string, number> = new Map()
private refDetails: Map<string, { role: string; name: string }> = new Map()
private backendNodeRefMap: Map<number, string> = new Map()
private nextRefCounter = 0
```

snapshot 返回的不是 DOM selector，而是 accessibility-level 元素列表：

```text
@e12 [button] "Submit"
@e15 [textbox] "Email"
```

这种方式比让模型猜 CSS selector 更稳定，因为模型操作的是语义元素，而不是页面结构细节。

snapshot 过滤策略包括：

- 保留 interactive roles，例如 button、link、textbox、checkbox、tab、option。
- 保留有内容价值的 roles，例如 heading、img、table、dialog、alert。
- 丢弃大量无 name 的 generic/none 噪声节点。
- 最多保留 500 个 accessibility nodes。
- 如果主过滤结果为空，会尝试 fallback candidates。

## 点击、输入、选择

`click @e12` 的流程：

```text
@e12
  -> refMap 找 backendDOMNodeId
  -> DOM.resolveNode
  -> scrollIntoViewIfNeeded
  -> DOM.getBoxModel 算中心点
  -> webContents.sendInputEvent 发送 mouseDown/mouseUp
```

点击优先使用 native `webContents.sendInputEvent`。如果失败，再 fallback 到 CDP `Input.dispatchMouseEvent`。

`fill` 流程：

```text
@eN
  -> DOM.focus
  -> 清空 value
  -> dispatch input
  -> 逐字符 Input.dispatchKeyEvent
  -> dispatch change
```

`select` 同时支持两类控件：

- native `<select>`
- ARIA combobox/listbox

对于 ARIA select，它会：

1. focus 并点击控件。
2. 查找 `aria-controls`、`aria-owns` 或可见 `role=listbox`。
3. 从候选容器中寻找 `role=option`、`option` 或 `[data-value]`。
4. 点击匹配项。
5. 检查控件状态是否真的反映了选中值。

`BrowserPaneManager` 外层还会记录 `lastAction`，用于截图标注和调试。

相关源码：

- `apps/electron/src/main/browser-cdp.ts`
- `apps/electron/src/main/browser-pane-manager.ts`

## 截图、等待、网络和控制台

截图由 `webContents.capturePage` 完成。

`BrowserPaneManager.screenshot` 支持：

- raw screenshot
- agent/annotated screenshot
- png/jpeg 格式
- 按 ref/selector/坐标截取 region

annotated screenshot 的流程：

1. snapshot 拿 refs。
2. 解析每个 ref 的几何信息。
3. 临时在页面里插入 overlay。
4. `capturePage`。
5. 清理 overlay。

等待逻辑支持：

- `selector`：轮询 `document.querySelector`
- `text`：检查 `document.body.innerText`
- `url`：检查当前 URL 是否包含指定字符串
- `network-idle`：根据 in-flight request 计数和最后网络活动时间判断

console/network/download logs 存在 browser instance 内部，再按 limit 和 filter 返回。

相关源码：

- `apps/electron/src/main/browser-pane-manager.ts`

## Agent overlay 和安全边界

当模型真正操作浏览器时，系统会激活 agent control overlay。overlay 判断只认 canonical `browser_tool`，并排除：

- `help`
- `open`
- `release`
- `close`
- `hide`

相关逻辑在：

- `packages/server-core/src/domain/browser-tool-detection.ts`
- `apps/electron/src/main/browser-pane-manager.ts`

`navigate` 和 `snapshot` 还会检测 Cloudflare 或人机验证类 challenge。如果检测到，会 release control，让用户自己完成验证，再继续。

检测信号包括：

- 页面标题如 `Just a moment`
- URL 包含 `/cdn-cgi/challenge-platform/`
- DOM 中出现 challenge form、Turnstile、Cloudflare iframe
- accessibility tree 近似空页面

## 辅助 CLI

`bun run browser-tool` 对应 `scripts/browser-tool.ts`。它是 secondary path，只提供：

- `help`
- `list`
- `template <operation>`
- `all-templates`
- `parse-url <url>`

它不会控制浏览器。源码注释明确写着：

```text
Execution still happens through native browser_* tools in sessions
```

## 一句话总结

这个 browser tool 不是 Playwright 包装器，而是：

```text
LLM 命令层
  + session-scoped 抽象接口
  + Electron BrowserWindow 管理器
  + CDP/accessibility ref 执行器
```

模型只看见 `browser_tool command`；中间层负责解析命令和绑定 session；Electron 主进程负责窗口、网络、截图、overlay；CDP 层负责把 `@eN` ref 映射到真实 DOM 节点并执行可靠交互。
