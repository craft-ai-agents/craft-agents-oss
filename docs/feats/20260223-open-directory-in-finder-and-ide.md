# 工作目录右键菜单：在 Finder 中显示 & 在 IDE 中打开

## 功能概述

在输入框下方的工作目录徽章上，右键点击可弹出上下文菜单，支持：

- **Open in Editor** — 使用用户配置的默认 IDE 打开当前工作目录
- **Show in Finder** — 在系统文件管理器中显示当前工作目录

仅在已设置工作目录时，右键菜单才会生效。

## 默认 IDE 配置

用户可在 **Settings → App → Editor** 中选择默认编辑器：


| 编辑器      | 标识         | CLI 命令     | macOS 备选                       |
| -------- | ---------- | ---------- | ------------------------------ |
| VS Code  | `vscode`   | `code`     | `open -a "Visual Studio Code"` |
| Cursor   | `cursor`   | `cursor`   | `open -a "Cursor"`             |
| Windsurf | `windsurf` | `windsurf` | `open -a "Windsurf"`           |


默认值为 VS Code。设置持久化在 `~/.craft-agent/config.json` 的 `defaultEditor` 字段中。

## 涉及文件

### 配置存储层

- `packages/shared/src/config/config-defaults-schema.ts` — `ConfigDefaults.defaults` 新增 `defaultEditor: string`
- `apps/electron/resources/config-defaults.json` — 默认值 `"defaultEditor": "vscode"`
- `packages/shared/src/config/storage.ts` — `StoredConfig` 新增 `defaultEditor` 字段，新增 `getDefaultEditor()` / `setDefaultEditor()` 函数

### IPC 通道

- `apps/electron/src/shared/types.ts` — 新增 `OPEN_IN_EDITOR`、`EDITOR_GET_DEFAULT`、`EDITOR_SET_DEFAULT` 通道及 `ElectronAPI` 接口方法
- `apps/electron/src/preload/index.ts` — 新增 `openInEditor`、`getDefaultEditor`、`setDefaultEditor` 桥接方法

### 主进程

- `apps/electron/src/main/ipc.ts` — 新增 `OPEN_IN_EDITOR` handler（先尝试 CLI，macOS fallback `open -a`，5 秒超时），新增 `EDITOR_GET_DEFAULT` / `EDITOR_SET_DEFAULT` handler

### 渲染进程

- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` — App 设置页新增 "Editor" section，使用 `SettingsMenuSelectRow` 下拉选择
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` — `WorkingDirectoryBadge` 组件外层包裹 Radix `ContextMenu`，右键显示菜单；使用 `stopImmediatePropagation` 阻止 Electron 开发模式下的默认右键菜单

