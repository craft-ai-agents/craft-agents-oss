# 中文翻译待处理列表

> 生成时间: 2026-04-08T12:09:18.785Z
> 扫描目录: D:\Projects\CraftAgents\apps\electron\src\renderer
> 发现文件数: 40
> 发现文本数: 459

---

## 目录

- [definitions.ts](#apps-electron-src-renderer-actions-definitions-ts)
- [useHotkeyLabel.ts](#apps-electron-src-renderer-actions-useHotkeyLabel-ts)
- [NavigatorPanel.tsx](#apps-electron-src-renderer-components-app-shell-NavigatorPanel-tsx)
- [Panel.tsx](#apps-electron-src-renderer-components-app-shell-Panel-tsx)
- [SkillsListPanel.tsx](#apps-electron-src-renderer-components-app-shell-SkillsListPanel-tsx)
- [SourcesListPanel.tsx](#apps-electron-src-renderer-components-app-shell-SourcesListPanel-tsx)
- [TransportConnectionBanner.tsx](#apps-electron-src-renderer-components-app-shell-TransportConnectionBanner-tsx)
- [AutomationCard.tsx](#apps-electron-src-renderer-components-automations-AutomationCard-tsx)
- [AutomationInfoPage.tsx](#apps-electron-src-renderer-components-automations-AutomationInfoPage-tsx)
- [AutomationMenu.tsx](#apps-electron-src-renderer-components-automations-AutomationMenu-tsx)
- [AutomationTestPanel.tsx](#apps-electron-src-renderer-components-automations-AutomationTestPanel-tsx)
- [PhaseBadge.tsx](#apps-electron-src-renderer-components-automations-PhaseBadge-tsx)
- [empty-state-prompts.ts](#apps-electron-src-renderer-components-browser-empty-state-prompts-ts)
- [CraftAppIcon.tsx](#apps-electron-src-renderer-components-icons-CraftAppIcon-tsx)
- [Info_DataTable.tsx](#apps-electron-src-renderer-components-info-Info-DataTable-tsx)
- [Info_StatusBadge.tsx](#apps-electron-src-renderer-components-info-Info-StatusBadge-tsx)
- [LabelsDataTable.tsx](#apps-electron-src-renderer-components-info-LabelsDataTable-tsx)
- [ToolsDataTable.tsx](#apps-electron-src-renderer-components-info-ToolsDataTable-tsx)
- [GitBashWarning.tsx](#apps-electron-src-renderer-components-onboarding-GitBashWarning-tsx)
- [OnboardingWizard.tsx](#apps-electron-src-renderer-components-onboarding-OnboardingWizard-tsx)
- [ReauthScreen.tsx](#apps-electron-src-renderer-components-onboarding-ReauthScreen-tsx)
- [SettingsEditRow.tsx](#apps-electron-src-renderer-components-settings-SettingsEditRow-tsx)
- [SettingsRow.tsx](#apps-electron-src-renderer-components-settings-SettingsRow-tsx)
- [SettingsSection.tsx](#apps-electron-src-renderer-components-settings-SettingsSection-tsx)
- [SettingsSegmentedControl.tsx](#apps-electron-src-renderer-components-settings-SettingsSegmentedControl-tsx)
- [SettingsTextarea.tsx](#apps-electron-src-renderer-components-settings-SettingsTextarea-tsx)
- [SettingsToggle.tsx](#apps-electron-src-renderer-components-settings-SettingsToggle-tsx)
- [HeaderMenu.tsx](#apps-electron-src-renderer-components-ui-HeaderMenu-tsx)
- [entity-list-empty.tsx](#apps-electron-src-renderer-components-ui-entity-list-empty-tsx)
- [entity-list.tsx](#apps-electron-src-renderer-components-ui-entity-list-tsx)
- [source-status-indicator.tsx](#apps-electron-src-renderer-components-ui-source-status-indicator-tsx)
- [AddWorkspaceStep_Choice.tsx](#apps-electron-src-renderer-components-workspace-AddWorkspaceStep-Choice-tsx)
- [primitives.tsx](#apps-electron-src-renderer-components-workspace-primitives-tsx)
- [useBackgroundTasks.ts](#apps-electron-src-renderer-hooks-useBackgroundTasks-ts)
- [en-US.ts](#apps-electron-src-renderer-i18n-locales-en-US-ts)
- [zh-CN.ts](#apps-electron-src-renderer-i18n-locales-zh-CN-ts)
- [navigation-registry.ts](#apps-electron-src-renderer-lib-navigation-registry-ts)
- [provider-icons.ts](#apps-electron-src-renderer-lib-provider-icons-ts)
- [session-load.ts](#apps-electron-src-renderer-lib-session-load-ts)
- [auth-validation.ts](#apps-electron-src-renderer-utils-auth-validation-ts)

---

## apps\electron\src\renderer\actions\definitions.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\actions\definitions.ts`

待翻译数量: 64

### 第 9 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
7:   'app.newChat': {
8:     id: 'app.newChat',
9:     label: 'New Chat',
10:     description: 'Create a new chat session',
11:     defaultHotkey: 'mod+n',
```

---

### 第 10 行: "Create a new chat session"

- 建议键名: `createANewChatSession`
- 英文原文: `Create a new chat session`
- 中文翻译: [待填写]

**上下文:**

```
8:     id: 'app.newChat',
9:     label: 'New Chat',
10:     description: 'Create a new chat session',
11:     defaultHotkey: 'mod+n',
12:     category: 'General',
```

---

### 第 12 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
10:     description: 'Create a new chat session',
11:     defaultHotkey: 'mod+n',
12:     category: 'General',
13:   },
14:   'app.newChatInPanel': {
```

---

### 第 16 行: "New Chat in Panel"

- 建议键名: `newChatInPanel`
- 英文原文: `New Chat in Panel`
- 中文翻译: [待填写]

**上下文:**

```
14:   'app.newChatInPanel': {
15:     id: 'app.newChatInPanel',
16:     label: 'New Chat in Panel',
17:     description: 'Create a new chat session in a new panel',
18:     defaultHotkey: 'mod+t',
```

---

### 第 17 行: "Create a new chat session in a new panel"

- 建议键名: `createANewChatSessionInANewPanel`
- 英文原文: `Create a new chat session in a new panel`
- 中文翻译: [待填写]

**上下文:**

```
15:     id: 'app.newChatInPanel',
16:     label: 'New Chat in Panel',
17:     description: 'Create a new chat session in a new panel',
18:     defaultHotkey: 'mod+t',
19:     category: 'General',
```

---

### 第 19 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
17:     description: 'Create a new chat session in a new panel',
18:     defaultHotkey: 'mod+t',
19:     category: 'General',
20:   },
21:   'app.settings': {
```

---

### 第 23 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
21:   'app.settings': {
22:     id: 'app.settings',
23:     label: 'Settings',
24:     description: 'Open application settings',
25:     defaultHotkey: 'mod+,',
```

---

### 第 24 行: "Open application settings"

- 建议键名: `openApplicationSettings`
- 英文原文: `Open application settings`
- 中文翻译: [待填写]

**上下文:**

```
22:     id: 'app.settings',
23:     label: 'Settings',
24:     description: 'Open application settings',
25:     defaultHotkey: 'mod+,',
26:     category: 'General',
```

---

### 第 26 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
24:     description: 'Open application settings',
25:     defaultHotkey: 'mod+,',
26:     category: 'General',
27:   },
28:   'app.toggleTheme': {
```

---

### 第 30 行: "Toggle Theme"

- 建议键名: `toggleTheme`
- 英文原文: `Toggle Theme`
- 中文翻译: [待填写]

**上下文:**

```
28:   'app.toggleTheme': {
29:     id: 'app.toggleTheme',
30:     label: 'Toggle Theme',
31:     description: 'Switch between light and dark mode',
32:     defaultHotkey: 'mod+shift+a',
```

---

### 第 31 行: "Switch between light and dark mode"

- 建议键名: `switchBetweenLightAndDarkMode`
- 英文原文: `Switch between light and dark mode`
- 中文翻译: [待填写]

**上下文:**

```
29:     id: 'app.toggleTheme',
30:     label: 'Toggle Theme',
31:     description: 'Switch between light and dark mode',
32:     defaultHotkey: 'mod+shift+a',
33:     category: 'General',
```

---

### 第 33 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
31:     description: 'Switch between light and dark mode',
32:     defaultHotkey: 'mod+shift+a',
33:     category: 'General',
34:   },
35:   'app.search': {
```

---

### 第 37 行: "Search"

- 建议键名: `search`
- 英文原文: `Search`
- 中文翻译: [待填写]

**上下文:**

```
35:   'app.search': {
36:     id: 'app.search',
37:     label: 'Search',
38:     description: 'Open search panel',
39:     defaultHotkey: 'mod+f',
```

---

### 第 38 行: "Open search panel"

- 建议键名: `openSearchPanel`
- 英文原文: `Open search panel`
- 中文翻译: [待填写]

**上下文:**

```
36:     id: 'app.search',
37:     label: 'Search',
38:     description: 'Open search panel',
39:     defaultHotkey: 'mod+f',
40:     category: 'General',
```

---

### 第 40 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
38:     description: 'Open search panel',
39:     defaultHotkey: 'mod+f',
40:     category: 'General',
41:   },
42:   'app.keyboardShortcuts': {
```

---

### 第 44 行: "Keyboard Shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
42:   'app.keyboardShortcuts': {
43:     id: 'app.keyboardShortcuts',
44:     label: 'Keyboard Shortcuts',
45:     description: 'Show keyboard shortcuts reference',
46:     defaultHotkey: 'mod+/',
```

---

### 第 45 行: "Show keyboard shortcuts reference"

- 建议键名: `showKeyboardShortcutsReference`
- 英文原文: `Show keyboard shortcuts reference`
- 中文翻译: [待填写]

**上下文:**

```
43:     id: 'app.keyboardShortcuts',
44:     label: 'Keyboard Shortcuts',
45:     description: 'Show keyboard shortcuts reference',
46:     defaultHotkey: 'mod+/',
47:     category: 'General',
```

---

### 第 47 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
45:     description: 'Show keyboard shortcuts reference',
46:     defaultHotkey: 'mod+/',
47:     category: 'General',
48:   },
49:   'app.newWindow': {
```

---

### 第 51 行: "New Window"

- 建议键名: `newWindow`
- 英文原文: `New Window`
- 中文翻译: [待填写]

**上下文:**

```
49:   'app.newWindow': {
50:     id: 'app.newWindow',
51:     label: 'New Window',
52:     description: 'Open a new window',
53:     defaultHotkey: 'mod+shift+n',
```

---

### 第 52 行: "Open a new window"

- 建议键名: `openANewWindow`
- 英文原文: `Open a new window`
- 中文翻译: [待填写]

**上下文:**

```
50:     id: 'app.newWindow',
51:     label: 'New Window',
52:     description: 'Open a new window',
53:     defaultHotkey: 'mod+shift+n',
54:     category: 'General',
```

---

### 第 54 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
52:     description: 'Open a new window',
53:     defaultHotkey: 'mod+shift+n',
54:     category: 'General',
55:   },
56:   'app.quit': {
```

---

### 第 58 行: "Quit"

- 建议键名: `quit`
- 英文原文: `Quit`
- 中文翻译: [待填写]

**上下文:**

```
56:   'app.quit': {
57:     id: 'app.quit',
58:     label: 'Quit',
59:     description: 'Quit the application',
60:     defaultHotkey: 'mod+q',
```

---

### 第 59 行: "Quit the application"

- 建议键名: `quitTheApplication`
- 英文原文: `Quit the application`
- 中文翻译: [待填写]

**上下文:**

```
57:     id: 'app.quit',
58:     label: 'Quit',
59:     description: 'Quit the application',
60:     defaultHotkey: 'mod+q',
61:     category: 'General',
```

---

### 第 61 行: "General"

- 建议键名: `general`
- 英文原文: `General`
- 中文翻译: [待填写]

**上下文:**

```
59:     description: 'Quit the application',
60:     defaultHotkey: 'mod+q',
61:     category: 'General',
62:   },
63: 
```

---

### 第 69 行: "Focus Sidebar"

- 建议键名: `focusSidebar`
- 英文原文: `Focus Sidebar`
- 中文翻译: [待填写]

**上下文:**

```
67:   'nav.focusSidebar': {
68:     id: 'nav.focusSidebar',
69:     label: 'Focus Sidebar',
70:     defaultHotkey: 'mod+1',
71:     category: 'Navigation',
```

---

### 第 71 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
69:     label: 'Focus Sidebar',
70:     defaultHotkey: 'mod+1',
71:     category: 'Navigation',
72:   },
73:   'nav.focusNavigator': {
```

---

### 第 75 行: "Focus Navigator"

- 建议键名: `focusNavigator`
- 英文原文: `Focus Navigator`
- 中文翻译: [待填写]

**上下文:**

```
73:   'nav.focusNavigator': {
74:     id: 'nav.focusNavigator',
75:     label: 'Focus Navigator',
76:     defaultHotkey: 'mod+2',
77:     category: 'Navigation',
```

---

### 第 77 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
75:     label: 'Focus Navigator',
76:     defaultHotkey: 'mod+2',
77:     category: 'Navigation',
78:   },
79:   'nav.focusChat': {
```

---

### 第 81 行: "Focus Chat"

- 建议键名: `focusChat`
- 英文原文: `Focus Chat`
- 中文翻译: [待填写]

**上下文:**

```
79:   'nav.focusChat': {
80:     id: 'nav.focusChat',
81:     label: 'Focus Chat',
82:     defaultHotkey: 'mod+3',
83:     category: 'Navigation',
```

---

### 第 83 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
81:     label: 'Focus Chat',
82:     defaultHotkey: 'mod+3',
83:     category: 'Navigation',
84:   },
85:   'nav.nextZone': {
```

---

### 第 87 行: "Focus Next Zone"

- 建议键名: `focusNextZone`
- 英文原文: `Focus Next Zone`
- 中文翻译: [待填写]

**上下文:**

```
85:   'nav.nextZone': {
86:     id: 'nav.nextZone',
87:     label: 'Focus Next Zone',
88:     defaultHotkey: 'tab',
89:     category: 'Navigation',
```

---

### 第 89 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
87:     label: 'Focus Next Zone',
88:     defaultHotkey: 'tab',
89:     category: 'Navigation',
90:     when: '!inputFocus',  // Tab should work normally in text inputs
91:   },
```

---

### 第 94 行: "Go Back"

- 建议键名: `goBack`
- 英文原文: `Go Back`
- 中文翻译: [待填写]

**上下文:**

```
92:   'nav.goBack': {
93:     id: 'nav.goBack',
94:     label: 'Go Back',
95:     description: 'Navigate to previous session',
96:     defaultHotkey: 'mod+[',
```

---

### 第 95 行: "Navigate to previous session"

- 建议键名: `navigateToPreviousSession`
- 英文原文: `Navigate to previous session`
- 中文翻译: [待填写]

**上下文:**

```
93:     id: 'nav.goBack',
94:     label: 'Go Back',
95:     description: 'Navigate to previous session',
96:     defaultHotkey: 'mod+[',
97:     category: 'Navigation',
```

---

### 第 97 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
95:     description: 'Navigate to previous session',
96:     defaultHotkey: 'mod+[',
97:     category: 'Navigation',
98:   },
99:   'nav.goForward': {
```

---

### 第 101 行: "Go Forward"

- 建议键名: `goForward`
- 英文原文: `Go Forward`
- 中文翻译: [待填写]

**上下文:**

```
99:   'nav.goForward': {
100:     id: 'nav.goForward',
101:     label: 'Go Forward',
102:     description: 'Navigate to next session',
103:     defaultHotkey: 'mod+]',
```

---

### 第 102 行: "Navigate to next session"

- 建议键名: `navigateToNextSession`
- 英文原文: `Navigate to next session`
- 中文翻译: [待填写]

**上下文:**

```
100:     id: 'nav.goForward',
101:     label: 'Go Forward',
102:     description: 'Navigate to next session',
103:     defaultHotkey: 'mod+]',
104:     category: 'Navigation',
```

---

### 第 104 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
102:     description: 'Navigate to next session',
103:     defaultHotkey: 'mod+]',
104:     category: 'Navigation',
105:   },
106:   'nav.goBackAlt': {
```

---

### 第 108 行: "Go Back"

- 建议键名: `goBack`
- 英文原文: `Go Back`
- 中文翻译: [待填写]

**上下文:**

```
106:   'nav.goBackAlt': {
107:     id: 'nav.goBackAlt',
108:     label: 'Go Back',
109:     description: 'Navigate to previous session (arrow key)',
110:     defaultHotkey: 'mod+left',
```

---

### 第 111 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
109:     description: 'Navigate to previous session (arrow key)',
110:     defaultHotkey: 'mod+left',
111:     category: 'Navigation',
112:     when: '!inputFocus',  // CMD+Left = cursor to line start in text inputs
113:   },
```

---

### 第 116 行: "Go Forward"

- 建议键名: `goForward`
- 英文原文: `Go Forward`
- 中文翻译: [待填写]

**上下文:**

```
114:   'nav.goForwardAlt': {
115:     id: 'nav.goForwardAlt',
116:     label: 'Go Forward',
117:     description: 'Navigate to next session (arrow key)',
118:     defaultHotkey: 'mod+right',
```

---

### 第 119 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
117:     description: 'Navigate to next session (arrow key)',
118:     defaultHotkey: 'mod+right',
119:     category: 'Navigation',
120:     when: '!inputFocus',  // CMD+Right = cursor to line end in text inputs
121:   },
```

---

### 第 128 行: "Toggle Sidebar"

- 建议键名: `toggleSidebar`
- 英文原文: `Toggle Sidebar`
- 中文翻译: [待填写]

**上下文:**

```
126:   'view.toggleSidebar': {
127:     id: 'view.toggleSidebar',
128:     label: 'Toggle Sidebar',
129:     defaultHotkey: 'mod+b',
130:     category: 'View',
```

---

### 第 130 行: "View"

- 建议键名: `view`
- 英文原文: `View`
- 中文翻译: [待填写]

**上下文:**

```
128:     label: 'Toggle Sidebar',
129:     defaultHotkey: 'mod+b',
130:     category: 'View',
131:   },
132:   'view.toggleFocusMode': {
```

---

### 第 134 行: "Toggle Focus Mode"

- 建议键名: `toggleFocusMode`
- 英文原文: `Toggle Focus Mode`
- 中文翻译: [待填写]

**上下文:**

```
132:   'view.toggleFocusMode': {
133:     id: 'view.toggleFocusMode',
134:     label: 'Toggle Focus Mode',
135:     description: 'Hide both sidebars for distraction-free work',
136:     defaultHotkey: 'mod+.',
```

---

### 第 137 行: "View"

- 建议键名: `view`
- 英文原文: `View`
- 中文翻译: [待填写]

**上下文:**

```
135:     description: 'Hide both sidebars for distraction-free work',
136:     defaultHotkey: 'mod+.',
137:     category: 'View',
138:   },
139: 
```

---

### 第 145 行: "Select All"

- 建议键名: `selectAll`
- 英文原文: `Select All`
- 中文翻译: [待填写]

**上下文:**

```
143:   'navigator.selectAll': {
144:     id: 'navigator.selectAll',
145:     label: 'Select All',
146:     defaultHotkey: 'mod+a',
147:     category: 'Navigator',
```

---

### 第 147 行: "Navigator"

- 建议键名: `navigator`
- 英文原文: `Navigator`
- 中文翻译: [待填写]

**上下文:**

```
145:     label: 'Select All',
146:     defaultHotkey: 'mod+a',
147:     category: 'Navigator',
148:     scope: 'navigator',
149:     when: 'navigatorFocus',  // CMD+A = select all text when in input
```

---

### 第 153 行: "Clear Selection"

- 建议键名: `clearSelection`
- 英文原文: `Clear Selection`
- 中文翻译: [待填写]

**上下文:**

```
151:   'navigator.clearSelection': {
152:     id: 'navigator.clearSelection',
153:     label: 'Clear Selection',
154:     defaultHotkey: 'escape',
155:     category: 'Navigator',
```

---

### 第 155 行: "Navigator"

- 建议键名: `navigator`
- 英文原文: `Navigator`
- 中文翻译: [待填写]

**上下文:**

```
153:     label: 'Clear Selection',
154:     defaultHotkey: 'escape',
155:     category: 'Navigator',
156:     scope: 'navigator',
157:     when: 'navigatorFocus',
```

---

### 第 165 行: "Focus Next Panel"

- 建议键名: `focusNextPanel`
- 英文原文: `Focus Next Panel`
- 中文翻译: [待填写]

**上下文:**

```
163:   'panel.focusNext': {
164:     id: 'panel.focusNext',
165:     label: 'Focus Next Panel',
166:     description: 'Move focus to the next panel',
167:     defaultHotkey: 'mod+shift+]',
```

---

### 第 166 行: "Move focus to the next panel"

- 建议键名: `moveFocusToTheNextPanel`
- 英文原文: `Move focus to the next panel`
- 中文翻译: [待填写]

**上下文:**

```
164:     id: 'panel.focusNext',
165:     label: 'Focus Next Panel',
166:     description: 'Move focus to the next panel',
167:     defaultHotkey: 'mod+shift+]',
168:     category: 'Navigation',
```

---

### 第 168 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
166:     description: 'Move focus to the next panel',
167:     defaultHotkey: 'mod+shift+]',
168:     category: 'Navigation',
169:   },
170:   'panel.focusPrev': {
```

---

### 第 172 行: "Focus Previous Panel"

- 建议键名: `focusPreviousPanel`
- 英文原文: `Focus Previous Panel`
- 中文翻译: [待填写]

**上下文:**

```
170:   'panel.focusPrev': {
171:     id: 'panel.focusPrev',
172:     label: 'Focus Previous Panel',
173:     description: 'Move focus to the previous panel',
174:     defaultHotkey: 'mod+shift+[',
```

---

### 第 173 行: "Move focus to the previous panel"

- 建议键名: `moveFocusToThePreviousPanel`
- 英文原文: `Move focus to the previous panel`
- 中文翻译: [待填写]

**上下文:**

```
171:     id: 'panel.focusPrev',
172:     label: 'Focus Previous Panel',
173:     description: 'Move focus to the previous panel',
174:     defaultHotkey: 'mod+shift+[',
175:     category: 'Navigation',
```

---

### 第 175 行: "Navigation"

- 建议键名: `navigation`
- 英文原文: `Navigation`
- 中文翻译: [待填写]

**上下文:**

```
173:     description: 'Move focus to the previous panel',
174:     defaultHotkey: 'mod+shift+[',
175:     category: 'Navigation',
176:   },
177: 
```

---

### 第 183 行: "Stop Processing"

- 建议键名: `stopProcessing`
- 英文原文: `Stop Processing`
- 中文翻译: [待填写]

**上下文:**

```
181:   'chat.stopProcessing': {
182:     id: 'chat.stopProcessing',
183:     label: 'Stop Processing',
184:     description: 'Cancel the current agent task (double-press)',
185:     defaultHotkey: 'escape',
```

---

### 第 186 行: "Chat"

- 建议键名: `chat`
- 英文原文: `Chat`
- 中文翻译: [待填写]

**上下文:**

```
184:     description: 'Cancel the current agent task (double-press)',
185:     defaultHotkey: 'escape',
186:     category: 'Chat',
187:     scope: 'chat',
188:     when: '!hasSelection',  // Let browser clear selection first; overlays handled by hasOpenOverlay() in enabled callback
```

---

### 第 192 行: "Cycle Permission Mode"

- 建议键名: `cyclePermissionMode`
- 英文原文: `Cycle Permission Mode`
- 中文翻译: [待填写]

**上下文:**

```
190:   'chat.cyclePermissionMode': {
191:     id: 'chat.cyclePermissionMode',
192:     label: 'Cycle Permission Mode',
193:     description: 'Switch between Explore, Ask, and Execute modes',
194:     defaultHotkey: 'shift+tab',
```

---

### 第 195 行: "Chat"

- 建议键名: `chat`
- 英文原文: `Chat`
- 中文翻译: [待填写]

**上下文:**

```
193:     description: 'Switch between Explore, Ask, and Execute modes',
194:     defaultHotkey: 'shift+tab',
195:     category: 'Chat',
196:   },
197:   'chat.nextSearchMatch': {
```

---

### 第 199 行: "Next Search Match"

- 建议键名: `nextSearchMatch`
- 英文原文: `Next Search Match`
- 中文翻译: [待填写]

**上下文:**

```
197:   'chat.nextSearchMatch': {
198:     id: 'chat.nextSearchMatch',
199:     label: 'Next Search Match',
200:     defaultHotkey: 'mod+g',
201:     category: 'Chat',
```

---

### 第 201 行: "Chat"

- 建议键名: `chat`
- 英文原文: `Chat`
- 中文翻译: [待填写]

**上下文:**

```
199:     label: 'Next Search Match',
200:     defaultHotkey: 'mod+g',
201:     category: 'Chat',
202:   },
203:   'chat.prevSearchMatch': {
```

---

### 第 205 行: "Previous Search Match"

- 建议键名: `previousSearchMatch`
- 英文原文: `Previous Search Match`
- 中文翻译: [待填写]

**上下文:**

```
203:   'chat.prevSearchMatch': {
204:     id: 'chat.prevSearchMatch',
205:     label: 'Previous Search Match',
206:     defaultHotkey: 'mod+shift+g',
207:     category: 'Chat',
```

---

### 第 207 行: "Chat"

- 建议键名: `chat`
- 英文原文: `Chat`
- 中文翻译: [待填写]

**上下文:**

```
205:     label: 'Previous Search Match',
206:     defaultHotkey: 'mod+shift+g',
207:     category: 'Chat',
208:   },
209: 
```

---

## apps\electron\src\renderer\actions\useHotkeyLabel.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\actions\useHotkeyLabel.ts`

待翻译数量: 1

### 第 24 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
22:  * @example
23:  * const { label, hotkey } = useActionLabel('app.newChat')
24:  * // label: "New Chat", hotkey: "⌘N"
25:  */
26: export function useActionLabel(actionId: ActionId) {
```

---

## apps\electron\src\renderer\components\app-shell\NavigatorPanel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\NavigatorPanel.tsx`

待翻译数量: 2

### 第 24 行: "Conversations"

- 建议键名: `conversations`
- 英文原文: `Conversations`
- 中文翻译: [待填写]

**上下文:**

```
22: 
23: export interface NavigatorPanelProps {
24:   /** Panel title (e.g., "Conversations", "Sources") */
25:   title: string
26:   /** Panel width in pixels */
```

---

### 第 24 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
22: 
23: export interface NavigatorPanelProps {
24:   /** Panel title (e.g., "Conversations", "Sources") */
25:   title: string
26:   /** Panel width in pixels */
```

---

## apps\electron\src\renderer\components\app-shell\Panel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\Panel.tsx`

待翻译数量: 4

### 第 14 行: "Title"

- 建议键名: `title`
- 英文原文: `Title`
- 中文翻译: [待填写]

**上下文:**

```
12:  * ```tsx
13:  * <Panel variant="grow">
14:  *   <PanelHeader title="Title" subtitle="Subtitle" />
15:  *   <Separator />
16:  *   {content}
```

---

### 第 14 行: "Subtitle"

- 建议键名: `subtitle`
- 英文原文: `Subtitle`
- 中文翻译: [待填写]

**上下文:**

```
12:  * ```tsx
13:  * <Panel variant="grow">
14:  *   <PanelHeader title="Title" subtitle="Subtitle" />
15:  *   <Separator />
16:  *   {content}
```

---

### 第 14 行: "Title"

- 建议键名: `title`
- 英文原文: `Title`
- 中文翻译: [待填写]

**上下文:**

```
12:  * ```tsx
13:  * <Panel variant="grow">
14:  *   <PanelHeader title="Title" subtitle="Subtitle" />
15:  *   <Separator />
16:  *   {content}
```

---

### 第 14 行: "Subtitle"

- 建议键名: `subtitle`
- 英文原文: `Subtitle`
- 中文翻译: [待填写]

**上下文:**

```
12:  * ```tsx
13:  * <Panel variant="grow">
14:  *   <PanelHeader title="Title" subtitle="Subtitle" />
15:  *   <Separator />
16:  *   {content}
```

---

## apps\electron\src\renderer\components\app-shell\SkillsListPanel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\SkillsListPanel.tsx`

待翻译数量: 4

### 第 45 行: "No skills configured"

- 建议键名: `noSkillsConfigured`
- 英文原文: `No skills configured`
- 中文翻译: [待填写]

**上下文:**

```
43:         <EntityListEmptyScreen
44:           icon={<Zap />}
45:           title="No skills configured"
46:           description="Skills are reusable instructions that teach your agent specialized behaviors."
47:           docKey="skills"
```

---

### 第 45 行: "No skills configured"

- 建议键名: `noSkillsConfigured`
- 英文原文: `No skills configured`
- 中文翻译: [待填写]

**上下文:**

```
43:         <EntityListEmptyScreen
44:           icon={<Zap />}
45:           title="No skills configured"
46:           description="Skills are reusable instructions that teach your agent specialized behaviors."
47:           docKey="skills"
```

---

### 第 88 行: "Delete Skill"

- 建议键名: `deleteSkill`
- 英文原文: `Delete Skill`
- 中文翻译: [待填写]

**上下文:**

```
86:             onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
87:             canDelete={skill.source === 'workspace'}
88:             deleteLabel={skill.source === 'workspace' ? 'Delete Skill' : 'Managed by project'}
89:           />
90:         ),
```

---

### 第 88 行: "Managed by project"

- 建议键名: `managedByProject`
- 英文原文: `Managed by project`
- 中文翻译: [待填写]

**上下文:**

```
86:             onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
87:             canDelete={skill.source === 'workspace'}
88:             deleteLabel={skill.source === 'workspace' ? 'Delete Skill' : 'Managed by project'}
89:           />
90:         ),
```

---

## apps\electron\src\renderer\components\app-shell\SourcesListPanel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\SourcesListPanel.tsx`

待翻译数量: 5

### 第 16 行: "Local"

- 建议键名: `local`
- 英文原文: `Local`
- 中文翻译: [待填写]

**上下文:**

```
14:   mcp: { label: 'MCP', colorClass: 'bg-accent/10 text-accent' },
15:   api: { label: 'API', colorClass: 'bg-success/10 text-success' },
16:   local: { label: 'Local', colorClass: 'bg-info/10 text-info' },
17: }
18: 
```

---

### 第 21 行: "Auth Required"

- 建议键名: `authRequired`
- 英文原文: `Auth Required`
- 中文翻译: [待填写]

**上下文:**

```
19: const SOURCE_STATUS_CONFIG: Record<string, { label: string; colorClass: string } | null> = {
20:   connected: null,
21:   needs_auth: { label: 'Auth Required', colorClass: 'bg-warning/10 text-warning' },
22:   failed: { label: 'Disconnected', colorClass: 'bg-destructive/10 text-destructive' },
23:   untested: { label: 'Not Tested', colorClass: 'bg-foreground/10 text-foreground/50' },
```

---

### 第 22 行: "Disconnected"

- 建议键名: `disconnected`
- 英文原文: `Disconnected`
- 中文翻译: [待填写]

**上下文:**

```
20:   connected: null,
21:   needs_auth: { label: 'Auth Required', colorClass: 'bg-warning/10 text-warning' },
22:   failed: { label: 'Disconnected', colorClass: 'bg-destructive/10 text-destructive' },
23:   untested: { label: 'Not Tested', colorClass: 'bg-foreground/10 text-foreground/50' },
24:   local_disabled: { label: 'Disabled', colorClass: 'bg-foreground/10 text-foreground/50' },
```

---

### 第 23 行: "Not Tested"

- 建议键名: `notTested`
- 英文原文: `Not Tested`
- 中文翻译: [待填写]

**上下文:**

```
21:   needs_auth: { label: 'Auth Required', colorClass: 'bg-warning/10 text-warning' },
22:   failed: { label: 'Disconnected', colorClass: 'bg-destructive/10 text-destructive' },
23:   untested: { label: 'Not Tested', colorClass: 'bg-foreground/10 text-foreground/50' },
24:   local_disabled: { label: 'Disabled', colorClass: 'bg-foreground/10 text-foreground/50' },
25: }
```

---

### 第 24 行: "Disabled"

- 建议键名: `disabled`
- 英文原文: `Disabled`
- 中文翻译: [待填写]

**上下文:**

```
22:   failed: { label: 'Disconnected', colorClass: 'bg-destructive/10 text-destructive' },
23:   untested: { label: 'Not Tested', colorClass: 'bg-foreground/10 text-foreground/50' },
24:   local_disabled: { label: 'Disabled', colorClass: 'bg-foreground/10 text-foreground/50' },
25: }
26: 
```

---

## apps\electron\src\renderer\components\app-shell\TransportConnectionBanner.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\TransportConnectionBanner.tsx`

待翻译数量: 5

### 第 20 行: "Connecting to remote server"

- 建议键名: `connectingToRemoteServer`
- 英文原文: `Connecting to remote server`
- 中文翻译: [待填写]

**上下文:**

```
18:     case 'connecting':
19:       return {
20:         title: 'Connecting to remote server',
21:         description: `Connecting to ${state.url}...`,
22:         showRetry: false,
```

---

### 第 29 行: "Reconnecting to remote server"

- 建议键名: `reconnectingToRemoteServer`
- 英文原文: `Reconnecting to remote server`
- 中文翻译: [待填写]

**上下文:**

```
27:       const retry = state.nextRetryInMs != null ? `retry in ${state.nextRetryInMs}ms` : 'retrying'
28:       return {
29:         title: 'Reconnecting to remote server',
30:         description: `${getFailureReason(state)} (${retry}, attempt ${state.attempt})`,
31:         showRetry: true,
```

---

### 第 38 行: "Cannot connect to remote server"

- 建议键名: `cannotConnectToRemoteServer`
- 英文原文: `Cannot connect to remote server`
- 中文翻译: [待填写]

**上下文:**

```
36:     case 'failed':
37:       return {
38:         title: 'Cannot connect to remote server',
39:         description: getFailureReason(state),
40:         showRetry: true,
```

---

### 第 46 行: "Connection to remote server lost"

- 建议键名: `connectionToRemoteServerLost`
- 英文原文: `Connection to remote server lost`
- 中文翻译: [待填写]

**上下文:**

```
44:     case 'disconnected':
45:       return {
46:         title: 'Connection to remote server lost',
47:         description: getFailureReason(state),
48:         showRetry: true,
```

---

### 第 54 行: "Remote server connection status"

- 建议键名: `remoteServerConnectionStatus`
- 英文原文: `Remote server connection status`
- 中文翻译: [待填写]

**上下文:**

```
52:     default:
53:       return {
54:         title: 'Remote server connection status',
55:         description: getFailureReason(state),
56:         showRetry: true,
```

---

## apps\electron\src\renderer\components\automations\AutomationCard.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\AutomationCard.tsx`

待翻译数量: 2

### 第 77 行: "When"

- 建议键名: `when`
- 英文原文: `When`
- 中文翻译: [待填写]

**上下文:**

```
75:           {/* Trigger info */}
76:           <div className="space-y-1">
77:             <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">When</h5>
78:             <div className="text-xs text-foreground/70">
79:               <span className="font-medium">{getEventDisplayName(automation.event)}</span>
```

---

### 第 95 行: "Then"

- 建议键名: `then`
- 英文原文: `Then`
- 中文翻译: [待填写]

**上下文:**

```
93:           {/* Actions */}
94:           <div className="space-y-1">
95:             <h5 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Then</h5>
96:             <AutomationActionPreview actions={automation.actions} />
97:           </div>
```

---

## apps\electron\src\renderer\components\automations\AutomationInfoPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\AutomationInfoPage.tsx`

待翻译数量: 39

### 第 62 行: "Edit File"

- 建议键名: `editFile`
- 英文原文: `Edit File`
- 中文翻译: [待填写]

**上下文:**

```
60:       trigger={<EditButton />}
61:       {...getEditConfig('automation-config', workspace.rootPath)}
62:       secondaryAction={{ label: 'Edit File', filePath: `${workspace.rootPath}/automations.json` }}
63:     />
64:   ) : undefined
```

---

### 第 97 行: "Paused"

- 建议键名: `paused`
- 英文原文: `Paused`
- 中文翻译: [待填写]

**上下文:**

```
95:         {!automation.enabled && (
96:           <Info_Alert variant="warning" icon={<PauseCircle className="h-4 w-4" />}>
97:             <Info_Alert.Title>Paused</Info_Alert.Title>
98:             <Info_Alert.Description>
99:               This automation is turned off. Enable it to start running again.
```

---

### 第 106 行: "When"

- 建议键名: `when`
- 英文原文: `When`
- 中文翻译: [待填写]

**上下文:**

```
104:         {/* Section: When */}
105:         <Info_Section
106:           title="When"
107:           description="What causes this automation to run"
108:           actions={editActions}
```

---

### 第 106 行: "When"

- 建议键名: `when`
- 英文原文: `When`
- 中文翻译: [待填写]

**上下文:**

```
104:         {/* Section: When */}
105:         <Info_Section
106:           title="When"
107:           description="What causes this automation to run"
108:           actions={editActions}
```

---

### 第 107 行: "What causes this automation to run"

- 建议键名: `whatCausesThisAutomationToRun`
- 英文原文: `What causes this automation to run`
- 中文翻译: [待填写]

**上下文:**

```
105:         <Info_Section
106:           title="When"
107:           description="What causes this automation to run"
108:           actions={editActions}
109:         >
```

---

### 第 107 行: "What causes this automation to run"

- 建议键名: `whatCausesThisAutomationToRun`
- 英文原文: `What causes this automation to run`
- 中文翻译: [待填写]

**上下文:**

```
105:         <Info_Section
106:           title="When"
107:           description="What causes this automation to run"
108:           actions={editActions}
109:         >
```

---

### 第 111 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
109:         >
110:           <Info_Table>
111:             <Info_Table.Row label="Event">
112:               <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
113:             </Info_Table.Row>
```

---

### 第 111 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
109:         >
110:           <Info_Table>
111:             <Info_Table.Row label="Event">
112:               <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
113:             </Info_Table.Row>
```

---

### 第 114 行: "Timing"

- 建议键名: `timing`
- 英文原文: `Timing`
- 中文翻译: [待填写]

**上下文:**

```
112:               <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
113:             </Info_Table.Row>
114:             <Info_Table.Row label="Timing">
115:               <PhaseBadge event={automation.event} />
116:             </Info_Table.Row>
```

---

### 第 114 行: "Timing"

- 建议键名: `timing`
- 英文原文: `Timing`
- 中文翻译: [待填写]

**上下文:**

```
112:               <Info_Badge color="default">{getEventDisplayName(automation.event)}</Info_Badge>
113:             </Info_Table.Row>
114:             <Info_Table.Row label="Timing">
115:               <PhaseBadge event={automation.event} />
116:             </Info_Table.Row>
```

---

### 第 118 行: "Only when matching"

- 建议键名: `onlyWhenMatching`
- 英文原文: `Only when matching`
- 中文翻译: [待填写]

**上下文:**

```
116:             </Info_Table.Row>
117:             {automation.matcher && (
118:               <Info_Table.Row label="Only when matching">
119:                 <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
120:                   {automation.matcher}
```

---

### 第 118 行: "Only when matching"

- 建议键名: `onlyWhenMatching`
- 英文原文: `Only when matching`
- 中文翻译: [待填写]

**上下文:**

```
116:             </Info_Table.Row>
117:             {automation.matcher && (
118:               <Info_Table.Row label="Only when matching">
119:                 <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
120:                   {automation.matcher}
```

---

### 第 126 行: "Repeats"

- 建议键名: `repeats`
- 英文原文: `Repeats`
- 中文翻译: [待填写]

**上下文:**

```
124:             {automation.cron && (
125:               <>
126:                 <Info_Table.Row label="Repeats" value={describeCron(automation.cron)} />
127:                 <Info_Table.Row label="Schedule expression">
128:                   <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
```

---

### 第 126 行: "Repeats"

- 建议键名: `repeats`
- 英文原文: `Repeats`
- 中文翻译: [待填写]

**上下文:**

```
124:             {automation.cron && (
125:               <>
126:                 <Info_Table.Row label="Repeats" value={describeCron(automation.cron)} />
127:                 <Info_Table.Row label="Schedule expression">
128:                   <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
```

---

### 第 127 行: "Schedule expression"

- 建议键名: `scheduleExpression`
- 英文原文: `Schedule expression`
- 中文翻译: [待填写]

**上下文:**

```
125:               <>
126:                 <Info_Table.Row label="Repeats" value={describeCron(automation.cron)} />
127:                 <Info_Table.Row label="Schedule expression">
128:                   <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
129:                     {automation.cron}
```

---

### 第 127 行: "Schedule expression"

- 建议键名: `scheduleExpression`
- 英文原文: `Schedule expression`
- 中文翻译: [待填写]

**上下文:**

```
125:               <>
126:                 <Info_Table.Row label="Repeats" value={describeCron(automation.cron)} />
127:                 <Info_Table.Row label="Schedule expression">
128:                   <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
129:                     {automation.cron}
```

---

### 第 133 行: "Next runs"

- 建议键名: `nextRuns`
- 英文原文: `Next runs`
- 中文翻译: [待填写]

**上下文:**

```
131:                 </Info_Table.Row>
132:                 {nextRuns.length > 0 && (
133:                   <Info_Table.Row label="Next runs">
134:                     <div className="flex flex-col gap-0.5">
135:                       {(() => {
```

---

### 第 133 行: "Next runs"

- 建议键名: `nextRuns`
- 英文原文: `Next runs`
- 中文翻译: [待填写]

**上下文:**

```
131:                 </Info_Table.Row>
132:                 {nextRuns.length > 0 && (
133:                   <Info_Table.Row label="Next runs">
134:                     <div className="flex flex-col gap-0.5">
135:                       {(() => {
```

---

### 第 147 行: "Timezone"

- 建议键名: `timezone`
- 英文原文: `Timezone`
- 中文翻译: [待填写]

**上下文:**

```
145:                   </Info_Table.Row>
146:                 )}
147:                 <Info_Table.Row label="Timezone" value={automation.timezone || 'System default'} />
148:               </>
149:             )}
```

---

### 第 147 行: "Timezone"

- 建议键名: `timezone`
- 英文原文: `Timezone`
- 中文翻译: [待填写]

**上下文:**

```
145:                   </Info_Table.Row>
146:                 )}
147:                 <Info_Table.Row label="Timezone" value={automation.timezone || 'System default'} />
148:               </>
149:             )}
```

---

### 第 147 行: "System default"

- 建议键名: `systemDefault`
- 英文原文: `System default`
- 中文翻译: [待填写]

**上下文:**

```
145:                   </Info_Table.Row>
146:                 )}
147:                 <Info_Table.Row label="Timezone" value={automation.timezone || 'System default'} />
148:               </>
149:             )}
```

---

### 第 157 行: "Conditions that must pass before actions run"

- 建议键名: `conditionsThatMustPassBeforeActionsRun`
- 英文原文: `Conditions that must pass before actions run`
- 中文翻译: [待填写]

**上下文:**

```
155:           <Info_Section
156:             title="If"
157:             description="Conditions that must pass before actions run"
158:             actions={editActions}
159:           >
```

---

### 第 157 行: "Conditions that must pass before actions run"

- 建议键名: `conditionsThatMustPassBeforeActionsRun`
- 英文原文: `Conditions that must pass before actions run`
- 中文翻译: [待填写]

**上下文:**

```
155:           <Info_Section
156:             title="If"
157:             description="Conditions that must pass before actions run"
158:             actions={editActions}
159:           >
```

---

### 第 174 行: "Then"

- 建议键名: `then`
- 英文原文: `Then`
- 中文翻译: [待填写]

**上下文:**

```
172:         {/* Section: Then */}
173:         <Info_Section
174:           title="Then"
175:           description={`${automation.actions.length} action${automation.actions.length !== 1 ? 's' : ''} to perform`}
176:           actions={editActions}
```

---

### 第 174 行: "Then"

- 建议键名: `then`
- 英文原文: `Then`
- 中文翻译: [待填写]

**上下文:**

```
172:         {/* Section: Then */}
173:         <Info_Section
174:           title="Then"
175:           description={`${automation.actions.length} action${automation.actions.length !== 1 ? 's' : ''} to perform`}
176:           actions={editActions}
```

---

### 第 191 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
189: 
190:         {/* Section: Settings */}
191:         <Info_Section title="Settings" actions={editActions}>
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
```

---

### 第 191 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
189: 
190:         {/* Section: Settings */}
191:         <Info_Section title="Settings" actions={editActions}>
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
```

---

### 第 193 行: "Access Level"

- 建议键名: `accessLevel`
- 英文原文: `Access Level`
- 中文翻译: [待填写]

**上下文:**

```
191:         <Info_Section title="Settings" actions={editActions}>
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
```

---

### 第 193 行: "Access Level"

- 建议键名: `accessLevel`
- 英文原文: `Access Level`
- 中文翻译: [待填写]

**上下文:**

```
191:         <Info_Section title="Settings" actions={editActions}>
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
```

---

### 第 194 行: "Status"

- 建议键名: `status`
- 英文原文: `Status`
- 中文翻译: [待填写]

**上下文:**

```
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
196:                 {automation.enabled ? 'Active' : 'Disabled'}
```

---

### 第 194 行: "Status"

- 建议键名: `status`
- 英文原文: `Status`
- 中文翻译: [待填写]

**上下文:**

```
192:           <Info_Table>
193:             <Info_Table.Row label="Access Level" value={getPermissionDisplayName(automation.permissionMode)} />
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
196:                 {automation.enabled ? 'Active' : 'Disabled'}
```

---

### 第 196 行: "Active"

- 建议键名: `active`
- 英文原文: `Active`
- 中文翻译: [待填写]

**上下文:**

```
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
196:                 {automation.enabled ? 'Active' : 'Disabled'}
197:               </Info_Badge>
198:             </Info_Table.Row>
```

---

### 第 196 行: "Disabled"

- 建议键名: `disabled`
- 英文原文: `Disabled`
- 中文翻译: [待填写]

**上下文:**

```
194:             <Info_Table.Row label="Status">
195:               <Info_Badge color={automation.enabled ? 'success' : 'muted'}>
196:                 {automation.enabled ? 'Active' : 'Disabled'}
197:               </Info_Badge>
198:             </Info_Table.Row>
```

---

### 第 200 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
198:             </Info_Table.Row>
199:             {automation.labels && automation.labels.length > 0 && (
200:               <Info_Table.Row label="Labels">
201:                 <div className="flex gap-1.5 flex-wrap">
202:                   {automation.labels.map((l) => (
```

---

### 第 200 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
198:             </Info_Table.Row>
199:             {automation.labels && automation.labels.length > 0 && (
200:               <Info_Table.Row label="Labels">
201:                 <div className="flex gap-1.5 flex-wrap">
202:                   {automation.labels.map((l) => (
```

---

### 第 213 行: "Recent Activity"

- 建议键名: `recentActivity`
- 英文原文: `Recent Activity`
- 中文翻译: [待填写]

**上下文:**

```
211:         {/* Section: Recent Activity */}
212:         <Info_Section
213:           title="Recent Activity"
214:           description={executions.length > 0 ? `Last ${executions.length} runs` : undefined}
215:         >
```

---

### 第 213 行: "Recent Activity"

- 建议键名: `recentActivity`
- 英文原文: `Recent Activity`
- 中文翻译: [待填写]

**上下文:**

```
211:         {/* Section: Recent Activity */}
212:         <Info_Section
213:           title="Recent Activity"
214:           description={executions.length > 0 ? `Last ${executions.length} runs` : undefined}
215:         >
```

---

### 第 220 行: "Raw config"

- 建议键名: `rawConfig`
- 英文原文: `Raw config`
- 中文翻译: [待填写]

**上下文:**

```
218: 
219:         {/* Section: Raw config (JSON) */}
220:         <Info_Section title="Raw config">
221:           <div className="rounded-[8px] shadow-minimal overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
222:             <Info_Markdown maxHeight={300} fullscreen>
```

---

### 第 220 行: "Raw config"

- 建议键名: `rawConfig`
- 英文原文: `Raw config`
- 中文翻译: [待填写]

**上下文:**

```
218: 
219:         {/* Section: Raw config (JSON) */}
220:         <Info_Section title="Raw config">
221:           <div className="rounded-[8px] shadow-minimal overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
222:             <Info_Markdown maxHeight={300} fullscreen>
```

---

## apps\electron\src\renderer\components\automations\AutomationMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\AutomationMenu.tsx`

待翻译数量: 6

### 第 55 行: "Disable"

- 建议键名: `disable`
- 英文原文: `Disable`
- 中文翻译: [待填写]

**上下文:**

```
53:             <Power className="h-3.5 w-3.5" />
54:           )}
55:           <span className="flex-1">{enabled ? 'Disable' : 'Enable'}</span>
56:         </MenuItem>
57:       )}
```

---

### 第 55 行: "Enable"

- 建议键名: `enable`
- 英文原文: `Enable`
- 中文翻译: [待填写]

**上下文:**

```
53:             <Power className="h-3.5 w-3.5" />
54:           )}
55:           <span className="flex-1">{enabled ? 'Disable' : 'Enable'}</span>
56:         </MenuItem>
57:       )}
```

---

### 第 63 行: "Run Test"

- 建议键名: `runTest`
- 英文原文: `Run Test`
- 中文翻译: [待填写]

**上下文:**

```
61:         <MenuItem onClick={onTest}>
62:           <Play className="h-3.5 w-3.5" />
63:           <span className="flex-1">Run Test</span>
64:         </MenuItem>
65:       )}
```

---

### 第 71 行: "Duplicate"

- 建议键名: `duplicate`
- 英文原文: `Duplicate`
- 中文翻译: [待填写]

**上下文:**

```
69:         <MenuItem onClick={onDuplicate}>
70:           <Copy className="h-3.5 w-3.5" />
71:           <span className="flex-1">Duplicate</span>
72:         </MenuItem>
73:       )}
```

---

### 第 79 行: "Edit Configuration"

- 建议键名: `editConfiguration`
- 英文原文: `Edit Configuration`
- 中文翻译: [待填写]

**上下文:**

```
77:         <MenuItem onClick={onEditJson}>
78:           <FileCode className="h-3.5 w-3.5" />
79:           <span className="flex-1">Edit Configuration</span>
80:         </MenuItem>
81:       )}
```

---

### 第 89 行: "Delete"

- 建议键名: `delete`
- 英文原文: `Delete`
- 中文翻译: [待填写]

**上下文:**

```
87:         <MenuItem onClick={onDelete} variant="destructive">
88:           <Trash2 className="h-3.5 w-3.5" />
89:           <span className="flex-1">Delete</span>
90:         </MenuItem>
91:       )}
```

---

## apps\electron\src\renderer\components\automations\AutomationTestPanel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\AutomationTestPanel.tsx`

待翻译数量: 1

### 第 51 行: "Test Failed"

- 建议键名: `testFailed`
- 英文原文: `Test Failed`
- 中文翻译: [待填写]

**上下文:**

```
49:     return (
50:       <Info_Alert variant="error" icon={<XCircle className="h-4 w-4" />} className={className}>
51:         <Info_Alert.Title>Test Failed</Info_Alert.Title>
52:         {result.stderr && (
53:           <Info_Alert.Description>
```

---

## apps\electron\src\renderer\components\automations\PhaseBadge.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\PhaseBadge.tsx`

待翻译数量: 10

### 第 12 行: "Scheduled"

- 建议键名: `scheduled`
- 英文原文: `Scheduled`
- 中文翻译: [待填写]

**上下文:**

```
10: 
11: const CATEGORY_BADGE: Record<EventCategory, { label: string; color: BadgeColor }> = {
12:   'scheduled':   { label: 'Scheduled', color: 'success' },
13:   'agent-pre':   { label: 'Before',    color: 'warning' },
14:   'agent-post':  { label: 'After',     color: 'success' },
```

---

### 第 13 行: "Before"

- 建议键名: `before`
- 英文原文: `Before`
- 中文翻译: [待填写]

**上下文:**

```
11: const CATEGORY_BADGE: Record<EventCategory, { label: string; color: BadgeColor }> = {
12:   'scheduled':   { label: 'Scheduled', color: 'success' },
13:   'agent-pre':   { label: 'Before',    color: 'warning' },
14:   'agent-post':  { label: 'After',     color: 'success' },
15:   'agent-error': { label: 'On Error',  color: 'destructive' },
```

---

### 第 14 行: "After"

- 建议键名: `after`
- 英文原文: `After`
- 中文翻译: [待填写]

**上下文:**

```
12:   'scheduled':   { label: 'Scheduled', color: 'success' },
13:   'agent-pre':   { label: 'Before',    color: 'warning' },
14:   'agent-post':  { label: 'After',     color: 'success' },
15:   'agent-error': { label: 'On Error',  color: 'destructive' },
16:   'label':       { label: 'Event',     color: 'default' },
```

---

### 第 15 行: "On Error"

- 建议键名: `onError`
- 英文原文: `On Error`
- 中文翻译: [待填写]

**上下文:**

```
13:   'agent-pre':   { label: 'Before',    color: 'warning' },
14:   'agent-post':  { label: 'After',     color: 'success' },
15:   'agent-error': { label: 'On Error',  color: 'destructive' },
16:   'label':       { label: 'Event',     color: 'default' },
17:   'permission':  { label: 'Event',     color: 'default' },
```

---

### 第 16 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
14:   'agent-post':  { label: 'After',     color: 'success' },
15:   'agent-error': { label: 'On Error',  color: 'destructive' },
16:   'label':       { label: 'Event',     color: 'default' },
17:   'permission':  { label: 'Event',     color: 'default' },
18:   'flag':        { label: 'Event',     color: 'default' },
```

---

### 第 17 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
15:   'agent-error': { label: 'On Error',  color: 'destructive' },
16:   'label':       { label: 'Event',     color: 'default' },
17:   'permission':  { label: 'Event',     color: 'default' },
18:   'flag':        { label: 'Event',     color: 'default' },
19:   'todo':        { label: 'Event',     color: 'default' },
```

---

### 第 18 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
16:   'label':       { label: 'Event',     color: 'default' },
17:   'permission':  { label: 'Event',     color: 'default' },
18:   'flag':        { label: 'Event',     color: 'default' },
19:   'todo':        { label: 'Event',     color: 'default' },
20:   'session':     { label: 'Event',     color: 'default' },
```

---

### 第 19 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
17:   'permission':  { label: 'Event',     color: 'default' },
18:   'flag':        { label: 'Event',     color: 'default' },
19:   'todo':        { label: 'Event',     color: 'default' },
20:   'session':     { label: 'Event',     color: 'default' },
21:   'other':       { label: 'Event',     color: 'default' },
```

---

### 第 20 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
18:   'flag':        { label: 'Event',     color: 'default' },
19:   'todo':        { label: 'Event',     color: 'default' },
20:   'session':     { label: 'Event',     color: 'default' },
21:   'other':       { label: 'Event',     color: 'default' },
22: }
```

---

### 第 21 行: "Event"

- 建议键名: `event`
- 英文原文: `Event`
- 中文翻译: [待填写]

**上下文:**

```
19:   'todo':        { label: 'Event',     color: 'default' },
20:   'session':     { label: 'Event',     color: 'default' },
21:   'other':       { label: 'Event',     color: 'default' },
22: }
23: 
```

---

## apps\electron\src\renderer\components\browser\empty-state-prompts.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\browser\empty-state-prompts.ts`

待翻译数量: 3

### 第 17 行: "GitHub Docs: latest Actions updates"

- 建议键名: `githubDocsLatestActionsUpdates`
- 英文原文: `GitHub Docs: latest Actions updates`
- 中文翻译: [待填写]

**上下文:**

```
15:   },
16:   {
17:     short: 'GitHub Docs: latest Actions updates',
18:     full: 'Use the browser to navigate to https://docs.github.com/en, find the latest updates related to GitHub Actions, and summarize actionable changes for a dev team in under 10 bullets.',
19:   },
```

---

### 第 37 行: "Figma Community: trending design systems"

- 建议键名: `figmaCommunityTrendingDesignSystems`
- 英文原文: `Figma Community: trending design systems`
- 中文翻译: [待填写]

**上下文:**

```
35:   },
36:   {
37:     short: 'Figma Community: trending design systems',
38:     full: 'Use the browser to go to https://www.figma.com/community, find top trending design system files this week, and summarize which ones are best for SaaS dashboard UI inspiration.',
39:   },
```

---

### 第 41 行: "Google Search docs: Core Web Vitals checklist"

- 建议键名: `googleSearchDocsCoreWebVitalsChecklist`
- 英文原文: `Google Search docs: Core Web Vitals checklist`
- 中文翻译: [待填写]

**上下文:**

```
39:   },
40:   {
41:     short: 'Google Search docs: Core Web Vitals checklist',
42:     full: 'Use the browser to open https://developers.google.com/search/docs and extract all pages about Core Web Vitals; produce a practical checklist for engineering and SEO teams.',
43:   },
```

---

## apps\electron\src\renderer\components\icons\CraftAppIcon.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\icons\CraftAppIcon.tsx`

待翻译数量: 1

### 第 15 行: "Craft"

- 建议键名: `craft`
- 英文原文: `Craft`
- 中文翻译: [待填写]

**上下文:**

```
13:     <img
14:       src={craftLogo}
15:       alt="Craft"
16:       width={size}
17:       height={size}
```

---

## apps\electron\src\renderer\components\info\Info_DataTable.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\Info_DataTable.tsx`

待翻译数量: 4

### 第 55 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
53:  *   {
54:  *     accessorKey: 'name',
55:  *     header: ({ column }) => <SortableHeader column={column} title="Name" />,
56:  *   },
57:  *   // ...
```

---

### 第 55 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
53:  *   {
54:  *     accessorKey: 'name',
55:  *     header: ({ column }) => <SortableHeader column={column} title="Name" />,
56:  *   },
57:  *   // ...
```

---

### 第 107 行: "Source requires authentication"

- 建议键名: `sourceRequiresAuthentication`
- 英文原文: `Source requires authentication`
- 中文翻译: [待填写]

**上下文:**

```
105:     return (
106:       <div className="px-4 py-6 text-sm text-muted-foreground">
107:         {error === 'Source requires authentication' ? (
108:           <span>Authenticate with this source to view available data</span>
109:         ) : (
```

---

### 第 108 行: "Authenticate with this source to view available data"

- 建议键名: `authenticateWithThisSourceToViewAvailableData`
- 英文原文: `Authenticate with this source to view available data`
- 中文翻译: [待填写]

**上下文:**

```
106:       <div className="px-4 py-6 text-sm text-muted-foreground">
107:         {error === 'Source requires authentication' ? (
108:           <span>Authenticate with this source to view available data</span>
109:         ) : (
110:           <span>{error}</span>
```

---

## apps\electron\src\renderer\components\info\Info_StatusBadge.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\Info_StatusBadge.tsx`

待翻译数量: 2

### 第 13 行: "Allowed"

- 建议键名: `allowed`
- 英文原文: `Allowed`
- 中文翻译: [待填写]

**上下文:**

```
11: 
12: const statusConfig: Record<PermissionStatus, { label: string; color: BadgeColor }> = {
13:   allowed: { label: 'Allowed', color: 'success' },
14:   blocked: { label: 'Blocked', color: 'destructive' },
15:   'requires-permission': { label: 'Ask', color: 'warning' },
```

---

### 第 14 行: "Blocked"

- 建议键名: `blocked`
- 英文原文: `Blocked`
- 中文翻译: [待填写]

**上下文:**

```
12: const statusConfig: Record<PermissionStatus, { label: string; color: BadgeColor }> = {
13:   allowed: { label: 'Allowed', color: 'success' },
14:   blocked: { label: 'Blocked', color: 'destructive' },
15:   'requires-permission': { label: 'Ask', color: 'warning' },
16: }
```

---

## apps\electron\src\renderer\components\info\LabelsDataTable.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\LabelsDataTable.tsx`

待翻译数量: 10

### 第 79 行: "Color"

- 建议键名: `color`
- 英文原文: `Color`
- 中文翻译: [待填写]

**上下文:**

```
77:   {
78:     id: 'color',
79:     header: () => <span className="p-1.5 pl-2.5">Color</span>,
80:     cell: ({ row }) => (
81:       <div className="p-1.5 pl-2.5">
```

---

### 第 94 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
92:   {
93:     accessorKey: 'name',
94:     header: ({ column }) => <SortableHeader column={column} title="Name" />,
95:     cell: ({ row }) => <ExpandableNameCell row={row} />,
96:     meta: { fillWidth: true },
```

---

### 第 94 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
92:   {
93:     accessorKey: 'name',
94:     header: ({ column }) => <SortableHeader column={column} title="Name" />,
95:     cell: ({ row }) => <ExpandableNameCell row={row} />,
96:     meta: { fillWidth: true },
```

---

### 第 101 行: "Type"

- 建议键名: `type`
- 英文原文: `Type`
- 中文翻译: [待填写]

**上下文:**

```
99:     id: 'valueType',
100:     accessorKey: 'valueType',
101:     header: ({ column }) => <SortableHeader column={column} title="Type" />,
102:     cell: ({ row }) => (
103:       <div className="p-1.5 pl-2.5">
```

---

### 第 101 行: "Type"

- 建议键名: `type`
- 英文原文: `Type`
- 中文翻译: [待填写]

**上下文:**

```
99:     id: 'valueType',
100:     accessorKey: 'valueType',
101:     header: ({ column }) => <SortableHeader column={column} title="Type" />,
102:     cell: ({ row }) => (
103:       <div className="p-1.5 pl-2.5">
```

---

### 第 130 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
128:   maxHeight = 400,
129:   fullscreen = false,
130:   fullscreenTitle = 'Labels',
131:   className,
132: }: LabelsDataTableProps) {
```

---

### 第 147 行: "View Fullscreen"

- 建议键名: `viewFullscreen`
- 英文原文: `View Fullscreen`
- 中文翻译: [待填写]

**上下文:**

```
145:         'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
146:       )}
147:       title="View Fullscreen"
148:     >
149:       <Maximize2 className="w-3.5 h-3.5" />
```

---

### 第 147 行: "View Fullscreen"

- 建议键名: `viewFullscreen`
- 英文原文: `View Fullscreen`
- 中文翻译: [待填写]

**上下文:**

```
145:         'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
146:       )}
147:       title="View Fullscreen"
148:     >
149:       <Maximize2 className="w-3.5 h-3.5" />
```

---

### 第 165 行: "No labels configured"

- 建议键名: `noLabelsConfigured`
- 英文原文: `No labels configured`
- 中文翻译: [待填写]

**上下文:**

```
163:         searchable={searchable ? { placeholder: 'Search labels...' } : false}
164:         maxHeight={maxHeight}
165:         emptyContent="No labels configured"
166:         floatingAction={fullscreenButton}
167:         className={cn(fullscreen && 'group', className)}
```

---

### 第 184 行: "No labels configured"

- 建议键名: `noLabelsConfigured`
- 英文原文: `No labels configured`
- 中文翻译: [待填写]

**上下文:**

```
182:             data={data}
183:             searchable={searchable ? { placeholder: 'Search labels...' } : false}
184:             emptyContent="No labels configured"
185:             getSubRows={getSubRows}
186:           />
```

---

## apps\electron\src\renderer\components\info\ToolsDataTable.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\ToolsDataTable.tsx`

待翻译数量: 6

### 第 36 行: "Access"

- 建议键名: `access`
- 英文原文: `Access`
- 中文翻译: [待填写]

**上下文:**

```
34:   {
35:     accessorKey: 'permission',
36:     header: ({ column }) => <SortableHeader column={column} title="Access" />,
37:     cell: ({ row }) => (
38:       <div className="p-1.5 pl-2.5">
```

---

### 第 36 行: "Access"

- 建议键名: `access`
- 英文原文: `Access`
- 中文翻译: [待填写]

**上下文:**

```
34:   {
35:     accessorKey: 'permission',
36:     header: ({ column }) => <SortableHeader column={column} title="Access" />,
37:     cell: ({ row }) => (
38:       <div className="p-1.5 pl-2.5">
```

---

### 第 46 行: "Tool"

- 建议键名: `tool`
- 英文原文: `Tool`
- 中文翻译: [待填写]

**上下文:**

```
44:   {
45:     accessorKey: 'name',
46:     header: ({ column }) => <SortableHeader column={column} title="Tool" />,
47:     cell: ({ row }) => (
48:       <div className="p-1.5 pl-2.5">
```

---

### 第 46 行: "Tool"

- 建议键名: `tool`
- 英文原文: `Tool`
- 中文翻译: [待填写]

**上下文:**

```
44:   {
45:     accessorKey: 'name',
46:     header: ({ column }) => <SortableHeader column={column} title="Tool" />,
47:     cell: ({ row }) => (
48:       <div className="p-1.5 pl-2.5">
```

---

### 第 59 行: "Description"

- 建议键名: `description`
- 英文原文: `Description`
- 中文翻译: [待填写]

**上下文:**

```
57:     id: 'description',
58:     accessorKey: 'description',
59:     header: () => <span className="p-1.5 pl-2.5">Description</span>,
60:     cell: ({ row }) => (
61:       <div className="p-1.5 pl-2.5 min-w-0">
```

---

### 第 83 行: "No tools available"

- 建议键名: `noToolsAvailable`
- 英文原文: `No tools available`
- 中文翻译: [待填写]

**上下文:**

```
81:       error={error}
82:       maxHeight={maxHeight}
83:       emptyContent="No tools available"
84:       className={className}
85:     />
```

---

## apps\electron\src\renderer\components\onboarding\GitBashWarning.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\onboarding\GitBashWarning.tsx`

待翻译数量: 2

### 第 63 行: "Git Bash Required"

- 建议键名: `gitBashRequired`
- 英文原文: `Git Bash Required`
- 中文翻译: [待填写]

**上下文:**

```
61:   return (
62:     <StepFormLayout
63:       title="Git Bash Required"
64:       description="Craft Agent needs Git Bash to run shell commands on Windows. It was not found on your system."
65:     >
```

---

### 第 63 行: "Git Bash Required"

- 建议键名: `gitBashRequired`
- 英文原文: `Git Bash Required`
- 中文翻译: [待填写]

**上下文:**

```
61:   return (
62:     <StepFormLayout
63:       title="Git Bash Required"
64:       description="Craft Agent needs Git Bash to run shell commands on Windows. It was not found on your system."
65:     >
```

---

## apps\electron\src\renderer\components\onboarding\OnboardingWizard.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\onboarding\OnboardingWizard.tsx`

待翻译数量: 1

### 第 63 行: "Setup later"

- 建议键名: `setupLater`
- 英文原文: `Setup later`
- 中文翻译: [待填写]

**上下文:**

```
61:   // Provider select (new flow)
62:   onSelectProvider?: (choice: ProviderChoice) => void
63:   /** Called when user chooses "Setup later" on provider select */
64:   onSkipSetup?: () => void
65: 
```

---

## apps\electron\src\renderer\components\onboarding\ReauthScreen.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\onboarding\ReauthScreen.tsx`

待翻译数量: 3

### 第 29 行: "Login failed"

- 建议键名: `loginFailed`
- 英文原文: `Login failed`
- 中文翻译: [待填写]

**上下文:**

```
27:       await onLogin()
28:     } catch (err) {
29:       setError(err instanceof Error ? err.message : 'Login failed')
30:       setIsLoading(false)
31:     }
```

---

### 第 47 行: "Session Expired"

- 建议键名: `sessionExpired`
- 英文原文: `Session Expired`
- 中文翻译: [待填写]

**上下文:**

```
45:             </div>
46:           }
47:           title="Session Expired"
48:           description={
49:             <>
```

---

### 第 47 行: "Session Expired"

- 建议键名: `sessionExpired`
- 英文原文: `Session Expired`
- 中文翻译: [待填写]

**上下文:**

```
45:             </div>
46:           }
47:           title="Session Expired"
48:           description={
49:             <>
```

---

## apps\electron\src\renderer\components\settings\SettingsEditRow.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsEditRow.tsx`

待翻译数量: 1

### 第 22 行: "Change the API endpoint"

- 建议键名: `changeTheApiEndpoint`
- 英文原文: `Change the API endpoint`
- 中文翻译: [待填写]

**上下文:**

```
20:   /** Context for the edit popover - tells the agent what's being edited */
21:   editContext: EditContext
22:   /** Example text for the edit placeholder (e.g., "Change the API endpoint") */
23:   editExample?: string
24:   /** Whether the row is inside a card (affects padding) */
```

---

## apps\electron\src\renderer\components\settings\SettingsRow.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsRow.tsx`

待翻译数量: 6

### 第 21 行: "Change"

- 建议键名: `change`
- 英文原文: `Change`
- 中文翻译: [待填写]

**上下文:**

```
19:   /** Click handler for the entire row */
20:   onClick?: () => void
21:   /** Optional action button (e.g., "Change" button) */
22:   action?: React.ReactNode
23:   /** Additional className */
```

---

### 第 34 行: "Working Directory"

- 建议键名: `workingDirectory`
- 英文原文: `Working Directory`
- 中文翻译: [待填写]

**上下文:**

```
32:  * @example
33:  * <SettingsRow
34:  *   label="Working Directory"
35:  *   description="~/Documents"
36:  *   action={<Button variant="ghost" size="sm">Change</Button>}
```

---

### 第 34 行: "Working Directory"

- 建议键名: `workingDirectory`
- 英文原文: `Working Directory`
- 中文翻译: [待填写]

**上下文:**

```
32:  * @example
33:  * <SettingsRow
34:  *   label="Working Directory"
35:  *   description="~/Documents"
36:  *   action={<Button variant="ghost" size="sm">Change</Button>}
```

---

### 第 36 行: "Change"

- 建议键名: `change`
- 英文原文: `Change`
- 中文翻译: [待填写]

**上下文:**

```
34:  *   label="Working Directory"
35:  *   description="~/Documents"
36:  *   action={<Button variant="ghost" size="sm">Change</Button>}
37:  * />
38:  */
```

---

### 第 84 行: "Theme"

- 建议键名: `theme`
- 英文原文: `Theme`
- 中文翻译: [待填写]

**上下文:**

```
82:  *
83:  * @example
84:  * <SettingsRowLabel label="Theme" />
85:  * <SettingsSegmentedControl ... />
86:  */
```

---

### 第 84 行: "Theme"

- 建议键名: `theme`
- 英文原文: `Theme`
- 中文翻译: [待填写]

**上下文:**

```
82:  *
83:  * @example
84:  * <SettingsRowLabel label="Theme" />
85:  * <SettingsSegmentedControl ... />
86:  */
```

---

## apps\electron\src\renderer\components\settings\SettingsSection.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsSection.tsx`

待翻译数量: 11

### 第 33 行: "Billing"

- 建议键名: `billing`
- 英文原文: `Billing`
- 中文翻译: [待填写]

**上下文:**

```
31:  *
32:  * @example
33:  * <SettingsSection title="Billing" description="Choose how you pay">
34:  *   <SettingsRadioGroup>...</SettingsRadioGroup>
35:  * </SettingsSection>
```

---

### 第 33 行: "Choose how you pay"

- 建议键名: `chooseHowYouPay`
- 英文原文: `Choose how you pay`
- 中文翻译: [待填写]

**上下文:**

```
31:  *
32:  * @example
33:  * <SettingsSection title="Billing" description="Choose how you pay">
34:  *   <SettingsRadioGroup>...</SettingsRadioGroup>
35:  * </SettingsSection>
```

---

### 第 33 行: "Billing"

- 建议键名: `billing`
- 英文原文: `Billing`
- 中文翻译: [待填写]

**上下文:**

```
31:  *
32:  * @example
33:  * <SettingsSection title="Billing" description="Choose how you pay">
34:  *   <SettingsRadioGroup>...</SettingsRadioGroup>
35:  * </SettingsSection>
```

---

### 第 33 行: "Choose how you pay"

- 建议键名: `chooseHowYouPay`
- 英文原文: `Choose how you pay`
- 中文翻译: [待填写]

**上下文:**

```
31:  *
32:  * @example
33:  * <SettingsSection title="Billing" description="Choose how you pay">
34:  *   <SettingsRadioGroup>...</SettingsRadioGroup>
35:  * </SettingsSection>
```

---

### 第 82 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
80: 
81: /**
82:  * SettingsGroup - Top-level divider for major sections (e.g., "App" vs "Workspace")
83:  *
84:  * @example
```

---

### 第 85 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
83:  *
84:  * @example
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
```

---

### 第 85 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
83:  *
84:  * @example
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
```

---

### 第 86 行: "Model"

- 建议键名: `model`
- 英文原文: `Model`
- 中文翻译: [待填写]

**上下文:**

```
84:  * @example
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
88:  * </SettingsGroup>
```

---

### 第 86 行: "Model"

- 建议键名: `model`
- 英文原文: `Model`
- 中文翻译: [待填写]

**上下文:**

```
84:  * @example
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
88:  * </SettingsGroup>
```

---

### 第 87 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
88:  * </SettingsGroup>
89:  */
```

---

### 第 87 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
85:  * <SettingsGroup title="Workspace">
86:  *   <SettingsSection title="Model">...</SettingsSection>
87:  *   <SettingsSection title="Permissions">...</SettingsSection>
88:  * </SettingsGroup>
89:  */
```

---

## apps\electron\src\renderer\components\settings\SettingsSegmentedControl.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsSegmentedControl.tsx`

待翻译数量: 3

### 第 41 行: "System"

- 建议键名: `system`
- 英文原文: `System`
- 中文翻译: [待填写]

**上下文:**

```
39:  *   onValueChange={setTheme}
40:  *   options={[
41:  *     { value: 'system', label: 'System', icon: <Monitor /> },
42:  *     { value: 'light', label: 'Light', icon: <Sun /> },
43:  *     { value: 'dark', label: 'Dark', icon: <Moon /> },
```

---

### 第 42 行: "Light"

- 建议键名: `light`
- 英文原文: `Light`
- 中文翻译: [待填写]

**上下文:**

```
40:  *   options={[
41:  *     { value: 'system', label: 'System', icon: <Monitor /> },
42:  *     { value: 'light', label: 'Light', icon: <Sun /> },
43:  *     { value: 'dark', label: 'Dark', icon: <Moon /> },
44:  *   ]}
```

---

### 第 43 行: "Dark"

- 建议键名: `dark`
- 英文原文: `Dark`
- 中文翻译: [待填写]

**上下文:**

```
41:  *     { value: 'system', label: 'System', icon: <Monitor /> },
42:  *     { value: 'light', label: 'Light', icon: <Sun /> },
43:  *     { value: 'dark', label: 'Dark', icon: <Moon /> },
44:  *   ]}
45:  * />
```

---

## apps\electron\src\renderer\components\settings\SettingsTextarea.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsTextarea.tsx`

待翻译数量: 4

### 第 43 行: "Notes"

- 建议键名: `notes`
- 英文原文: `Notes`
- 中文翻译: [待填写]

**上下文:**

```
41:  * @example
42:  * <SettingsTextarea
43:  *   label="Notes"
44:  *   description="Additional context for the AI assistant"
45:  *   value={notes}
```

---

### 第 43 行: "Notes"

- 建议键名: `notes`
- 英文原文: `Notes`
- 中文翻译: [待填写]

**上下文:**

```
41:  * @example
42:  * <SettingsTextarea
43:  *   label="Notes"
44:  *   description="Additional context for the AI assistant"
45:  *   value={notes}
```

---

### 第 44 行: "Additional context for the AI assistant"

- 建议键名: `additionalContextForTheAiAssistant`
- 英文原文: `Additional context for the AI assistant`
- 中文翻译: [待填写]

**上下文:**

```
42:  * <SettingsTextarea
43:  *   label="Notes"
44:  *   description="Additional context for the AI assistant"
45:  *   value={notes}
46:  *   onChange={setNotes}
```

---

### 第 44 行: "Additional context for the AI assistant"

- 建议键名: `additionalContextForTheAiAssistant`
- 英文原文: `Additional context for the AI assistant`
- 中文翻译: [待填写]

**上下文:**

```
42:  * <SettingsTextarea
43:  *   label="Notes"
44:  *   description="Additional context for the AI assistant"
45:  *   value={notes}
46:  *   onChange={setNotes}
```

---

## apps\electron\src\renderer\components\settings\SettingsToggle.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsToggle.tsx`

待翻译数量: 4

### 第 36 行: "Desktop notifications"

- 建议键名: `desktopNotifications`
- 英文原文: `Desktop notifications`
- 中文翻译: [待填写]

**上下文:**

```
34:  * <SettingsCard>
35:  *   <SettingsToggle
36:  *     label="Desktop notifications"
37:  *     description="Get notified when AI finishes working"
38:  *     checked={enabled}
```

---

### 第 36 行: "Desktop notifications"

- 建议键名: `desktopNotifications`
- 英文原文: `Desktop notifications`
- 中文翻译: [待填写]

**上下文:**

```
34:  * <SettingsCard>
35:  *   <SettingsToggle
36:  *     label="Desktop notifications"
37:  *     description="Get notified when AI finishes working"
38:  *     checked={enabled}
```

---

### 第 37 行: "Get notified when AI finishes working"

- 建议键名: `getNotifiedWhenAiFinishesWorking`
- 英文原文: `Get notified when AI finishes working`
- 中文翻译: [待填写]

**上下文:**

```
35:  *   <SettingsToggle
36:  *     label="Desktop notifications"
37:  *     description="Get notified when AI finishes working"
38:  *     checked={enabled}
39:  *     onCheckedChange={setEnabled}
```

---

### 第 37 行: "Get notified when AI finishes working"

- 建议键名: `getNotifiedWhenAiFinishesWorking`
- 英文原文: `Get notified when AI finishes working`
- 中文翻译: [待填写]

**上下文:**

```
35:  *   <SettingsToggle
36:  *     label="Desktop notifications"
37:  *     description="Get notified when AI finishes working"
38:  *     checked={enabled}
39:  *     onCheckedChange={setEnabled}
```

---

## apps\electron\src\renderer\components\ui\entity-list-empty.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\entity-list-empty.tsx`

待翻译数量: 2

### 第 16 行: "Learn more"

- 建议键名: `learnMore`
- 英文原文: `Learn more`
- 中文翻译: [待填写]

**上下文:**

```
14:   title: string
15:   description: string
16:   /** Auto-renders a "Learn more" button linking to this doc key */
17:   docKey?: DocFeature
18:   /** Extra action buttons rendered after "Learn more" */
```

---

### 第 18 行: "Learn more"

- 建议键名: `learnMore`
- 英文原文: `Learn more`
- 中文翻译: [待填写]

**上下文:**

```
16:   /** Auto-renders a "Learn more" button linking to this doc key */
17:   docKey?: DocFeature
18:   /** Extra action buttons rendered after "Learn more" */
19:   children?: React.ReactNode
20:   className?: string
```

---

## apps\electron\src\renderer\components\ui\entity-list.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\entity-list.tsx`

待翻译数量: 2

### 第 128 行: "Expand"

- 建议键名: `expand`
- 英文原文: `Expand`
- 中文翻译: [待填写]

**上下文:**

```
126:       <StyledContextMenuContent>
127:         <StyledContextMenuItem onClick={onToggle}>
128:           {isCollapsed ? 'Expand' : 'Collapse'}
129:         </StyledContextMenuItem>
130:         <StyledContextMenuSeparator />
```

---

### 第 128 行: "Collapse"

- 建议键名: `collapse`
- 英文原文: `Collapse`
- 中文翻译: [待填写]

**上下文:**

```
126:       <StyledContextMenuContent>
127:         <StyledContextMenuItem onClick={onToggle}>
128:           {isCollapsed ? 'Expand' : 'Collapse'}
129:         </StyledContextMenuItem>
130:         <StyledContextMenuSeparator />
```

---

## apps\electron\src\renderer\components\ui\HeaderMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\HeaderMenu.tsx`

待翻译数量: 4

### 第 6 行: "Learn More"

- 建议键名: `learnMore`
- 英文原文: `Learn More`
- 中文翻译: [待填写]

**上下文:**

```
4:  * A "..." dropdown menu for panel headers with built-in Open in New Window action.
5:  * Pass page-specific menu items as children; they appear above the separator.
6:  * Optionally includes a "Learn More" link to documentation when helpFeature is provided.
7:  */
8: 
```

---

### 第 28 行: "Learn More"

- 建议键名: `learnMore`
- 英文原文: `Learn More`
- 中文翻译: [待填写]

**上下文:**

```
26:   /** Page-specific menu items (rendered before Open in New Window) */
27:   children?: React.ReactNode
28:   /** Documentation feature - when provided, adds a "Learn More" link to docs */
29:   helpFeature?: DocFeature
30: }
```

---

### 第 57 行: "Open in New Window"

- 建议键名: `openInNewWindow`
- 英文原文: `Open in New Window`
- 中文翻译: [待填写]

**上下文:**

```
55:         <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
56:           <AppWindow className="h-3.5 w-3.5" />
57:           <span className="flex-1">Open in New Window</span>
58:         </StyledDropdownMenuItem>
59:         {helpFeature && (
```

---

### 第 64 行: "Learn More"

- 建议键名: `learnMore`
- 英文原文: `Learn More`
- 中文翻译: [待填写]

**上下文:**

```
62:             <StyledDropdownMenuItem onClick={handleLearnMore}>
63:               <ExternalLink className="h-3.5 w-3.5" />
64:               <span className="flex-1">Learn More</span>
65:             </StyledDropdownMenuItem>
66:           </>
```

---

## apps\electron\src\renderer\components\ui\source-status-indicator.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\source-status-indicator.tsx`

待翻译数量: 10

### 第 43 行: "Connected"

- 建议键名: `connected`
- 英文原文: `Connected`
- 中文翻译: [待填写]

**上下文:**

```
41:     color: 'bg-success',
42:     pulseColor: 'bg-success/80',
43:     label: 'Connected',
44:     description: 'Source is connected and working',
45:   },
```

---

### 第 44 行: "Source is connected and working"

- 建议键名: `sourceIsConnectedAndWorking`
- 英文原文: `Source is connected and working`
- 中文翻译: [待填写]

**上下文:**

```
42:     pulseColor: 'bg-success/80',
43:     label: 'Connected',
44:     description: 'Source is connected and working',
45:   },
46:   needs_auth: {
```

---

### 第 49 行: "Needs Authentication"

- 建议键名: `needsAuthentication`
- 英文原文: `Needs Authentication`
- 中文翻译: [待填写]

**上下文:**

```
47:     color: 'bg-info',
48:     pulseColor: 'bg-info/80',
49:     label: 'Needs Authentication',
50:     description: 'Source requires authentication to connect',
51:   },
```

---

### 第 50 行: "Source requires authentication to connect"

- 建议键名: `sourceRequiresAuthenticationToConnect`
- 英文原文: `Source requires authentication to connect`
- 中文翻译: [待填写]

**上下文:**

```
48:     pulseColor: 'bg-info/80',
49:     label: 'Needs Authentication',
50:     description: 'Source requires authentication to connect',
51:   },
52:   failed: {
```

---

### 第 55 行: "Connection Failed"

- 建议键名: `connectionFailed`
- 英文原文: `Connection Failed`
- 中文翻译: [待填写]

**上下文:**

```
53:     color: 'bg-destructive',
54:     pulseColor: 'bg-destructive/80',
55:     label: 'Connection Failed',
56:     description: 'Failed to connect to source',
57:   },
```

---

### 第 56 行: "Failed to connect to source"

- 建议键名: `failedToConnectToSource`
- 英文原文: `Failed to connect to source`
- 中文翻译: [待填写]

**上下文:**

```
54:     pulseColor: 'bg-destructive/80',
55:     label: 'Connection Failed',
56:     description: 'Failed to connect to source',
57:   },
58:   untested: {
```

---

### 第 61 行: "Not Tested"

- 建议键名: `notTested`
- 英文原文: `Not Tested`
- 中文翻译: [待填写]

**上下文:**

```
59:     color: 'bg-foreground/40',
60:     pulseColor: 'bg-foreground/30',
61:     label: 'Not Tested',
62:     description: 'Connection has not been tested',
63:   },
```

---

### 第 62 行: "Connection has not been tested"

- 建议键名: `connectionHasNotBeenTested`
- 英文原文: `Connection has not been tested`
- 中文翻译: [待填写]

**上下文:**

```
60:     pulseColor: 'bg-foreground/30',
61:     label: 'Not Tested',
62:     description: 'Connection has not been tested',
63:   },
64:   local_disabled: {
```

---

### 第 67 行: "Disabled"

- 建议键名: `disabled`
- 英文原文: `Disabled`
- 中文翻译: [待填写]

**上下文:**

```
65:     color: 'bg-foreground/30',
66:     pulseColor: 'bg-foreground/20',
67:     label: 'Disabled',
68:     description: 'Local MCP servers are disabled in Settings',
69:   },
```

---

### 第 68 行: "Local MCP servers are disabled in Settings"

- 建议键名: `localMcpServersAreDisabledInSettings`
- 英文原文: `Local MCP servers are disabled in Settings`
- 中文翻译: [待填写]

**上下文:**

```
66:     pulseColor: 'bg-foreground/20',
67:     label: 'Disabled',
68:     description: 'Local MCP servers are disabled in Settings',
69:   },
70: }
```

---

## apps\electron\src\renderer\components\workspace\AddWorkspaceStep_Choice.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\workspace\AddWorkspaceStep_Choice.tsx`

待翻译数量: 8

### 第 65 行: "Add Workspace"

- 建议键名: `addWorkspace`
- 英文原文: `Add Workspace`
- 中文翻译: [待填写]

**上下文:**

```
63:       <div className="mt-2" />
64:       <AddWorkspaceStepHeader
65:         title="Add Workspace"
66:         description="Where your ideas meet the tools to make them happen."
67:       />
```

---

### 第 65 行: "Add Workspace"

- 建议键名: `addWorkspace`
- 英文原文: `Add Workspace`
- 中文翻译: [待填写]

**上下文:**

```
63:       <div className="mt-2" />
64:       <AddWorkspaceStepHeader
65:         title="Add Workspace"
66:         description="Where your ideas meet the tools to make them happen."
67:       />
```

---

### 第 72 行: "Create new"

- 建议键名: `createNew`
- 英文原文: `Create new`
- 中文翻译: [待填写]

**上下文:**

```
70:         <ChoiceCard
71:           icon={<FolderPlus className="h-5 w-5" />}
72:           title="Create new"
73:           description="Start fresh with an empty workspace."
74:           onClick={onCreateNew}
```

---

### 第 72 行: "Create new"

- 建议键名: `createNew`
- 英文原文: `Create new`
- 中文翻译: [待填写]

**上下文:**

```
70:         <ChoiceCard
71:           icon={<FolderPlus className="h-5 w-5" />}
72:           title="Create new"
73:           description="Start fresh with an empty workspace."
74:           onClick={onCreateNew}
```

---

### 第 80 行: "Open folder"

- 建议键名: `openFolder`
- 英文原文: `Open folder`
- 中文翻译: [待填写]

**上下文:**

```
78:         <ChoiceCard
79:           icon={<FolderOpen className="h-5 w-5" />}
80:           title="Open folder"
81:           description="Choose an existing folder as workspace."
82:           onClick={onOpenFolder}
```

---

### 第 80 行: "Open folder"

- 建议键名: `openFolder`
- 英文原文: `Open folder`
- 中文翻译: [待填写]

**上下文:**

```
78:         <ChoiceCard
79:           icon={<FolderOpen className="h-5 w-5" />}
80:           title="Open folder"
81:           description="Choose an existing folder as workspace."
82:           onClick={onOpenFolder}
```

---

### 第 87 行: "Connect to remote server"

- 建议键名: `connectToRemoteServer`
- 英文原文: `Connect to remote server`
- 中文翻译: [待填写]

**上下文:**

```
85:         <ChoiceCard
86:           icon={<Cloud className="h-5 w-5" />}
87:           title="Connect to remote server"
88:           description="Use a remote Craft Agent Server."
89:           onClick={onConnectRemote}
```

---

### 第 87 行: "Connect to remote server"

- 建议键名: `connectToRemoteServer`
- 英文原文: `Connect to remote server`
- 中文翻译: [待填写]

**上下文:**

```
85:         <ChoiceCard
86:           icon={<Cloud className="h-5 w-5" />}
87:           title="Connect to remote server"
88:           description="Use a remote Craft Agent Server."
89:           onClick={onConnectRemote}
```

---

## apps\electron\src\renderer\components\workspace\primitives.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\workspace\primitives.tsx`

待翻译数量: 4

### 第 94 行: "Create"

- 建议键名: `create`
- 英文原文: `Create`
- 中文翻译: [待填写]

**上下文:**

```
92:  * AddWorkspacePrimaryButton - Primary action button for workspace flow
93:  *
94:  * Used for main actions like "Create", "Open", etc.
95:  * Includes loading state with spinner.
96:  */
```

---

### 第 94 行: "Open"

- 建议键名: `open`
- 英文原文: `Open`
- 中文翻译: [待填写]

**上下文:**

```
92:  * AddWorkspacePrimaryButton - Primary action button for workspace flow
93:  *
94:  * Used for main actions like "Create", "Open", etc.
95:  * Includes loading state with spinner.
96:  */
```

---

### 第 98 行: "Continue"

- 建议键名: `continue`
- 英文原文: `Continue`
- 中文翻译: [待填写]

**上下文:**

```
96:  */
97: export function AddWorkspacePrimaryButton({
98:   children = 'Continue',
99:   loading,
100:   loadingText,
```

---

### 第 130 行: "Browse"

- 建议键名: `browse`
- 英文原文: `Browse`
- 中文翻译: [待填写]

**上下文:**

```
128:  * AddWorkspaceSecondaryButton - Secondary action button for workspace flow
129:  *
130:  * Used for actions like "Browse", or inline actions within forms.
131:  */
132: export function AddWorkspaceSecondaryButton({
```

---

## apps\electron\src\renderer\hooks\useBackgroundTasks.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\hooks\useBackgroundTasks.ts`

待翻译数量: 1

### 第 73 行: "Killing agent tasks not yet implemented"

- 建议键名: `killingAgentTasksNotYetImplemented`
- 英文原文: `Killing agent tasks not yet implemented`
- 中文翻译: [待填写]

**上下文:**

```
71:       // For agents, we don't have a direct kill mechanism yet
72:       // The model would need to use TaskOutput to check status
73:       console.warn('Killing agent tasks not yet implemented')
74:     }
75: 
```

---

## apps\electron\src\renderer\i18n\locales\en-US.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\i18n\locales\en-US.ts`

待翻译数量: 199

### 第 7 行: "Notifications and updates"

- 建议键名: `notificationsAndUpdates`
- 英文原文: `Notifications and updates`
- 中文翻译: [待填写]

**上下文:**

```
5:     app: {
6:       label: 'App',
7:       description: 'Notifications and updates'
8:     },
9:     ai: {
```

---

### 第 14 行: "Appearance"

- 建议键名: `appearance`
- 英文原文: `Appearance`
- 中文翻译: [待填写]

**上下文:**

```
12:     },
13:     appearance: {
14:       label: 'Appearance',
15:       description: 'Theme, font, tool icons'
16:     },
```

---

### 第 18 行: "Input"

- 建议键名: `input`
- 英文原文: `Input`
- 中文翻译: [待填写]

**上下文:**

```
16:     },
17:     input: {
18:       label: 'Input',
19:       description: 'Send key, spell check'
20:     },
```

---

### 第 22 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
20:     },
21:     workspace: {
22:       label: 'Workspace',
23:       description: 'Name, icon, working directory'
24:     },
```

---

### 第 26 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
24:     },
25:     permissions: {
26:       label: 'Permissions',
27:       description: 'Explore mode rules'
28:     },
```

---

### 第 27 行: "Explore mode rules"

- 建议键名: `exploreModeRules`
- 英文原文: `Explore mode rules`
- 中文翻译: [待填写]

**上下文:**

```
25:     permissions: {
26:       label: 'Permissions',
27:       description: 'Explore mode rules'
28:     },
29:     labels: {
```

---

### 第 30 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
28:     },
29:     labels: {
30:       label: 'Labels',
31:       description: 'Manage session labels'
32:     },
```

---

### 第 31 行: "Manage session labels"

- 建议键名: `manageSessionLabels`
- 英文原文: `Manage session labels`
- 中文翻译: [待填写]

**上下文:**

```
29:     labels: {
30:       label: 'Labels',
31:       description: 'Manage session labels'
32:     },
33:     server: {
```

---

### 第 34 行: "Server"

- 建议键名: `server`
- 英文原文: `Server`
- 中文翻译: [待填写]

**上下文:**

```
32:     },
33:     server: {
34:       label: 'Server',
35:       description: 'Remote server access'
36:     },
```

---

### 第 35 行: "Remote server access"

- 建议键名: `remoteServerAccess`
- 英文原文: `Remote server access`
- 中文翻译: [待填写]

**上下文:**

```
33:     server: {
34:       label: 'Server',
35:       description: 'Remote server access'
36:     },
37:     shortcuts: {
```

---

### 第 38 行: "Shortcuts"

- 建议键名: `shortcuts`
- 英文原文: `Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
36:     },
37:     shortcuts: {
38:       label: 'Shortcuts',
39:       description: 'Keyboard shortcuts'
40:     },
```

---

### 第 39 行: "Keyboard shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
37:     shortcuts: {
38:       label: 'Shortcuts',
39:       description: 'Keyboard shortcuts'
40:     },
41:     preferences: {
```

---

### 第 42 行: "Preferences"

- 建议键名: `preferences`
- 英文原文: `Preferences`
- 中文翻译: [待填写]

**上下文:**

```
40:     },
41:     preferences: {
42:       label: 'Preferences',
43:       description: 'User preferences'
44:     },
```

---

### 第 43 行: "User preferences"

- 建议键名: `userPreferences`
- 英文原文: `User preferences`
- 中文翻译: [待填写]

**上下文:**

```
41:     preferences: {
42:       label: 'Preferences',
43:       description: 'User preferences'
44:     },
45:     language: {
```

---

### 第 46 行: "Language"

- 建议键名: `language`
- 英文原文: `Language`
- 中文翻译: [待填写]

**上下文:**

```
44:     },
45:     language: {
46:       label: 'Language',
47:       description: 'Interface language',
48:       enUS: 'English',
```

---

### 第 47 行: "Interface language"

- 建议键名: `interfaceLanguage`
- 英文原文: `Interface language`
- 中文翻译: [待填写]

**上下文:**

```
45:     language: {
46:       label: 'Language',
47:       description: 'Interface language',
48:       enUS: 'English',
49:       zhCN: '中文'
```

---

### 第 48 行: "English"

- 建议键名: `english`
- 英文原文: `English`
- 中文翻译: [待填写]

**上下文:**

```
46:       label: 'Language',
47:       description: 'Interface language',
48:       enUS: 'English',
49:       zhCN: '中文'
50:     }
```

---

### 第 55 行: "Open in New Window"

- 建议键名: `openInNewWindow`
- 英文原文: `Open in New Window`
- 中文翻译: [待填写]

**上下文:**

```
53:   // Common
54:   common: {
55:     openInNewWindow: 'Open in New Window',
56:     save: 'Save',
57:     cancel: 'Cancel',
```

---

### 第 56 行: "Save"

- 建议键名: `save`
- 英文原文: `Save`
- 中文翻译: [待填写]

**上下文:**

```
54:   common: {
55:     openInNewWindow: 'Open in New Window',
56:     save: 'Save',
57:     cancel: 'Cancel',
58:     delete: 'Delete',
```

---

### 第 57 行: "Cancel"

- 建议键名: `cancel`
- 英文原文: `Cancel`
- 中文翻译: [待填写]

**上下文:**

```
55:     openInNewWindow: 'Open in New Window',
56:     save: 'Save',
57:     cancel: 'Cancel',
58:     delete: 'Delete',
59:     edit: 'Edit',
```

---

### 第 58 行: "Delete"

- 建议键名: `delete`
- 英文原文: `Delete`
- 中文翻译: [待填写]

**上下文:**

```
56:     save: 'Save',
57:     cancel: 'Cancel',
58:     delete: 'Delete',
59:     edit: 'Edit',
60:     add: 'Add',
```

---

### 第 59 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
57:     cancel: 'Cancel',
58:     delete: 'Delete',
59:     edit: 'Edit',
60:     add: 'Add',
61:     close: 'Close',
```

---

### 第 61 行: "Close"

- 建议键名: `close`
- 英文原文: `Close`
- 中文翻译: [待填写]

**上下文:**

```
59:     edit: 'Edit',
60:     add: 'Add',
61:     close: 'Close',
62:     back: 'Back',
63:     next: 'Next',
```

---

### 第 62 行: "Back"

- 建议键名: `back`
- 英文原文: `Back`
- 中文翻译: [待填写]

**上下文:**

```
60:     add: 'Add',
61:     close: 'Close',
62:     back: 'Back',
63:     next: 'Next',
64:     confirm: 'Confirm',
```

---

### 第 63 行: "Next"

- 建议键名: `next`
- 英文原文: `Next`
- 中文翻译: [待填写]

**上下文:**

```
61:     close: 'Close',
62:     back: 'Back',
63:     next: 'Next',
64:     confirm: 'Confirm',
65:     ok: 'OK',
```

---

### 第 64 行: "Confirm"

- 建议键名: `confirm`
- 英文原文: `Confirm`
- 中文翻译: [待填写]

**上下文:**

```
62:     back: 'Back',
63:     next: 'Next',
64:     confirm: 'Confirm',
65:     ok: 'OK',
66:     yes: 'Yes',
```

---

### 第 68 行: "New Window"

- 建议键名: `newWindow`
- 英文原文: `New Window`
- 中文翻译: [待填写]

**上下文:**

```
66:     yes: 'Yes',
67:     no: 'No',
68:     newWindow: 'New Window',
69:     settings: 'Settings',
70:     help: 'Help',
```

---

### 第 69 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
67:     no: 'No',
68:     newWindow: 'New Window',
69:     settings: 'Settings',
70:     help: 'Help',
71:     helpDocumentation: 'Help & Documentation',
```

---

### 第 70 行: "Help"

- 建议键名: `help`
- 英文原文: `Help`
- 中文翻译: [待填写]

**上下文:**

```
68:     newWindow: 'New Window',
69:     settings: 'Settings',
70:     help: 'Help',
71:     helpDocumentation: 'Help & Documentation',
72:     automations: 'Automations',
```

---

### 第 71 行: "Help & Documentation"

- 建议键名: `helpDocumentation`
- 英文原文: `Help & Documentation`
- 中文翻译: [待填写]

**上下文:**

```
69:     settings: 'Settings',
70:     help: 'Help',
71:     helpDocumentation: 'Help & Documentation',
72:     automations: 'Automations',
73:     debug: 'Debug',
```

---

### 第 72 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
70:     help: 'Help',
71:     helpDocumentation: 'Help & Documentation',
72:     automations: 'Automations',
73:     debug: 'Debug',
74:     checkForUpdates: 'Check for Updates',
```

---

### 第 73 行: "Debug"

- 建议键名: `debug`
- 英文原文: `Debug`
- 中文翻译: [待填写]

**上下文:**

```
71:     helpDocumentation: 'Help & Documentation',
72:     automations: 'Automations',
73:     debug: 'Debug',
74:     checkForUpdates: 'Check for Updates',
75:     installUpdate: 'Install Update',
```

---

### 第 74 行: "Check for Updates"

- 建议键名: `checkForUpdates`
- 英文原文: `Check for Updates`
- 中文翻译: [待填写]

**上下文:**

```
72:     automations: 'Automations',
73:     debug: 'Debug',
74:     checkForUpdates: 'Check for Updates',
75:     installUpdate: 'Install Update',
76:     toggleDevTools: 'Toggle DevTools',
```

---

### 第 75 行: "Install Update"

- 建议键名: `installUpdate`
- 英文原文: `Install Update`
- 中文翻译: [待填写]

**上下文:**

```
73:     debug: 'Debug',
74:     checkForUpdates: 'Check for Updates',
75:     installUpdate: 'Install Update',
76:     toggleDevTools: 'Toggle DevTools',
77:     quit: 'Quit Craft Agents',
```

---

### 第 76 行: "Toggle DevTools"

- 建议键名: `toggleDevtools`
- 英文原文: `Toggle DevTools`
- 中文翻译: [待填写]

**上下文:**

```
74:     checkForUpdates: 'Check for Updates',
75:     installUpdate: 'Install Update',
76:     toggleDevTools: 'Toggle DevTools',
77:     quit: 'Quit Craft Agents',
78:     markAllRead: 'Mark All Read',
```

---

### 第 77 行: "Quit Craft Agents"

- 建议键名: `quitCraftAgents`
- 英文原文: `Quit Craft Agents`
- 中文翻译: [待填写]

**上下文:**

```
75:     installUpdate: 'Install Update',
76:     toggleDevTools: 'Toggle DevTools',
77:     quit: 'Quit Craft Agents',
78:     markAllRead: 'Mark All Read',
79:     configureStatuses: 'Configure Statuses',
```

---

### 第 78 行: "Mark All Read"

- 建议键名: `markAllRead`
- 英文原文: `Mark All Read`
- 中文翻译: [待填写]

**上下文:**

```
76:     toggleDevTools: 'Toggle DevTools',
77:     quit: 'Quit Craft Agents',
78:     markAllRead: 'Mark All Read',
79:     configureStatuses: 'Configure Statuses',
80:     addNewLabel: 'Add New Label',
```

---

### 第 79 行: "Configure Statuses"

- 建议键名: `configureStatuses`
- 英文原文: `Configure Statuses`
- 中文翻译: [待填写]

**上下文:**

```
77:     quit: 'Quit Craft Agents',
78:     markAllRead: 'Mark All Read',
79:     configureStatuses: 'Configure Statuses',
80:     addNewLabel: 'Add New Label',
81:     editLabels: 'Edit Labels',
```

---

### 第 80 行: "Add New Label"

- 建议键名: `addNewLabel`
- 英文原文: `Add New Label`
- 中文翻译: [待填写]

**上下文:**

```
78:     markAllRead: 'Mark All Read',
79:     configureStatuses: 'Configure Statuses',
80:     addNewLabel: 'Add New Label',
81:     editLabels: 'Edit Labels',
82:     deleteLabel: 'Delete Label',
```

---

### 第 81 行: "Edit Labels"

- 建议键名: `editLabels`
- 英文原文: `Edit Labels`
- 中文翻译: [待填写]

**上下文:**

```
79:     configureStatuses: 'Configure Statuses',
80:     addNewLabel: 'Add New Label',
81:     editLabels: 'Edit Labels',
82:     deleteLabel: 'Delete Label',
83:     editViews: 'Edit Views',
```

---

### 第 82 行: "Delete Label"

- 建议键名: `deleteLabel`
- 英文原文: `Delete Label`
- 中文翻译: [待填写]

**上下文:**

```
80:     addNewLabel: 'Add New Label',
81:     editLabels: 'Edit Labels',
82:     deleteLabel: 'Delete Label',
83:     editViews: 'Edit Views',
84:     deleteView: 'Delete View',
```

---

### 第 83 行: "Edit Views"

- 建议键名: `editViews`
- 英文原文: `Edit Views`
- 中文翻译: [待填写]

**上下文:**

```
81:     editLabels: 'Edit Labels',
82:     deleteLabel: 'Delete Label',
83:     editViews: 'Edit Views',
84:     deleteView: 'Delete View',
85:     learnMoreAboutAPIs: 'Learn More about APIs',
```

---

### 第 84 行: "Delete View"

- 建议键名: `deleteView`
- 英文原文: `Delete View`
- 中文翻译: [待填写]

**上下文:**

```
82:     deleteLabel: 'Delete Label',
83:     editViews: 'Edit Views',
84:     deleteView: 'Delete View',
85:     learnMoreAboutAPIs: 'Learn More about APIs',
86:     learnMoreAboutMCPs: 'Learn More about MCP',
```

---

### 第 85 行: "Learn More about APIs"

- 建议键名: `learnMoreAboutApis`
- 英文原文: `Learn More about APIs`
- 中文翻译: [待填写]

**上下文:**

```
83:     editViews: 'Edit Views',
84:     deleteView: 'Delete View',
85:     learnMoreAboutAPIs: 'Learn More about APIs',
86:     learnMoreAboutMCPs: 'Learn More about MCP',
87:     learnMoreAboutLocalFolders: 'Learn More about Local Folders',
```

---

### 第 86 行: "Learn More about MCP"

- 建议键名: `learnMoreAboutMcp`
- 英文原文: `Learn More about MCP`
- 中文翻译: [待填写]

**上下文:**

```
84:     deleteView: 'Delete View',
85:     learnMoreAboutAPIs: 'Learn More about APIs',
86:     learnMoreAboutMCPs: 'Learn More about MCP',
87:     learnMoreAboutLocalFolders: 'Learn More about Local Folders',
88:     learnMoreAboutSources: 'Learn More about Sources',
```

---

### 第 87 行: "Learn More about Local Folders"

- 建议键名: `learnMoreAboutLocalFolders`
- 英文原文: `Learn More about Local Folders`
- 中文翻译: [待填写]

**上下文:**

```
85:     learnMoreAboutAPIs: 'Learn More about APIs',
86:     learnMoreAboutMCPs: 'Learn More about MCP',
87:     learnMoreAboutLocalFolders: 'Learn More about Local Folders',
88:     learnMoreAboutSources: 'Learn More about Sources',
89:     addSource: 'Add Source',
```

---

### 第 88 行: "Learn More about Sources"

- 建议键名: `learnMoreAboutSources`
- 英文原文: `Learn More about Sources`
- 中文翻译: [待填写]

**上下文:**

```
86:     learnMoreAboutMCPs: 'Learn More about MCP',
87:     learnMoreAboutLocalFolders: 'Learn More about Local Folders',
88:     learnMoreAboutSources: 'Learn More about Sources',
89:     addSource: 'Add Source',
90:     addSkill: 'Add Skill',
```

---

### 第 89 行: "Add Source"

- 建议键名: `addSource`
- 英文原文: `Add Source`
- 中文翻译: [待填写]

**上下文:**

```
87:     learnMoreAboutLocalFolders: 'Learn More about Local Folders',
88:     learnMoreAboutSources: 'Learn More about Sources',
89:     addSource: 'Add Source',
90:     addSkill: 'Add Skill',
91:     addAutomation: 'Add Automation',
```

---

### 第 90 行: "Add Skill"

- 建议键名: `addSkill`
- 英文原文: `Add Skill`
- 中文翻译: [待填写]

**上下文:**

```
88:     learnMoreAboutSources: 'Learn More about Sources',
89:     addSource: 'Add Source',
90:     addSkill: 'Add Skill',
91:     addAutomation: 'Add Automation',
92:     learnMoreAboutAutomations: 'Learn More about Automations',
```

---

### 第 91 行: "Add Automation"

- 建议键名: `addAutomation`
- 英文原文: `Add Automation`
- 中文翻译: [待填写]

**上下文:**

```
89:     addSource: 'Add Source',
90:     addSkill: 'Add Skill',
91:     addAutomation: 'Add Automation',
92:     learnMoreAboutAutomations: 'Learn More about Automations',
93:     showInExplorer: 'Show in Explorer',
```

---

### 第 92 行: "Learn More about Automations"

- 建议键名: `learnMoreAboutAutomations`
- 英文原文: `Learn More about Automations`
- 中文翻译: [待填写]

**上下文:**

```
90:     addSkill: 'Add Skill',
91:     addAutomation: 'Add Automation',
92:     learnMoreAboutAutomations: 'Learn More about Automations',
93:     showInExplorer: 'Show in Explorer',
94:     deleteSource: 'Delete Source',
```

---

### 第 93 行: "Show in Explorer"

- 建议键名: `showInExplorer`
- 英文原文: `Show in Explorer`
- 中文翻译: [待填写]

**上下文:**

```
91:     addAutomation: 'Add Automation',
92:     learnMoreAboutAutomations: 'Learn More about Automations',
93:     showInExplorer: 'Show in Explorer',
94:     deleteSource: 'Delete Source',
95:     deleteSkill: 'Delete Skill'
```

---

### 第 94 行: "Delete Source"

- 建议键名: `deleteSource`
- 英文原文: `Delete Source`
- 中文翻译: [待填写]

**上下文:**

```
92:     learnMoreAboutAutomations: 'Learn More about Automations',
93:     showInExplorer: 'Show in Explorer',
94:     deleteSource: 'Delete Source',
95:     deleteSkill: 'Delete Skill'
96:   },
```

---

### 第 95 行: "Delete Skill"

- 建议键名: `deleteSkill`
- 英文原文: `Delete Skill`
- 中文翻译: [待填写]

**上下文:**

```
93:     showInExplorer: 'Show in Explorer',
94:     deleteSource: 'Delete Source',
95:     deleteSkill: 'Delete Skill'
96:   },
97:   
```

---

### 第 100 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
98:   // Menu
99:   menu: {
100:     edit: 'Edit',
101:     view: 'View',
102:     window: 'Window',
```

---

### 第 101 行: "View"

- 建议键名: `view`
- 英文原文: `View`
- 中文翻译: [待填写]

**上下文:**

```
99:   menu: {
100:     edit: 'Edit',
101:     view: 'View',
102:     window: 'Window',
103:     undo: 'Undo',
```

---

### 第 102 行: "Window"

- 建议键名: `window`
- 英文原文: `Window`
- 中文翻译: [待填写]

**上下文:**

```
100:     edit: 'Edit',
101:     view: 'View',
102:     window: 'Window',
103:     undo: 'Undo',
104:     redo: 'Redo',
```

---

### 第 103 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
101:     view: 'View',
102:     window: 'Window',
103:     undo: 'Undo',
104:     redo: 'Redo',
105:     cut: 'Cut',
```

---

### 第 104 行: "Redo"

- 建议键名: `redo`
- 英文原文: `Redo`
- 中文翻译: [待填写]

**上下文:**

```
102:     window: 'Window',
103:     undo: 'Undo',
104:     redo: 'Redo',
105:     cut: 'Cut',
106:     copy: 'Copy',
```

---

### 第 106 行: "Copy"

- 建议键名: `copy`
- 英文原文: `Copy`
- 中文翻译: [待填写]

**上下文:**

```
104:     redo: 'Redo',
105:     cut: 'Cut',
106:     copy: 'Copy',
107:     paste: 'Paste',
108:     selectAll: 'Select All',
```

---

### 第 107 行: "Paste"

- 建议键名: `paste`
- 英文原文: `Paste`
- 中文翻译: [待填写]

**上下文:**

```
105:     cut: 'Cut',
106:     copy: 'Copy',
107:     paste: 'Paste',
108:     selectAll: 'Select All',
109:     zoomIn: 'Zoom In',
```

---

### 第 108 行: "Select All"

- 建议键名: `selectAll`
- 英文原文: `Select All`
- 中文翻译: [待填写]

**上下文:**

```
106:     copy: 'Copy',
107:     paste: 'Paste',
108:     selectAll: 'Select All',
109:     zoomIn: 'Zoom In',
110:     zoomOut: 'Zoom Out',
```

---

### 第 109 行: "Zoom In"

- 建议键名: `zoomIn`
- 英文原文: `Zoom In`
- 中文翻译: [待填写]

**上下文:**

```
107:     paste: 'Paste',
108:     selectAll: 'Select All',
109:     zoomIn: 'Zoom In',
110:     zoomOut: 'Zoom Out',
111:     resetZoom: 'Reset Zoom',
```

---

### 第 110 行: "Zoom Out"

- 建议键名: `zoomOut`
- 英文原文: `Zoom Out`
- 中文翻译: [待填写]

**上下文:**

```
108:     selectAll: 'Select All',
109:     zoomIn: 'Zoom In',
110:     zoomOut: 'Zoom Out',
111:     resetZoom: 'Reset Zoom',
112:     toggleFocusMode: 'Toggle Focus Mode',
```

---

### 第 111 行: "Reset Zoom"

- 建议键名: `resetZoom`
- 英文原文: `Reset Zoom`
- 中文翻译: [待填写]

**上下文:**

```
109:     zoomIn: 'Zoom In',
110:     zoomOut: 'Zoom Out',
111:     resetZoom: 'Reset Zoom',
112:     toggleFocusMode: 'Toggle Focus Mode',
113:     toggleSidebar: 'Toggle Sidebar',
```

---

### 第 112 行: "Toggle Focus Mode"

- 建议键名: `toggleFocusMode`
- 英文原文: `Toggle Focus Mode`
- 中文翻译: [待填写]

**上下文:**

```
110:     zoomOut: 'Zoom Out',
111:     resetZoom: 'Reset Zoom',
112:     toggleFocusMode: 'Toggle Focus Mode',
113:     toggleSidebar: 'Toggle Sidebar',
114:     minimize: 'Minimize',
```

---

### 第 113 行: "Toggle Sidebar"

- 建议键名: `toggleSidebar`
- 英文原文: `Toggle Sidebar`
- 中文翻译: [待填写]

**上下文:**

```
111:     resetZoom: 'Reset Zoom',
112:     toggleFocusMode: 'Toggle Focus Mode',
113:     toggleSidebar: 'Toggle Sidebar',
114:     minimize: 'Minimize',
115:     maximize: 'Maximize'
```

---

### 第 114 行: "Minimize"

- 建议键名: `minimize`
- 英文原文: `Minimize`
- 中文翻译: [待填写]

**上下文:**

```
112:     toggleFocusMode: 'Toggle Focus Mode',
113:     toggleSidebar: 'Toggle Sidebar',
114:     minimize: 'Minimize',
115:     maximize: 'Maximize'
116:   },
```

---

### 第 115 行: "Maximize"

- 建议键名: `maximize`
- 英文原文: `Maximize`
- 中文翻译: [待填写]

**上下文:**

```
113:     toggleSidebar: 'Toggle Sidebar',
114:     minimize: 'Minimize',
115:     maximize: 'Maximize'
116:   },
117:   
```

---

### 第 120 行: "Send message"

- 建议键名: `sendMessage`
- 英文原文: `Send message`
- 中文翻译: [待填写]

**上下文:**

```
118:   // Chat
119:   chat: {
120:     sendMessage: 'Send message',
121:     thinking: 'Thinking...',
122:     typing: 'Typing...',
```

---

### 第 123 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
121:     thinking: 'Thinking...',
122:     typing: 'Typing...',
123:     newChat: 'New Chat',
124:     saveChat: 'Save Chat',
125:     deleteChat: 'Delete Chat',
```

---

### 第 124 行: "Save Chat"

- 建议键名: `saveChat`
- 英文原文: `Save Chat`
- 中文翻译: [待填写]

**上下文:**

```
122:     typing: 'Typing...',
123:     newChat: 'New Chat',
124:     saveChat: 'Save Chat',
125:     deleteChat: 'Delete Chat',
126:     renameChat: 'Rename Chat',
```

---

### 第 125 行: "Delete Chat"

- 建议键名: `deleteChat`
- 英文原文: `Delete Chat`
- 中文翻译: [待填写]

**上下文:**

```
123:     newChat: 'New Chat',
124:     saveChat: 'Save Chat',
125:     deleteChat: 'Delete Chat',
126:     renameChat: 'Rename Chat',
127:     shareChat: 'Share Chat',
```

---

### 第 126 行: "Rename Chat"

- 建议键名: `renameChat`
- 英文原文: `Rename Chat`
- 中文翻译: [待填写]

**上下文:**

```
124:     saveChat: 'Save Chat',
125:     deleteChat: 'Delete Chat',
126:     renameChat: 'Rename Chat',
127:     shareChat: 'Share Chat',
128:     exportChat: 'Export Chat',
```

---

### 第 127 行: "Share Chat"

- 建议键名: `shareChat`
- 英文原文: `Share Chat`
- 中文翻译: [待填写]

**上下文:**

```
125:     deleteChat: 'Delete Chat',
126:     renameChat: 'Rename Chat',
127:     shareChat: 'Share Chat',
128:     exportChat: 'Export Chat',
129:     clearChat: 'Clear Chat',
```

---

### 第 128 行: "Export Chat"

- 建议键名: `exportChat`
- 英文原文: `Export Chat`
- 中文翻译: [待填写]

**上下文:**

```
126:     renameChat: 'Rename Chat',
127:     shareChat: 'Share Chat',
128:     exportChat: 'Export Chat',
129:     clearChat: 'Clear Chat',
130:     chatHistory: 'Chat History',
```

---

### 第 129 行: "Clear Chat"

- 建议键名: `clearChat`
- 英文原文: `Clear Chat`
- 中文翻译: [待填写]

**上下文:**

```
127:     shareChat: 'Share Chat',
128:     exportChat: 'Export Chat',
129:     clearChat: 'Clear Chat',
130:     chatHistory: 'Chat History',
131:     recentChats: 'Recent Chats',
```

---

### 第 130 行: "Chat History"

- 建议键名: `chatHistory`
- 英文原文: `Chat History`
- 中文翻译: [待填写]

**上下文:**

```
128:     exportChat: 'Export Chat',
129:     clearChat: 'Clear Chat',
130:     chatHistory: 'Chat History',
131:     recentChats: 'Recent Chats',
132:     allChats: 'All Chats'
```

---

### 第 131 行: "Recent Chats"

- 建议键名: `recentChats`
- 英文原文: `Recent Chats`
- 中文翻译: [待填写]

**上下文:**

```
129:     clearChat: 'Clear Chat',
130:     chatHistory: 'Chat History',
131:     recentChats: 'Recent Chats',
132:     allChats: 'All Chats'
133:   },
```

---

### 第 132 行: "All Chats"

- 建议键名: `allChats`
- 英文原文: `All Chats`
- 中文翻译: [待填写]

**上下文:**

```
130:     chatHistory: 'Chat History',
131:     recentChats: 'Recent Chats',
132:     allChats: 'All Chats'
133:   },
134:   
```

---

### 第 137 行: "Model"

- 建议键名: `model`
- 英文原文: `Model`
- 中文翻译: [待填写]

**上下文:**

```
135:   // AI
136:   ai: {
137:     model: 'Model',
138:     thinkingLevel: 'Thinking Level',
139:     connections: 'Connections',
```

---

### 第 138 行: "Thinking Level"

- 建议键名: `thinkingLevel`
- 英文原文: `Thinking Level`
- 中文翻译: [待填写]

**上下文:**

```
136:   ai: {
137:     model: 'Model',
138:     thinkingLevel: 'Thinking Level',
139:     connections: 'Connections',
140:     apiKey: 'API Key',
```

---

### 第 139 行: "Connections"

- 建议键名: `connections`
- 英文原文: `Connections`
- 中文翻译: [待填写]

**上下文:**

```
137:     model: 'Model',
138:     thinkingLevel: 'Thinking Level',
139:     connections: 'Connections',
140:     apiKey: 'API Key',
141:     temperature: 'Temperature',
```

---

### 第 140 行: "API Key"

- 建议键名: `apiKey`
- 英文原文: `API Key`
- 中文翻译: [待填写]

**上下文:**

```
138:     thinkingLevel: 'Thinking Level',
139:     connections: 'Connections',
140:     apiKey: 'API Key',
141:     temperature: 'Temperature',
142:     maxTokens: 'Max Tokens',
```

---

### 第 141 行: "Temperature"

- 建议键名: `temperature`
- 英文原文: `Temperature`
- 中文翻译: [待填写]

**上下文:**

```
139:     connections: 'Connections',
140:     apiKey: 'API Key',
141:     temperature: 'Temperature',
142:     maxTokens: 'Max Tokens',
143:     topP: 'Top P',
```

---

### 第 142 行: "Max Tokens"

- 建议键名: `maxTokens`
- 英文原文: `Max Tokens`
- 中文翻译: [待填写]

**上下文:**

```
140:     apiKey: 'API Key',
141:     temperature: 'Temperature',
142:     maxTokens: 'Max Tokens',
143:     topP: 'Top P',
144:     frequencyPenalty: 'Frequency Penalty',
```

---

### 第 143 行: "Top P"

- 建议键名: `topP`
- 英文原文: `Top P`
- 中文翻译: [待填写]

**上下文:**

```
141:     temperature: 'Temperature',
142:     maxTokens: 'Max Tokens',
143:     topP: 'Top P',
144:     frequencyPenalty: 'Frequency Penalty',
145:     presencePenalty: 'Presence Penalty'
```

---

### 第 144 行: "Frequency Penalty"

- 建议键名: `frequencyPenalty`
- 英文原文: `Frequency Penalty`
- 中文翻译: [待填写]

**上下文:**

```
142:     maxTokens: 'Max Tokens',
143:     topP: 'Top P',
144:     frequencyPenalty: 'Frequency Penalty',
145:     presencePenalty: 'Presence Penalty'
146:   },
```

---

### 第 145 行: "Presence Penalty"

- 建议键名: `presencePenalty`
- 英文原文: `Presence Penalty`
- 中文翻译: [待填写]

**上下文:**

```
143:     topP: 'Top P',
144:     frequencyPenalty: 'Frequency Penalty',
145:     presencePenalty: 'Presence Penalty'
146:   },
147:   
```

---

### 第 150 行: "Theme"

- 建议键名: `theme`
- 英文原文: `Theme`
- 中文翻译: [待填写]

**上下文:**

```
148:   // Appearance
149:   appearance: {
150:     theme: 'Theme',
151:     light: 'Light',
152:     dark: 'Dark',
```

---

### 第 151 行: "Light"

- 建议键名: `light`
- 英文原文: `Light`
- 中文翻译: [待填写]

**上下文:**

```
149:   appearance: {
150:     theme: 'Theme',
151:     light: 'Light',
152:     dark: 'Dark',
153:     system: 'System',
```

---

### 第 152 行: "Dark"

- 建议键名: `dark`
- 英文原文: `Dark`
- 中文翻译: [待填写]

**上下文:**

```
150:     theme: 'Theme',
151:     light: 'Light',
152:     dark: 'Dark',
153:     system: 'System',
154:     font: 'Font',
```

---

### 第 153 行: "System"

- 建议键名: `system`
- 英文原文: `System`
- 中文翻译: [待填写]

**上下文:**

```
151:     light: 'Light',
152:     dark: 'Dark',
153:     system: 'System',
154:     font: 'Font',
155:     fontSize: 'Font Size',
```

---

### 第 154 行: "Font"

- 建议键名: `font`
- 英文原文: `Font`
- 中文翻译: [待填写]

**上下文:**

```
152:     dark: 'Dark',
153:     system: 'System',
154:     font: 'Font',
155:     fontSize: 'Font Size',
156:     toolIcons: 'Tool Icons'
```

---

### 第 155 行: "Font Size"

- 建议键名: `fontSize`
- 英文原文: `Font Size`
- 中文翻译: [待填写]

**上下文:**

```
153:     system: 'System',
154:     font: 'Font',
155:     fontSize: 'Font Size',
156:     toolIcons: 'Tool Icons'
157:   },
```

---

### 第 161 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
159:   // Workspace
160:   workspace: {
161:     name: 'Name',
162:     icon: 'Icon',
163:     workingDirectory: 'Working Directory',
```

---

### 第 163 行: "Working Directory"

- 建议键名: `workingDirectory`
- 英文原文: `Working Directory`
- 中文翻译: [待填写]

**上下文:**

```
161:     name: 'Name',
162:     icon: 'Icon',
163:     workingDirectory: 'Working Directory',
164:     browse: 'Browse',
165:     reset: 'Reset'
```

---

### 第 164 行: "Browse"

- 建议键名: `browse`
- 英文原文: `Browse`
- 中文翻译: [待填写]

**上下文:**

```
162:     icon: 'Icon',
163:     workingDirectory: 'Working Directory',
164:     browse: 'Browse',
165:     reset: 'Reset'
166:   },
```

---

### 第 165 行: "Reset"

- 建议键名: `reset`
- 英文原文: `Reset`
- 中文翻译: [待填写]

**上下文:**

```
163:     workingDirectory: 'Working Directory',
164:     browse: 'Browse',
165:     reset: 'Reset'
166:   },
167:   
```

---

### 第 170 行: "Explore Mode"

- 建议键名: `exploreMode`
- 英文原文: `Explore Mode`
- 中文翻译: [待填写]

**上下文:**

```
168:   // Permissions
169:   permissions: {
170:     exploreMode: 'Explore Mode',
171:     allowCommands: 'Allow Commands',
172:     allowWrite: 'Allow Write',
```

---

### 第 171 行: "Allow Commands"

- 建议键名: `allowCommands`
- 英文原文: `Allow Commands`
- 中文翻译: [待填写]

**上下文:**

```
169:   permissions: {
170:     exploreMode: 'Explore Mode',
171:     allowCommands: 'Allow Commands',
172:     allowWrite: 'Allow Write',
173:     allowNetwork: 'Allow Network',
```

---

### 第 172 行: "Allow Write"

- 建议键名: `allowWrite`
- 英文原文: `Allow Write`
- 中文翻译: [待填写]

**上下文:**

```
170:     exploreMode: 'Explore Mode',
171:     allowCommands: 'Allow Commands',
172:     allowWrite: 'Allow Write',
173:     allowNetwork: 'Allow Network',
174:     allowSystem: 'Allow System'
```

---

### 第 173 行: "Allow Network"

- 建议键名: `allowNetwork`
- 英文原文: `Allow Network`
- 中文翻译: [待填写]

**上下文:**

```
171:     allowCommands: 'Allow Commands',
172:     allowWrite: 'Allow Write',
173:     allowNetwork: 'Allow Network',
174:     allowSystem: 'Allow System'
175:   },
```

---

### 第 174 行: "Allow System"

- 建议键名: `allowSystem`
- 英文原文: `Allow System`
- 中文翻译: [待填写]

**上下文:**

```
172:     allowWrite: 'Allow Write',
173:     allowNetwork: 'Allow Network',
174:     allowSystem: 'Allow System'
175:   },
176:   
```

---

### 第 179 行: "Manage Labels"

- 建议键名: `manageLabels`
- 英文原文: `Manage Labels`
- 中文翻译: [待填写]

**上下文:**

```
177:   // Labels
178:   labels: {
179:     manageLabels: 'Manage Labels',
180:     createLabel: 'Create Label',
181:     editLabel: 'Edit Label',
```

---

### 第 180 行: "Create Label"

- 建议键名: `createLabel`
- 英文原文: `Create Label`
- 中文翻译: [待填写]

**上下文:**

```
178:   labels: {
179:     manageLabels: 'Manage Labels',
180:     createLabel: 'Create Label',
181:     editLabel: 'Edit Label',
182:     deleteLabel: 'Delete Label',
```

---

### 第 181 行: "Edit Label"

- 建议键名: `editLabel`
- 英文原文: `Edit Label`
- 中文翻译: [待填写]

**上下文:**

```
179:     manageLabels: 'Manage Labels',
180:     createLabel: 'Create Label',
181:     editLabel: 'Edit Label',
182:     deleteLabel: 'Delete Label',
183:     color: 'Color',
```

---

### 第 182 行: "Delete Label"

- 建议键名: `deleteLabel`
- 英文原文: `Delete Label`
- 中文翻译: [待填写]

**上下文:**

```
180:     createLabel: 'Create Label',
181:     editLabel: 'Edit Label',
182:     deleteLabel: 'Delete Label',
183:     color: 'Color',
184:     name: 'Name'
```

---

### 第 183 行: "Color"

- 建议键名: `color`
- 英文原文: `Color`
- 中文翻译: [待填写]

**上下文:**

```
181:     editLabel: 'Edit Label',
182:     deleteLabel: 'Delete Label',
183:     color: 'Color',
184:     name: 'Name'
185:   },
```

---

### 第 184 行: "Name"

- 建议键名: `name`
- 英文原文: `Name`
- 中文翻译: [待填写]

**上下文:**

```
182:     deleteLabel: 'Delete Label',
183:     color: 'Color',
184:     name: 'Name'
185:   },
186:   
```

---

### 第 189 行: "Remote Server"

- 建议键名: `remoteServer`
- 英文原文: `Remote Server`
- 中文翻译: [待填写]

**上下文:**

```
187:   // Server
188:   server: {
189:     remoteServer: 'Remote Server',
190:     enabled: 'Enabled',
191:     url: 'URL',
```

---

### 第 190 行: "Enabled"

- 建议键名: `enabled`
- 英文原文: `Enabled`
- 中文翻译: [待填写]

**上下文:**

```
188:   server: {
189:     remoteServer: 'Remote Server',
190:     enabled: 'Enabled',
191:     url: 'URL',
192:     port: 'Port',
```

---

### 第 192 行: "Port"

- 建议键名: `port`
- 英文原文: `Port`
- 中文翻译: [待填写]

**上下文:**

```
190:     enabled: 'Enabled',
191:     url: 'URL',
192:     port: 'Port',
193:     username: 'Username',
194:     password: 'Password'
```

---

### 第 193 行: "Username"

- 建议键名: `username`
- 英文原文: `Username`
- 中文翻译: [待填写]

**上下文:**

```
191:     url: 'URL',
192:     port: 'Port',
193:     username: 'Username',
194:     password: 'Password'
195:   },
```

---

### 第 194 行: "Password"

- 建议键名: `password`
- 英文原文: `Password`
- 中文翻译: [待填写]

**上下文:**

```
192:     port: 'Port',
193:     username: 'Username',
194:     password: 'Password'
195:   },
196:   
```

---

### 第 199 行: "Keyboard Shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
197:   // Shortcuts
198:   shortcuts: {
199:     keyboardShortcuts: 'Keyboard Shortcuts',
200:     editShortcuts: 'Edit Shortcuts',
201:     resetShortcuts: 'Reset Shortcuts',
```

---

### 第 200 行: "Edit Shortcuts"

- 建议键名: `editShortcuts`
- 英文原文: `Edit Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
198:   shortcuts: {
199:     keyboardShortcuts: 'Keyboard Shortcuts',
200:     editShortcuts: 'Edit Shortcuts',
201:     resetShortcuts: 'Reset Shortcuts',
202:     saveChanges: 'Save Changes'
```

---

### 第 201 行: "Reset Shortcuts"

- 建议键名: `resetShortcuts`
- 英文原文: `Reset Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
199:     keyboardShortcuts: 'Keyboard Shortcuts',
200:     editShortcuts: 'Edit Shortcuts',
201:     resetShortcuts: 'Reset Shortcuts',
202:     saveChanges: 'Save Changes'
203:   },
```

---

### 第 202 行: "Save Changes"

- 建议键名: `saveChanges`
- 英文原文: `Save Changes`
- 中文翻译: [待填写]

**上下文:**

```
200:     editShortcuts: 'Edit Shortcuts',
201:     resetShortcuts: 'Reset Shortcuts',
202:     saveChanges: 'Save Changes'
203:   },
204:   
```

---

### 第 207 行: "Send Key"

- 建议键名: `sendKey`
- 英文原文: `Send Key`
- 中文翻译: [待填写]

**上下文:**

```
205:   // Input
206:   input: {
207:     sendKey: 'Send Key',
208:     spellCheck: 'Spell Check',
209:     enableSpellCheck: 'Enable Spell Check',
```

---

### 第 208 行: "Spell Check"

- 建议键名: `spellCheck`
- 英文原文: `Spell Check`
- 中文翻译: [待填写]

**上下文:**

```
206:   input: {
207:     sendKey: 'Send Key',
208:     spellCheck: 'Spell Check',
209:     enableSpellCheck: 'Enable Spell Check',
210:     whatWouldYouLike: 'What would you like to work on?',
```

---

### 第 209 行: "Enable Spell Check"

- 建议键名: `enableSpellCheck`
- 英文原文: `Enable Spell Check`
- 中文翻译: [待填写]

**上下文:**

```
207:     sendKey: 'Send Key',
208:     spellCheck: 'Spell Check',
209:     enableSpellCheck: 'Enable Spell Check',
210:     whatWouldYouLike: 'What would you like to work on?',
211:     shiftTabSwitch: 'Use Shift + Tab to switch between Explore and Execute',
```

---

### 第 210 行: "What would you like to work on?"

- 建议键名: `whatWouldYouLikeToWorkOn `
- 英文原文: `What would you like to work on?`
- 中文翻译: [待填写]

**上下文:**

```
208:     spellCheck: 'Spell Check',
209:     enableSpellCheck: 'Enable Spell Check',
210:     whatWouldYouLike: 'What would you like to work on?',
211:     shiftTabSwitch: 'Use Shift + Tab to switch between Explore and Execute',
212:     typeAtMention: 'Type @ to mention files, folders, or skills',
```

---

### 第 221 行: "Today"

- 建议键名: `today`
- 英文原文: `Today`
- 中文翻译: [待填写]

**上下文:**

```
219:   // Session list
220:   sessionList: {
221:     today: 'Today',
222:     yesterday: 'Yesterday',
223:     allSessions: 'All Sessions',
```

---

### 第 222 行: "Yesterday"

- 建议键名: `yesterday`
- 英文原文: `Yesterday`
- 中文翻译: [待填写]

**上下文:**

```
220:   sessionList: {
221:     today: 'Today',
222:     yesterday: 'Yesterday',
223:     allSessions: 'All Sessions',
224:     flagged: 'Flagged',
```

---

### 第 223 行: "All Sessions"

- 建议键名: `allSessions`
- 英文原文: `All Sessions`
- 中文翻译: [待填写]

**上下文:**

```
221:     today: 'Today',
222:     yesterday: 'Yesterday',
223:     allSessions: 'All Sessions',
224:     flagged: 'Flagged',
225:     archived: 'Archived',
```

---

### 第 224 行: "Flagged"

- 建议键名: `flagged`
- 英文原文: `Flagged`
- 中文翻译: [待填写]

**上下文:**

```
222:     yesterday: 'Yesterday',
223:     allSessions: 'All Sessions',
224:     flagged: 'Flagged',
225:     archived: 'Archived',
226:     searchResults: 'Search Results',
```

---

### 第 225 行: "Archived"

- 建议键名: `archived`
- 英文原文: `Archived`
- 中文翻译: [待填写]

**上下文:**

```
223:     allSessions: 'All Sessions',
224:     flagged: 'Flagged',
225:     archived: 'Archived',
226:     searchResults: 'Search Results',
227:     noSessions: 'No sessions found',
```

---

### 第 226 行: "Search Results"

- 建议键名: `searchResults`
- 英文原文: `Search Results`
- 中文翻译: [待填写]

**上下文:**

```
224:     flagged: 'Flagged',
225:     archived: 'Archived',
226:     searchResults: 'Search Results',
227:     noSessions: 'No sessions found',
228:     searchedContent: 'Searched titles and message content'
```

---

### 第 227 行: "No sessions found"

- 建议键名: `noSessionsFound`
- 英文原文: `No sessions found`
- 中文翻译: [待填写]

**上下文:**

```
225:     archived: 'Archived',
226:     searchResults: 'Search Results',
227:     noSessions: 'No sessions found',
228:     searchedContent: 'Searched titles and message content'
229:   },
```

---

### 第 228 行: "Searched titles and message content"

- 建议键名: `searchedTitlesAndMessageContent`
- 英文原文: `Searched titles and message content`
- 中文翻译: [待填写]

**上下文:**

```
226:     searchResults: 'Search Results',
227:     noSessions: 'No sessions found',
228:     searchedContent: 'Searched titles and message content'
229:   },
230:   
```

---

### 第 233 行: "Reset App"

- 建议键名: `resetApp`
- 英文原文: `Reset App`
- 中文翻译: [待填写]

**上下文:**

```
231:   // Reset dialog
232:   resetDialog: {
233:     title: 'Reset App',
234:     warning: 'This will <strong>permanently delete</strong>:',
235:     deleteItem1: 'All workspaces and their settings',
```

---

### 第 235 行: "All workspaces and their settings"

- 建议键名: `allWorkspacesAndTheirSettings`
- 英文原文: `All workspaces and their settings`
- 中文翻译: [待填写]

**上下文:**

```
233:     title: 'Reset App',
234:     warning: 'This will <strong>permanently delete</strong>:',
235:     deleteItem1: 'All workspaces and their settings',
236:     deleteItem2: 'All credentials and API keys',
237:     deleteItem3: 'All preferences and session data',
```

---

### 第 236 行: "All credentials and API keys"

- 建议键名: `allCredentialsAndApiKeys`
- 英文原文: `All credentials and API keys`
- 中文翻译: [待填写]

**上下文:**

```
234:     warning: 'This will <strong>permanently delete</strong>:',
235:     deleteItem1: 'All workspaces and their settings',
236:     deleteItem2: 'All credentials and API keys',
237:     deleteItem3: 'All preferences and session data',
238:     backupWarning: 'Back up any important data first!',
```

---

### 第 237 行: "All preferences and session data"

- 建议键名: `allPreferencesAndSessionData`
- 英文原文: `All preferences and session data`
- 中文翻译: [待填写]

**上下文:**

```
235:     deleteItem1: 'All workspaces and their settings',
236:     deleteItem2: 'All credentials and API keys',
237:     deleteItem3: 'All preferences and session data',
238:     backupWarning: 'Back up any important data first!',
239:     undoWarning: 'This action cannot be undone.',
```

---

### 第 238 行: "Back up any important data first!"

- 建议键名: `backUpAnyImportantDataFirst `
- 英文原文: `Back up any important data first!`
- 中文翻译: [待填写]

**上下文:**

```
236:     deleteItem2: 'All credentials and API keys',
237:     deleteItem3: 'All preferences and session data',
238:     backupWarning: 'Back up any important data first!',
239:     undoWarning: 'This action cannot be undone.',
240:     confirmPrompt: 'To confirm, solve: {a} + {b} =',
```

---

### 第 241 行: "Enter answer"

- 建议键名: `enterAnswer`
- 英文原文: `Enter answer`
- 中文翻译: [待填写]

**上下文:**

```
239:     undoWarning: 'This action cannot be undone.',
240:     confirmPrompt: 'To confirm, solve: {a} + {b} =',
241:     answerPlaceholder: 'Enter answer'
242:   },
243:   
```

---

### 第 246 行: "Select Workspace"

- 建议键名: `selectWorkspace`
- 英文原文: `Select Workspace`
- 中文翻译: [待填写]

**上下文:**

```
244:   // Workspace picker
245:   workspacePicker: {
246:     title: 'Select Workspace',
247:     description: 'Choose a workspace on this server, or create a new one.',
248:     loading: 'Loading workspaces...',
```

---

### 第 249 行: "New workspace name"

- 建议键名: `newWorkspaceName`
- 英文原文: `New workspace name`
- 中文翻译: [待填写]

**上下文:**

```
247:     description: 'Choose a workspace on this server, or create a new one.',
248:     loading: 'Loading workspaces...',
249:     placeholder: 'New workspace name',
250:     creating: 'Creating...',
251:     createButton: 'Create Workspace'
```

---

### 第 251 行: "Create Workspace"

- 建议键名: `createWorkspace`
- 英文原文: `Create Workspace`
- 中文翻译: [待填写]

**上下文:**

```
249:     placeholder: 'New workspace name',
250:     creating: 'Creating...',
251:     createButton: 'Create Workspace'
252:   },
253:   
```

---

### 第 256 行: "All Sessions"

- 建议键名: `allSessions`
- 英文原文: `All Sessions`
- 中文翻译: [待填写]

**上下文:**

```
254:   // Sidebar
255:   sidebar: {
256:     allSessions: 'All Sessions',
257:     flagged: 'Flagged',
258:     archived: 'Archived',
```

---

### 第 257 行: "Flagged"

- 建议键名: `flagged`
- 英文原文: `Flagged`
- 中文翻译: [待填写]

**上下文:**

```
255:   sidebar: {
256:     allSessions: 'All Sessions',
257:     flagged: 'Flagged',
258:     archived: 'Archived',
259:     labels: 'Labels',
```

---

### 第 258 行: "Archived"

- 建议键名: `archived`
- 英文原文: `Archived`
- 中文翻译: [待填写]

**上下文:**

```
256:     allSessions: 'All Sessions',
257:     flagged: 'Flagged',
258:     archived: 'Archived',
259:     labels: 'Labels',
260:     sources: 'Sources',
```

---

### 第 259 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
257:     flagged: 'Flagged',
258:     archived: 'Archived',
259:     labels: 'Labels',
260:     sources: 'Sources',
261:     apis: 'APIs',
```

---

### 第 260 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
258:     archived: 'Archived',
259:     labels: 'Labels',
260:     sources: 'Sources',
261:     apis: 'APIs',
262:     mcps: 'MCPs',
```

---

### 第 261 行: "APIs"

- 建议键名: `apis`
- 英文原文: `APIs`
- 中文翻译: [待填写]

**上下文:**

```
259:     labels: 'Labels',
260:     sources: 'Sources',
261:     apis: 'APIs',
262:     mcps: 'MCPs',
263:     localFolders: 'Local Folders',
```

---

### 第 262 行: "MCPs"

- 建议键名: `mcps`
- 英文原文: `MCPs`
- 中文翻译: [待填写]

**上下文:**

```
260:     sources: 'Sources',
261:     apis: 'APIs',
262:     mcps: 'MCPs',
263:     localFolders: 'Local Folders',
264:     skills: 'Skills',
```

---

### 第 263 行: "Local Folders"

- 建议键名: `localFolders`
- 英文原文: `Local Folders`
- 中文翻译: [待填写]

**上下文:**

```
261:     apis: 'APIs',
262:     mcps: 'MCPs',
263:     localFolders: 'Local Folders',
264:     skills: 'Skills',
265:     automations: 'Automations',
```

---

### 第 264 行: "Skills"

- 建议键名: `skills`
- 英文原文: `Skills`
- 中文翻译: [待填写]

**上下文:**

```
262:     mcps: 'MCPs',
263:     localFolders: 'Local Folders',
264:     skills: 'Skills',
265:     automations: 'Automations',
266:     scheduled: 'Scheduled',
```

---

### 第 265 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
263:     localFolders: 'Local Folders',
264:     skills: 'Skills',
265:     automations: 'Automations',
266:     scheduled: 'Scheduled',
267:     eventBased: 'Event-based',
```

---

### 第 266 行: "Scheduled"

- 建议键名: `scheduled`
- 英文原文: `Scheduled`
- 中文翻译: [待填写]

**上下文:**

```
264:     skills: 'Skills',
265:     automations: 'Automations',
266:     scheduled: 'Scheduled',
267:     eventBased: 'Event-based',
268:     agentic: 'Agentic',
```

---

### 第 268 行: "Agentic"

- 建议键名: `agentic`
- 英文原文: `Agentic`
- 中文翻译: [待填写]

**上下文:**

```
266:     scheduled: 'Scheduled',
267:     eventBased: 'Event-based',
268:     agentic: 'Agentic',
269:     settings: 'Settings',
270:     whatsNew: 'What\'s New'
```

---

### 第 269 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
267:     eventBased: 'Event-based',
268:     agentic: 'Agentic',
269:     settings: 'Settings',
270:     whatsNew: 'What\'s New'
271:   },
```

---

### 第 275 行: "Backlog"

- 建议键名: `backlog`
- 英文原文: `Backlog`
- 中文翻译: [待填写]

**上下文:**

```
273:   // Session Statuses
274:   statuses: {
275:     backlog: 'Backlog',
276:     todo: 'Todo',
277:     needsReview: 'Needs Review',
```

---

### 第 276 行: "Todo"

- 建议键名: `todo`
- 英文原文: `Todo`
- 中文翻译: [待填写]

**上下文:**

```
274:   statuses: {
275:     backlog: 'Backlog',
276:     todo: 'Todo',
277:     needsReview: 'Needs Review',
278:     done: 'Done',
```

---

### 第 277 行: "Needs Review"

- 建议键名: `needsReview`
- 英文原文: `Needs Review`
- 中文翻译: [待填写]

**上下文:**

```
275:     backlog: 'Backlog',
276:     todo: 'Todo',
277:     needsReview: 'Needs Review',
278:     done: 'Done',
279:     cancelled: 'Cancelled'
```

---

### 第 278 行: "Done"

- 建议键名: `done`
- 英文原文: `Done`
- 中文翻译: [待填写]

**上下文:**

```
276:     todo: 'Todo',
277:     needsReview: 'Needs Review',
278:     done: 'Done',
279:     cancelled: 'Cancelled'
280:   },
```

---

### 第 279 行: "Cancelled"

- 建议键名: `cancelled`
- 英文原文: `Cancelled`
- 中文翻译: [待填写]

**上下文:**

```
277:     needsReview: 'Needs Review',
278:     done: 'Done',
279:     cancelled: 'Cancelled'
280:   },
281: 
```

---

### 第 284 行: "Content"

- 建议键名: `content`
- 英文原文: `Content`
- 中文翻译: [待填写]

**上下文:**

```
282:   // Label Categories
283:   labelCategories: {
284:     content: 'Content',
285:     design: 'Design',
286:     research: 'Research',
```

---

### 第 285 行: "Design"

- 建议键名: `design`
- 英文原文: `Design`
- 中文翻译: [待填写]

**上下文:**

```
283:   labelCategories: {
284:     content: 'Content',
285:     design: 'Design',
286:     research: 'Research',
287:     writing: 'Writing',
```

---

### 第 286 行: "Research"

- 建议键名: `research`
- 英文原文: `Research`
- 中文翻译: [待填写]

**上下文:**

```
284:     content: 'Content',
285:     design: 'Design',
286:     research: 'Research',
287:     writing: 'Writing',
288:     development: 'Development',
```

---

### 第 287 行: "Writing"

- 建议键名: `writing`
- 英文原文: `Writing`
- 中文翻译: [待填写]

**上下文:**

```
285:     design: 'Design',
286:     research: 'Research',
287:     writing: 'Writing',
288:     development: 'Development',
289:     automation: 'Automation',
```

---

### 第 288 行: "Development"

- 建议键名: `development`
- 英文原文: `Development`
- 中文翻译: [待填写]

**上下文:**

```
286:     research: 'Research',
287:     writing: 'Writing',
288:     development: 'Development',
289:     automation: 'Automation',
290:     bug: 'Bug',
```

---

### 第 289 行: "Automation"

- 建议键名: `automation`
- 英文原文: `Automation`
- 中文翻译: [待填写]

**上下文:**

```
287:     writing: 'Writing',
288:     development: 'Development',
289:     automation: 'Automation',
290:     bug: 'Bug',
291:     code: 'Code',
```

---

### 第 291 行: "Code"

- 建议键名: `code`
- 英文原文: `Code`
- 中文翻译: [待填写]

**上下文:**

```
289:     automation: 'Automation',
290:     bug: 'Bug',
291:     code: 'Code',
292:     priority: 'Priority',
293:     project: 'Project'
```

---

### 第 292 行: "Priority"

- 建议键名: `priority`
- 英文原文: `Priority`
- 中文翻译: [待填写]

**上下文:**

```
290:     bug: 'Bug',
291:     code: 'Code',
292:     priority: 'Priority',
293:     project: 'Project'
294:   },
```

---

### 第 293 行: "Project"

- 建议键名: `project`
- 英文原文: `Project`
- 中文翻译: [待填写]

**上下文:**

```
291:     code: 'Code',
292:     priority: 'Priority',
293:     project: 'Project'
294:   },
295: 
```

---

### 第 298 行: "All Sessions"

- 建议键名: `allSessions`
- 英文原文: `All Sessions`
- 中文翻译: [待填写]

**上下文:**

```
296:   // UI Elements
297:   ui: {
298:     allSessions: 'All Sessions',
299:     filterChats: 'Filter Chats',
300:     searchStatusesAndLabels: 'Search statuses & labels...',
```

---

### 第 299 行: "Filter Chats"

- 建议键名: `filterChats`
- 英文原文: `Filter Chats`
- 中文翻译: [待填写]

**上下文:**

```
297:   ui: {
298:     allSessions: 'All Sessions',
299:     filterChats: 'Filter Chats',
300:     searchStatusesAndLabels: 'Search statuses & labels...',
301:     statuses: 'Statuses',
```

---

### 第 301 行: "Statuses"

- 建议键名: `statuses`
- 英文原文: `Statuses`
- 中文翻译: [待填写]

**上下文:**

```
299:     filterChats: 'Filter Chats',
300:     searchStatusesAndLabels: 'Search statuses & labels...',
301:     statuses: 'Statuses',
302:     group: 'Group',
303:     search: 'Search',
```

---

### 第 302 行: "Group"

- 建议键名: `group`
- 英文原文: `Group`
- 中文翻译: [待填写]

**上下文:**

```
300:     searchStatusesAndLabels: 'Search statuses & labels...',
301:     statuses: 'Statuses',
302:     group: 'Group',
303:     search: 'Search',
304:     share: 'Share',
```

---

### 第 303 行: "Search"

- 建议键名: `search`
- 英文原文: `Search`
- 中文翻译: [待填写]

**上下文:**

```
301:     statuses: 'Statuses',
302:     group: 'Group',
303:     search: 'Search',
304:     share: 'Share',
305:     flag: 'Flag',
```

---

### 第 304 行: "Share"

- 建议键名: `share`
- 英文原文: `Share`
- 中文翻译: [待填写]

**上下文:**

```
302:     group: 'Group',
303:     search: 'Search',
304:     share: 'Share',
305:     flag: 'Flag',
306:     archive: 'Archive',
```

---

### 第 305 行: "Flag"

- 建议键名: `flag`
- 英文原文: `Flag`
- 中文翻译: [待填写]

**上下文:**

```
303:     search: 'Search',
304:     share: 'Share',
305:     flag: 'Flag',
306:     archive: 'Archive',
307:     rename: 'Rename',
```

---

### 第 306 行: "Archive"

- 建议键名: `archive`
- 英文原文: `Archive`
- 中文翻译: [待填写]

**上下文:**

```
304:     share: 'Share',
305:     flag: 'Flag',
306:     archive: 'Archive',
307:     rename: 'Rename',
308:     regenerateTitle: 'Regenerate Title',
```

---

### 第 307 行: "Rename"

- 建议键名: `rename`
- 英文原文: `Rename`
- 中文翻译: [待填写]

**上下文:**

```
305:     flag: 'Flag',
306:     archive: 'Archive',
307:     rename: 'Rename',
308:     regenerateTitle: 'Regenerate Title',
309:     openInNewPanel: 'Open in New Panel',
```

---

### 第 308 行: "Regenerate Title"

- 建议键名: `regenerateTitle`
- 英文原文: `Regenerate Title`
- 中文翻译: [待填写]

**上下文:**

```
306:     archive: 'Archive',
307:     rename: 'Rename',
308:     regenerateTitle: 'Regenerate Title',
309:     openInNewPanel: 'Open in New Panel',
310:     openInNewWindow: 'Open in New Window',
```

---

### 第 309 行: "Open in New Panel"

- 建议键名: `openInNewPanel`
- 英文原文: `Open in New Panel`
- 中文翻译: [待填写]

**上下文:**

```
307:     rename: 'Rename',
308:     regenerateTitle: 'Regenerate Title',
309:     openInNewPanel: 'Open in New Panel',
310:     openInNewWindow: 'Open in New Window',
311:     showInExplorer: 'Show in Explorer',
```

---

### 第 310 行: "Open in New Window"

- 建议键名: `openInNewWindow`
- 英文原文: `Open in New Window`
- 中文翻译: [待填写]

**上下文:**

```
308:     regenerateTitle: 'Regenerate Title',
309:     openInNewPanel: 'Open in New Panel',
310:     openInNewWindow: 'Open in New Window',
311:     showInExplorer: 'Show in Explorer',
312:     copyPath: 'Copy Path',
```

---

### 第 311 行: "Show in Explorer"

- 建议键名: `showInExplorer`
- 英文原文: `Show in Explorer`
- 中文翻译: [待填写]

**上下文:**

```
309:     openInNewPanel: 'Open in New Panel',
310:     openInNewWindow: 'Open in New Window',
311:     showInExplorer: 'Show in Explorer',
312:     copyPath: 'Copy Path',
313:     delete: 'Delete',
```

---

### 第 312 行: "Copy Path"

- 建议键名: `copyPath`
- 英文原文: `Copy Path`
- 中文翻译: [待填写]

**上下文:**

```
310:     openInNewWindow: 'Open in New Window',
311:     showInExplorer: 'Show in Explorer',
312:     copyPath: 'Copy Path',
313:     delete: 'Delete',
314:     filterStatuses: 'Filter statuses...',
```

---

### 第 313 行: "Delete"

- 建议键名: `delete`
- 英文原文: `Delete`
- 中文翻译: [待填写]

**上下文:**

```
311:     showInExplorer: 'Show in Explorer',
312:     copyPath: 'Copy Path',
313:     delete: 'Delete',
314:     filterStatuses: 'Filter statuses...',
315:     unflag: 'Unflag',
```

---

### 第 315 行: "Unflag"

- 建议键名: `unflag`
- 英文原文: `Unflag`
- 中文翻译: [待填写]

**上下文:**

```
313:     delete: 'Delete',
314:     filterStatuses: 'Filter statuses...',
315:     unflag: 'Unflag',
316:     unarchive: 'Unarchive',
317:     markAsUnread: 'Mark as Unread',
```

---

### 第 316 行: "Unarchive"

- 建议键名: `unarchive`
- 英文原文: `Unarchive`
- 中文翻译: [待填写]

**上下文:**

```
314:     filterStatuses: 'Filter statuses...',
315:     unflag: 'Unflag',
316:     unarchive: 'Unarchive',
317:     markAsUnread: 'Mark as Unread',
318:     sendToWorkspace: 'Send to Workspace...',
```

---

### 第 317 行: "Mark as Unread"

- 建议键名: `markAsUnread`
- 英文原文: `Mark as Unread`
- 中文翻译: [待填写]

**上下文:**

```
315:     unflag: 'Unflag',
316:     unarchive: 'Unarchive',
317:     markAsUnread: 'Mark as Unread',
318:     sendToWorkspace: 'Send to Workspace...',
319:     openInBrowser: 'Open in Browser',
```

---

### 第 319 行: "Open in Browser"

- 建议键名: `openInBrowser`
- 英文原文: `Open in Browser`
- 中文翻译: [待填写]

**上下文:**

```
317:     markAsUnread: 'Mark as Unread',
318:     sendToWorkspace: 'Send to Workspace...',
319:     openInBrowser: 'Open in Browser',
320:     copyLink: 'Copy Link',
321:     updateShare: 'Update Share',
```

---

### 第 320 行: "Copy Link"

- 建议键名: `copyLink`
- 英文原文: `Copy Link`
- 中文翻译: [待填写]

**上下文:**

```
318:     sendToWorkspace: 'Send to Workspace...',
319:     openInBrowser: 'Open in Browser',
320:     copyLink: 'Copy Link',
321:     updateShare: 'Update Share',
322:     stopSharing: 'Stop Sharing',
```

---

### 第 321 行: "Update Share"

- 建议键名: `updateShare`
- 英文原文: `Update Share`
- 中文翻译: [待填写]

**上下文:**

```
319:     openInBrowser: 'Open in Browser',
320:     copyLink: 'Copy Link',
321:     updateShare: 'Update Share',
322:     stopSharing: 'Stop Sharing',
323:     shared: 'Shared',
```

---

### 第 322 行: "Stop Sharing"

- 建议键名: `stopSharing`
- 英文原文: `Stop Sharing`
- 中文翻译: [待填写]

**上下文:**

```
320:     copyLink: 'Copy Link',
321:     updateShare: 'Update Share',
322:     stopSharing: 'Stop Sharing',
323:     shared: 'Shared',
324:     noStatusFound: 'No status found',
```

---

### 第 323 行: "Shared"

- 建议键名: `shared`
- 英文原文: `Shared`
- 中文翻译: [待填写]

**上下文:**

```
321:     updateShare: 'Update Share',
322:     stopSharing: 'Stop Sharing',
323:     shared: 'Shared',
324:     noStatusFound: 'No status found',
325:     explore: 'Explore',
```

---

### 第 324 行: "No status found"

- 建议键名: `noStatusFound`
- 英文原文: `No status found`
- 中文翻译: [待填写]

**上下文:**

```
322:     stopSharing: 'Stop Sharing',
323:     shared: 'Shared',
324:     noStatusFound: 'No status found',
325:     explore: 'Explore',
326:     askToEdit: 'Ask to Edit',
```

---

### 第 325 行: "Explore"

- 建议键名: `explore`
- 英文原文: `Explore`
- 中文翻译: [待填写]

**上下文:**

```
323:     shared: 'Shared',
324:     noStatusFound: 'No status found',
325:     explore: 'Explore',
326:     askToEdit: 'Ask to Edit',
327:     execute: 'Execute',
```

---

### 第 326 行: "Ask to Edit"

- 建议键名: `askToEdit`
- 英文原文: `Ask to Edit`
- 中文翻译: [待填写]

**上下文:**

```
324:     noStatusFound: 'No status found',
325:     explore: 'Explore',
326:     askToEdit: 'Ask to Edit',
327:     execute: 'Execute',
328:     ask: 'Ask',
```

---

### 第 327 行: "Execute"

- 建议键名: `execute`
- 英文原文: `Execute`
- 中文翻译: [待填写]

**上下文:**

```
325:     explore: 'Explore',
326:     askToEdit: 'Ask to Edit',
327:     execute: 'Execute',
328:     ask: 'Ask',
329:     info: 'Info',
```

---

### 第 329 行: "Info"

- 建议键名: `info`
- 英文原文: `Info`
- 中文翻译: [待填写]

**上下文:**

```
327:     execute: 'Execute',
328:     ask: 'Ask',
329:     info: 'Info',
330:     date: 'Date'
331:   },
```

---

### 第 330 行: "Date"

- 建议键名: `date`
- 英文原文: `Date`
- 中文翻译: [待填写]

**上下文:**

```
328:     ask: 'Ask',
329:     info: 'Info',
330:     date: 'Date'
331:   },
332: 
```

---

### 第 336 行: "Welcome to Craft Agents"

- 建议键名: `welcomeToCraftAgents`
- 英文原文: `Welcome to Craft Agents`
- 中文翻译: [待填写]

**上下文:**

```
334:   onboarding: {
335:     welcome: {
336:       title: 'Welcome to Craft Agents',
337:       description: 'Agents with the UX they deserve. Connect anything. Organize your sessions. Everything you need to do the work of your life!',
338:       existingTitle: 'Update Settings',
```

---

### 第 338 行: "Update Settings"

- 建议键名: `updateSettings`
- 英文原文: `Update Settings`
- 中文翻译: [待填写]

**上下文:**

```
336:       title: 'Welcome to Craft Agents',
337:       description: 'Agents with the UX they deserve. Connect anything. Organize your sessions. Everything you need to do the work of your life!',
338:       existingTitle: 'Update Settings',
339:       existingDescription: 'Update your API connection or change your setup.',
340:       checking: 'Checking...',
```

---

### 第 341 行: "Get Started"

- 建议键名: `getStarted`
- 英文原文: `Get Started`
- 中文翻译: [待填写]

**上下文:**

```
339:       existingDescription: 'Update your API connection or change your setup.',
340:       checking: 'Checking...',
341:       getStarted: 'Get Started'
342:     }
343:   }
```

---

## apps\electron\src\renderer\i18n\locales\zh-CN.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\i18n\locales\zh-CN.ts`

待翻译数量: 3

### 第 143 行: "Top P"

- 建议键名: `topP`
- 英文原文: `Top P`
- 中文翻译: [待填写]

**上下文:**

```
141:     temperature: '温度',
142:     maxTokens: '最大令牌',
143:     topP: 'Top P',
144:     frequencyPenalty: '频率惩罚',
145:     presencePenalty: '存在惩罚'
```

---

### 第 261 行: "APIs"

- 建议键名: `apis`
- 英文原文: `APIs`
- 中文翻译: [待填写]

**上下文:**

```
259:     labels: '标签',
260:     sources: '数据源',
261:     apis: 'APIs',
262:     mcps: 'MCPs',
263:     localFolders: '本地文件夹',
```

---

### 第 262 行: "MCPs"

- 建议键名: `mcps`
- 英文原文: `MCPs`
- 中文翻译: [待填写]

**上下文:**

```
260:     sources: '数据源',
261:     apis: 'APIs',
262:     mcps: 'MCPs',
263:     localFolders: '本地文件夹',
264:     skills: '技能',
```

---

## apps\electron\src\renderer\lib\navigation-registry.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\lib\navigation-registry.ts`

待翻译数量: 3

### 第 120 行: "Sessions"

- 建议键名: `sessions`
- 英文原文: `Sessions`
- 中文翻译: [待填写]

**上下文:**

```
118: export const NavigationRegistry = {
119:   sessions: {
120:     displayName: 'Sessions',
121:     detailsPages: {
122:       session: PlaceholderComponent, // Will be: ChatPage
```

---

### 第 149 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
147: 
148:   sources: {
149:     displayName: 'Sources',
150:     detailsPages: {
151:       source: PlaceholderComponent, // Will be: SourceInfoPage
```

---

### 第 158 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
156: 
157:   settings: {
158:     displayName: 'Settings',
159:     detailsPages: {
160:       app: PlaceholderComponent, // AppSettingsPage
```

---

## apps\electron\src\renderer\lib\provider-icons.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\lib\provider-icons.ts`

待翻译数量: 16

### 第 49 行: "Anthropic"

- 建议键名: `anthropic`
- 英文原文: `Anthropic`
- 中文翻译: [待填写]

**上下文:**

```
47: /** Human-readable provider names */
48: const providerDisplayNames: Record<string, string> = {
49:   anthropic: 'Anthropic',
50:   openai: 'OpenAI',
51:   openai_compat: 'OpenAI',
```

---

### 第 50 行: "OpenAI"

- 建议键名: `openai`
- 英文原文: `OpenAI`
- 中文翻译: [待填写]

**上下文:**

```
48: const providerDisplayNames: Record<string, string> = {
49:   anthropic: 'Anthropic',
50:   openai: 'OpenAI',
51:   openai_compat: 'OpenAI',
52:   copilot: 'GitHub Copilot',
```

---

### 第 51 行: "OpenAI"

- 建议键名: `openai`
- 英文原文: `OpenAI`
- 中文翻译: [待填写]

**上下文:**

```
49:   anthropic: 'Anthropic',
50:   openai: 'OpenAI',
51:   openai_compat: 'OpenAI',
52:   copilot: 'GitHub Copilot',
53:   kimi: 'Kimi',
```

---

### 第 52 行: "GitHub Copilot"

- 建议键名: `githubCopilot`
- 英文原文: `GitHub Copilot`
- 中文翻译: [待填写]

**上下文:**

```
50:   openai: 'OpenAI',
51:   openai_compat: 'OpenAI',
52:   copilot: 'GitHub Copilot',
53:   kimi: 'Kimi',
54:   minimax: 'Minimax',
```

---

### 第 53 行: "Kimi"

- 建议键名: `kimi`
- 英文原文: `Kimi`
- 中文翻译: [待填写]

**上下文:**

```
51:   openai_compat: 'OpenAI',
52:   copilot: 'GitHub Copilot',
53:   kimi: 'Kimi',
54:   minimax: 'Minimax',
55:   ollama: 'Ollama',
```

---

### 第 54 行: "Minimax"

- 建议键名: `minimax`
- 英文原文: `Minimax`
- 中文翻译: [待填写]

**上下文:**

```
52:   copilot: 'GitHub Copilot',
53:   kimi: 'Kimi',
54:   minimax: 'Minimax',
55:   ollama: 'Ollama',
56:   openrouter: 'OpenRouter',
```

---

### 第 55 行: "Ollama"

- 建议键名: `ollama`
- 英文原文: `Ollama`
- 中文翻译: [待填写]

**上下文:**

```
53:   kimi: 'Kimi',
54:   minimax: 'Minimax',
55:   ollama: 'Ollama',
56:   openrouter: 'OpenRouter',
57:   pi: 'Craft Agents Backend',
```

---

### 第 56 行: "OpenRouter"

- 建议键名: `openrouter`
- 英文原文: `OpenRouter`
- 中文翻译: [待填写]

**上下文:**

```
54:   minimax: 'Minimax',
55:   ollama: 'Ollama',
56:   openrouter: 'OpenRouter',
57:   pi: 'Craft Agents Backend',
58:   pi_compat: 'Craft Agents Backend',
```

---

### 第 57 行: "Craft Agents Backend"

- 建议键名: `craftAgentsBackend`
- 英文原文: `Craft Agents Backend`
- 中文翻译: [待填写]

**上下文:**

```
55:   ollama: 'Ollama',
56:   openrouter: 'OpenRouter',
57:   pi: 'Craft Agents Backend',
58:   pi_compat: 'Craft Agents Backend',
59:   vercel: 'Vercel',
```

---

### 第 58 行: "Craft Agents Backend"

- 建议键名: `craftAgentsBackend`
- 英文原文: `Craft Agents Backend`
- 中文翻译: [待填写]

**上下文:**

```
56:   openrouter: 'OpenRouter',
57:   pi: 'Craft Agents Backend',
58:   pi_compat: 'Craft Agents Backend',
59:   vercel: 'Vercel',
60: }
```

---

### 第 59 行: "Vercel"

- 建议键名: `vercel`
- 英文原文: `Vercel`
- 中文翻译: [待填写]

**上下文:**

```
57:   pi: 'Craft Agents Backend',
58:   pi_compat: 'Craft Agents Backend',
59:   vercel: 'Vercel',
60: }
61: 
```

---

### 第 67 行: "OpenRouter"

- 建议键名: `openrouter`
- 英文原文: `OpenRouter`
- 中文翻译: [待填写]

**上下文:**

```
65:   if (baseUrl) {
66:     const url = baseUrl.toLowerCase()
67:     if (url.includes('openrouter.ai')) return 'OpenRouter'
68:     if (url.includes('ollama')) return 'Ollama'
69:     if (url.includes('kimi.com')) return 'Kimi'
```

---

### 第 68 行: "Ollama"

- 建议键名: `ollama`
- 英文原文: `Ollama`
- 中文翻译: [待填写]

**上下文:**

```
66:     const url = baseUrl.toLowerCase()
67:     if (url.includes('openrouter.ai')) return 'OpenRouter'
68:     if (url.includes('ollama')) return 'Ollama'
69:     if (url.includes('kimi.com')) return 'Kimi'
70:     if (url.includes('minimax.io') || url.includes('minimaxi.com')) return 'Minimax'
```

---

### 第 69 行: "Kimi"

- 建议键名: `kimi`
- 英文原文: `Kimi`
- 中文翻译: [待填写]

**上下文:**

```
67:     if (url.includes('openrouter.ai')) return 'OpenRouter'
68:     if (url.includes('ollama')) return 'Ollama'
69:     if (url.includes('kimi.com')) return 'Kimi'
70:     if (url.includes('minimax.io') || url.includes('minimaxi.com')) return 'Minimax'
71:     if (url.includes('v0.dev') || url.includes('vercel')) return 'Vercel'
```

---

### 第 70 行: "Minimax"

- 建议键名: `minimax`
- 英文原文: `Minimax`
- 中文翻译: [待填写]

**上下文:**

```
68:     if (url.includes('ollama')) return 'Ollama'
69:     if (url.includes('kimi.com')) return 'Kimi'
70:     if (url.includes('minimax.io') || url.includes('minimaxi.com')) return 'Minimax'
71:     if (url.includes('v0.dev') || url.includes('vercel')) return 'Vercel'
72:   }
```

---

### 第 71 行: "Vercel"

- 建议键名: `vercel`
- 英文原文: `Vercel`
- 中文翻译: [待填写]

**上下文:**

```
69:     if (url.includes('kimi.com')) return 'Kimi'
70:     if (url.includes('minimax.io') || url.includes('minimaxi.com')) return 'Minimax'
71:     if (url.includes('v0.dev') || url.includes('vercel')) return 'Vercel'
72:   }
73:   return providerDisplayNames[providerType] || providerType
```

---

## apps\electron\src\renderer\lib\session-load.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\lib\session-load.ts`

待翻译数量: 1

### 第 21 行: "Unknown error"

- 建议键名: `unknownError`
- 英文原文: `Unknown error`
- 中文翻译: [待填写]

**上下文:**

```
19:   if (error instanceof Error && error.message.trim()) return error.message
20:   if (typeof error === 'string' && error.trim()) return error
21:   return 'Unknown error'
22: }
23: 
```

---

## apps\electron\src\renderer\utils\auth-validation.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\utils\auth-validation.ts`

待翻译数量: 2

### 第 45 行: "Password"

- 建议键名: `password`
- 英文原文: `Password`
- 中文翻译: [待填写]

**上下文:**

```
43:  * Get the password label with optional suffix
44:  *
45:  * @param baseLabel - The base label (e.g., "Password")
46:  * @param passwordRequired - Whether password is required
47:  * @returns The label with " (optional)" suffix if not required
```

---

### 第 59 行: "Password"

- 建议键名: `password`
- 英文原文: `Password`
- 中文翻译: [待填写]

**上下文:**

```
57:  * Get the password placeholder text
58:  *
59:  * @param baseLabel - The base label (e.g., "Password")
60:  * @param passwordRequired - Whether password is required
61:  * @returns Appropriate placeholder text
```

---

