# Craft Agents v0.8.4 - 中文语言支持版本

## 概述

本次发布为 Craft Agents 桌面应用程序引入了全面的中文语言支持，使中文用户能够更方便地使用该应用。

## 新功能

### 中文语言支持

- **语言切换器**：在设置 > 偏好设置中添加了语言切换功能，允许用户在英文和中文之间切换
- **完整的 UI 翻译**：大部分用户界面已翻译为中文，包括：
  - 侧边栏导航和菜单项
  - 设置页面（外观、输入、标签、权限、服务器、快捷键、工作区、AI）
  - 自动化组件和 UI
  - 会话管理
  - 偏好设置和配置

### 国际化系统

- 实现了强大的 i18n（国际化）系统
- 为 React 组件使用 `useTranslations()` 钩子
- 翻译文件位于 `apps/electron/src/renderer/i18n/locales/`：
  - `en-US.ts` - 英文翻译
  - `zh-CN.ts` - 中文翻译

## 技术改进

- 修复了 tsconfig 配置问题（找不到 `tsconfig.base.json`）
- 更新了多个包的 tsconfig 文件，使用正确的 TypeScript 配置，不再依赖基础扩展
- 提高了整个代码库的类型安全性

## 已知限制

### 翻译不完整

虽然大部分 UI 已经翻译，但应用程序的某些部分仍然是英文：

- **AppMenu 组件**：应用程序菜单栏（macOS 上的顶部菜单，或 Windows/Linux 上的菜单下拉菜单）尚未完全翻译
- **次要 UI 元素**：一些较小的 UI 元素和边缘情况可能仍显示英文文本
- **错误消息**：某些错误消息和系统通知可能仍为英文

### 未来改进的方向

1. **AppMenu 翻译**：完成应用程序菜单栏的翻译
2. **错误消息**：翻译所有错误消息和系统通知
3. **边缘情况**：识别并翻译任何剩余的未翻译 UI 元素
4. **上下文翻译**：提高技术术语和领域特定语言的翻译准确性

## 安装和使用

### 切换语言

1. 打开 Craft Agents
2. 转到设置 > 偏好设置
3. 找到"语言"下拉菜单
4. 选择"中文 (Chinese)"切换到中文，或选择"English"切换回英文

### 从源代码构建

```bash
git clone https://github.com/lukilabs/craft-agents-oss.git
cd craft-agents-oss
bun install
bun run electron:start
```

## 贡献

欢迎贡献以完成中文语言支持！如果您想帮助翻译或改进现有的翻译：

1. 检查 `apps/electron/src/renderer/i18n/locales/` 中的翻译文件
2. 添加缺失的翻译或改进现有翻译
3. 提交拉取请求

## 许可证

本项目根据 Apache License 2.0 获得许可 - 有关详细信息，请参阅 [LICENSE](LICENSE) 文件。
