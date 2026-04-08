# CraftAgents 中文支持系统迭代记录

## 2026-04-08

### 主要功能
- 完成中英文语言切换系统的核心实现
- 在设置界面的偏好设置中添加了语言选择下拉菜单
- 创建了完整的i18n国际化系统
- 添加了英文和中文语言包文件
- 实现了翻译函数的参数支持功能

### 修复的问题
1. **React钩子规则问题** - 重构了i18n系统，移除了违反React钩子规则的全局t函数，只保留返回{ t }对象的useTranslations钩子
2. **侧边栏翻译** - 完成了左侧侧边栏所有菜单项的翻译
3. **语言切换功能** - 修复了语言切换下拉菜单点击中文无反应的问题，使用settingsStore.setLocale来更新语言设置
4. **多个界面组件翻译** - 完成了以下组件的国际化适配：
   - SettingsNavigator.tsx
   - PreferencesPage.tsx
   - AppMenu.tsx
   - ResetConfirmationDialog.tsx
   - WorkspacePicker.tsx
   - WelcomeStep.tsx
   - FreeFormInput.tsx
   - SessionList.tsx

### 修改的文件
- `apps/electron/src/renderer/i18n/index.ts` - i18n核心系统重构
- `apps/electron/src/renderer/i18n/locales/en-US.ts` - 英文语言包
- `apps/electron/src/renderer/i18n/locales/zh-CN.ts` - 中文语言包
- `apps/electron/src/renderer/atoms/settings.ts` - 设置状态管理
- `apps/electron/src/renderer/pages/settings/PreferencesPage.tsx` - 偏好设置页面
- `apps/electron/src/renderer/pages/settings/SettingsNavigator.tsx` - 设置导航器
- `apps/electron/src/renderer/components/AppMenu.tsx` - 应用菜单
- `apps/electron/src/renderer/components/ResetConfirmationDialog.tsx` - 重置确认对话框
- `apps/electron/src/renderer/components/workspace/WorkspacePicker.tsx` - 工作区选择器
- `apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx` - 欢迎步骤
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` - 自由格式输入
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` - 会话列表

### Git分支
- 创建了feature分支用于中文支持功能开发
- 创建了develop分支用于开发环境集成
- 所有修改已推送到远程仓库

### 构建状态
- 应用成功构建，无TypeScript错误
- 所有翻译都受设置中的语言偏好下拉菜单控制
