# 特定文本翻译待处理列表

> 生成时间: 2026-04-08T16:34:45.280Z
> 扫描目录: D:\Projects\CraftAgents\apps\electron\src\renderer
> 发现文件数: 39
> 发现文本数: 170
> 目标文本数: 58

---

## 目录

- [definitions.ts](#apps-electron-src-renderer-actions-definitions-ts)
- [useHotkeyLabel.ts](#apps-electron-src-renderer-actions-useHotkeyLabel-ts)
- [AppMenu.tsx](#apps-electron-src-renderer-components-AppMenu-tsx)
- [KeyboardShortcutsDialog.tsx](#apps-electron-src-renderer-components-KeyboardShortcutsDialog-tsx)
- [AppShell.tsx](#apps-electron-src-renderer-components-app-shell-AppShell-tsx)
- [BatchSessionMenu.tsx](#apps-electron-src-renderer-components-app-shell-BatchSessionMenu-tsx)
- [ChatDisplay.tsx](#apps-electron-src-renderer-components-app-shell-ChatDisplay-tsx)
- [NavigatorPanel.tsx](#apps-electron-src-renderer-components-app-shell-NavigatorPanel-tsx)
- [SessionMenu.tsx](#apps-electron-src-renderer-components-app-shell-SessionMenu-tsx)
- [SidebarMenu.tsx](#apps-electron-src-renderer-components-app-shell-SidebarMenu-tsx)
- [TopBar.tsx](#apps-electron-src-renderer-components-app-shell-TopBar-tsx)
- [WorkspaceSwitcher.tsx](#apps-electron-src-renderer-components-app-shell-WorkspaceSwitcher-tsx)
- [FreeFormInput.tsx](#apps-electron-src-renderer-components-app-shell-input-FreeFormInput-tsx)
- [AutomationInfoPage.tsx](#apps-electron-src-renderer-components-automations-AutomationInfoPage-tsx)
- [LabelsDataTable.tsx](#apps-electron-src-renderer-components-info-LabelsDataTable-tsx)
- [PermissionsDataTable.tsx](#apps-electron-src-renderer-components-info-PermissionsDataTable-tsx)
- [SettingsSection.tsx](#apps-electron-src-renderer-components-settings-SettingsSection-tsx)
- [EditPopover.tsx](#apps-electron-src-renderer-components-ui-EditPopover-tsx)
- [label-menu-utils.ts](#apps-electron-src-renderer-components-ui-label-menu-utils-ts)
- [mention-menu.tsx](#apps-electron-src-renderer-components-ui-mention-menu-tsx)
- [AddWorkspaceStep_CreateNew.tsx](#apps-electron-src-renderer-components-workspace-AddWorkspaceStep-CreateNew-tsx)
- [AddWorkspaceStep_OpenFolder.tsx](#apps-electron-src-renderer-components-workspace-AddWorkspaceStep-OpenFolder-tsx)
- [useSessionActions.ts](#apps-electron-src-renderer-hooks-useSessionActions-ts)
- [en-US.ts](#apps-electron-src-renderer-i18n-locales-en-US-ts)
- [zh-CN.ts](#apps-electron-src-renderer-i18n-locales-zh-CN-ts)
- [navigation-registry.ts](#apps-electron-src-renderer-lib-navigation-registry-ts)
- [PreferencesPage.tsx](#apps-electron-src-renderer-pages-PreferencesPage-tsx)
- [ShortcutsPage.tsx](#apps-electron-src-renderer-pages-ShortcutsPage-tsx)
- [SkillInfoPage.tsx](#apps-electron-src-renderer-pages-SkillInfoPage-tsx)
- [SourceInfoPage.tsx](#apps-electron-src-renderer-pages-SourceInfoPage-tsx)
- [AiSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-AiSettingsPage-tsx)
- [AppSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-AppSettingsPage-tsx)
- [AppearanceSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-AppearanceSettingsPage-tsx)
- [InputSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-InputSettingsPage-tsx)
- [LabelsSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-LabelsSettingsPage-tsx)
- [PermissionsSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-PermissionsSettingsPage-tsx)
- [PreferencesPage.tsx](#apps-electron-src-renderer-pages-settings-PreferencesPage-tsx)
- [ShortcutsPage.tsx](#apps-electron-src-renderer-pages-settings-ShortcutsPage-tsx)
- [WorkspaceSettingsPage.tsx](#apps-electron-src-renderer-pages-settings-WorkspaceSettingsPage-tsx)

---

## apps\electron\src\renderer\actions\definitions.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\actions\definitions.ts`

待翻译数量: 9

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

## apps\electron\src\renderer\actions\useHotkeyLabel.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\actions\useHotkeyLabel.ts`

待翻译数量: 1

### 第 25 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
23:  * @example
24:  * const { label, hotkey } = useActionLabel('app.newChat')
25:  * // label: "New Chat", hotkey: "⌘N"
26:  */
27: export function useActionLabel(actionId: ActionId) {
```

---

## apps\electron\src\renderer\components\app-shell\AppShell.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\AppShell.tsx`

待翻译数量: 13

### 第 1460 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
1458:       case 'label': {
1459:         if (sessionFilter.labelId === '__all__') {
1460:           // "Labels" header: show all active sessions that have at least one label
1461:           result = activeSessionMetas.filter(s => s.labels && s.labels.length > 0)
1462:         } else {
```

---

### 第 1915 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
1913:   }, [activeWorkspace])
1914: 
1915:   // Respond to menu bar "New Chat" trigger
1916:   const menuTriggerRef = useRef(menuNewChatTrigger)
1917:   useEffect(() => {
```

---

### 第 2074 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
2072:     // Sources navigator
2073:     if (isSourcesNavigation(navState)) {
2074:       return t('sidebar.sources', 'Sources')
2075:     }
2076: 
```

---

### 第 2094 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
2092: 
2093:     // Settings navigator
2094:     if (isSettingsNavigation(navState)) return t('sidebar.settings', 'Settings')
2095: 
2096:     // Sessions navigator - use sessionFilter
```

---

### 第 2107 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
2105:       }
2106:       case 'label':
2107:         return sessionFilter.labelId === '__all__' ? t('sidebar.labels', 'Labels') : getLabelDisplayName(labelConfigs, sessionFilter.labelId)
2108:       case 'view':
2109:         return sessionFilter.viewId === '__all__' ? t('sidebar.views', 'Views') : viewConfigs.find(v => v.id === sessionFilter.viewId)?.name || t('sidebar.views', 'Views')
```

---

### 第 2337 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
2335:                     {
2336:                       id: "nav:labels",
2337:                       title: t('sidebar.labels', 'Labels'),
2338:                       icon: Tag,
2339:                       // Only highlighted when "Labels" itself is selected (not sub-labels)
```

---

### 第 2339 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
2337:                       title: t('sidebar.labels', 'Labels'),
2338:                       icon: Tag,
2339:                       // Only highlighted when "Labels" itself is selected (not sub-labels)
2340:                       variant: (sessionFilter?.kind === 'label' && sessionFilter.labelId === '__all__') ? "default" as const : "ghost" as const,
2341:                       // Clicking navigates to "all labeled sessions" view
```

---

### 第 2358 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
2356:                     {
2357:                       id: "nav:sources",
2358:                       title: t('sidebar.sources', 'Sources'),
2359:                       label: String(sources.length),
2360:                       icon: DatabaseZap,
```

---

### 第 2415 行: "Skills"

- 建议键名: `skills`
- 英文原文: `Skills`
- 中文翻译: [待填写]

**上下文:**

```
2413:                     {
2414:                       id: "nav:skills",
2415:                       title: t('sidebar.skills', 'Skills'),
2416:                       label: String(skills.length),
2417:                       icon: Zap,
```

---

### 第 2427 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
2425:                     {
2426:                       id: "nav:automations",
2427:                       title: t('sidebar.automations', 'Automations'),
2428:                       label: String(automations.length),
2429:                       icon: ListTodo,
```

---

### 第 2474 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
2472:                     {
2473:                       id: "nav:settings",
2474:                       title: t('sidebar.settings', 'Settings'),
2475:                       icon: Settings,
2476:                       variant: isSettingsNavigation(navState) ? "default" : "ghost",
```

---

### 第 2769 行: "Statuses"

- 建议键名: `statuses`
- 英文原文: `Statuses`
- 中文翻译: [待填写]

**上下文:**

```
2767:                               <StyledDropdownMenuSubTrigger>
2768:                                 <Inbox className="h-3.5 w-3.5" />
2769:                                 <span className="flex-1">{t('ui.statuses', 'Statuses')}</span>
2770:                               </StyledDropdownMenuSubTrigger>
2771:                               <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
```

---

### 第 2842 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
2840:                               <StyledDropdownMenuSubTrigger>
2841:                                 <Tag className="h-3.5 w-3.5" />
2842:                                 <span className="flex-1">{t('ui.labels', 'Labels')}</span>
2843:                               </StyledDropdownMenuSubTrigger>
2844:                               <StyledDropdownMenuSubContent minWidth="min-w-[180px]">
```

---

## apps\electron\src\renderer\components\app-shell\BatchSessionMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\BatchSessionMenu.tsx`

待翻译数量: 1

### 第 205 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
203:           <SubTrigger className="pr-2">
204:             <Tag className="h-3.5 w-3.5" />
205:             <span className="flex-1">Labels</span>
206:           </SubTrigger>
207:           <SubContent>
```

---

## apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`

待翻译数量: 5

### 第 1098 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
1096:     for (const a of activities) {
1097:       const input = a.toolInput as Record<string, unknown> | undefined
1098:       if (a.toolName === 'Edit' && input) {
1099:         // Check for Codex format: { changes: Array<{ path, kind, diff }> }
1100:         if (input.changes && Array.isArray(input.changes)) {
```

---

### 第 1106 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
1104:               id: `${a.id}-${codexChange.path || 'unknown'}`,
1105:               filePath: codexChange.path || 'unknown',
1106:               toolType: 'Edit',
1107:               original: '',
1108:               modified: '',
```

---

### 第 1118 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
1116:             id: a.id,
1117:             filePath: (input.file_path as string) || (input.path as string) || 'unknown',
1118:             toolType: 'Edit',
1119:             original: (input.old_string as string) || (input.oldText as string) || '',
1120:             modified: (input.new_string as string) || (input.newText as string) || '',
```

---

### 第 1885 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
1883:                           // Edit/Write tool → Multi-file diff overlay (ungrouped, focused on this change)
1884:                           // Exception: Write to .md/.txt files goes to document overlay instead
1885:                           if ((activity.toolName === 'Edit' || activity.toolName === 'Write') && !isDocumentWrite) {
1886:                             const changes = collectFileChanges(turn.activities)
1887:                             if (changes.length > 0) {
```

---

### 第 1901 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
1899:                         }}
1900:                         hasEditOrWriteActivities={turn.activities.some(a =>
1901:                           a.toolName === 'Edit' || a.toolName === 'Write'
1902:                         )}
1903:                         onOpenMultiFileDiff={() => {
```

---

## apps\electron\src\renderer\components\app-shell\input\FreeFormInput.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\input\FreeFormInput.tsx`

待翻译数量: 4

### 第 1721 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
1719:                 label={
1720:                   optimisticSourceSlugs.length === 0
1721:                     ? "Sources"
1722:                     : (() => {
1723:                         const enabledSources = sources.filter(s => optimisticSourceSlugs.includes(s.config.slug))
```

---

### 第 1734 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
1732:                 disabled={disabled}
1733:                 onClick={() => setSourceDropdownOpen(prev => !prev)}
1734:                 tooltip="Sources"
1735:               />
1736:               <SourceSelectorPopover
```

---

### 第 1841 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
1839:                 data-tutorial="source-selector-button"
1840:                 onClick={() => setSourceDropdownOpen(prev => !prev)}
1841:                 tooltip="Sources"
1842:               />
1843: 
```

---

### 第 2331 行: "Choose working directory"

- 建议键名: `chooseWorkingDirectory`
- 英文原文: `Choose working directory`
- 中文翻译: [待填写]

**上下文:**

```
2329:                   {gitBranch && <span className="text-xs opacity-70">on {gitBranch}</span>}
2330:                 </span>
2331:               ) : "Choose working directory"
2332:             }
2333:           />
```

---

## apps\electron\src\renderer\components\app-shell\NavigatorPanel.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\NavigatorPanel.tsx`

待翻译数量: 1

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

## apps\electron\src\renderer\components\app-shell\SessionMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\SessionMenu.tsx`

待翻译数量: 1

### 第 231 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
229:           <SubTrigger className="pr-2">
230:           <Tag className="h-3.5 w-3.5" />
231:           <span className="flex-1">{t('ui.labels', 'Labels')}</span>
232:           {sessionLabels.length > 0 && (
233:             <span className="text-[10px] text-muted-foreground tabular-nums -mr-2.5">
```

---

## apps\electron\src\renderer\components\app-shell\SidebarMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\SidebarMenu.tsx`

待翻译数量: 1

### 第 123 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
121: 
122:   // Labels: show context-appropriate actions
123:   // - Header ("Labels" parent): Configure Labels + Add New Label
124:   // - Individual label items: Add New Label (as child) + Delete Label
125:   if (type === 'labels') {
```

---

## apps\electron\src\renderer\components\app-shell\TopBar.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\TopBar.tsx`

待翻译数量: 8

### 第 259 行: "Toggle Sidebar"

- 建议键名: `toggleSidebar`
- 英文原文: `Toggle Sidebar`
- 中文翻译: [待填写]

**上下文:**

```
257:             </TopBarButton>
258:           </TooltipTrigger>
259:           <TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
260:         </Tooltip>
261:         )}
```

---

### 第 437 行: "Help & Documentation"

- 建议键名: `helpDocumentation`
- 英文原文: `Help & Documentation`
- 中文翻译: [待填写]

**上下文:**

```
435:         <DropdownMenu>
436:           <DropdownMenuTrigger asChild>
437:             <TopBarButton aria-label="Help & Documentation" className="h-[26px] w-[26px] rounded-lg">
438:               <Icons.HelpCircle className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
439:             </TopBarButton>
```

---

### 第 444 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
442:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
443:               <Icons.DatabaseZap className="h-3.5 w-3.5" />
444:               <span className="flex-1">Sources</span>
445:               <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
446:             </StyledDropdownMenuItem>
```

---

### 第 449 行: "Skills"

- 建议键名: `skills`
- 英文原文: `Skills`
- 中文翻译: [待填写]

**上下文:**

```
447:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
448:               <Icons.Zap className="h-3.5 w-3.5" />
449:               <span className="flex-1">Skills</span>
450:               <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
451:             </StyledDropdownMenuItem>
```

---

### 第 454 行: "Statuses"

- 建议键名: `statuses`
- 英文原文: `Statuses`
- 中文翻译: [待填写]

**上下文:**

```
452:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
453:               <Icons.CheckCircle2 className="h-3.5 w-3.5" />
454:               <span className="flex-1">Statuses</span>
455:               <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
456:             </StyledDropdownMenuItem>
```

---

### 第 459 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
457:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
458:               <Icons.Settings className="h-3.5 w-3.5" />
459:               <span className="flex-1">Permissions</span>
460:               <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
461:             </StyledDropdownMenuItem>
```

---

### 第 464 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
462:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
463:               <Icons.Webhook className="h-3.5 w-3.5" />
464:               <span className="flex-1">Automations</span>
465:               <Icons.ExternalLink className="h-3 w-3 text-muted-foreground" />
466:             </StyledDropdownMenuItem>
```

---

### 第 470 行: "All Documentation"

- 建议键名: `allDocumentation`
- 英文原文: `All Documentation`
- 中文翻译: [待填写]

**上下文:**

```
468:             <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
469:               <Icons.ExternalLink className="h-3.5 w-3.5" />
470:               <span className="flex-1">All Documentation</span>
471:             </StyledDropdownMenuItem>
472:           </StyledDropdownMenuContent>
```

---

## apps\electron\src\renderer\components\app-shell\WorkspaceSwitcher.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\app-shell\WorkspaceSwitcher.tsx`

待翻译数量: 1

### 第 200 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
198:                 fallback={selectedWorkspace?.name?.charAt(0) || 'W'}
199:               />
200:               <span className="truncate min-w-0 flex-1 text-left">{selectedWorkspace?.name || 'Workspace'}</span>
201:               {selectedWorkspace?.remoteServer && (
202:                 isRemoteDisconnected(selectedWorkspace.id)
```

---

## apps\electron\src\renderer\components\AppMenu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\AppMenu.tsx`

待翻译数量: 13

### 第 215 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
213:           <StyledDropdownMenuItem onClick={onNewChat}>
214:             <SquarePenRounded className="h-3.5 w-3.5" />
215:             {t('chat.newChat', 'New Chat')}
216:             {newChatHotkey && <DropdownMenuShortcut className="pl-6">{newChatHotkey}</DropdownMenuShortcut>}
217:           </StyledDropdownMenuItem>
```

---

### 第 221 行: "New Window"

- 建议键名: `newWindow`
- 英文原文: `New Window`
- 中文翻译: [待填写]

**上下文:**

```
219:             <StyledDropdownMenuItem onClick={onNewWindow}>
220:               <Icons.AppWindow className="h-3.5 w-3.5" />
221:               {t('common.newWindow', 'New Window')}
222:               {newWindowHotkey && <DropdownMenuShortcut className="pl-6">{newWindowHotkey}</DropdownMenuShortcut>}
223:             </StyledDropdownMenuItem>
```

---

### 第 239 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
237:             <StyledDropdownMenuSubTrigger>
238:               <Icons.Settings className="h-3.5 w-3.5" />
239:               {t('common.settings', 'Settings')}
240:             </StyledDropdownMenuSubTrigger>
241:             <StyledDropdownMenuSubContent>
```

---

### 第 245 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
243:               <StyledDropdownMenuItem onClick={onOpenSettings}>
244:                 <Icons.Settings className="h-3.5 w-3.5" />
245:                 {t('common.settings', 'Settings')}...
246:                 {settingsHotkey && <DropdownMenuShortcut className="pl-6">{settingsHotkey}</DropdownMenuShortcut>}
247:               </StyledDropdownMenuItem>
```

---

### 第 269 行: "Help"

- 建议键名: `help`
- 英文原文: `Help`
- 中文翻译: [待填写]

**上下文:**

```
267:             <StyledDropdownMenuSubTrigger>
268:               <Icons.HelpCircle className="h-3.5 w-3.5" />
269:               {t('common.help', 'Help')}
270:             </StyledDropdownMenuSubTrigger>
271:             <StyledDropdownMenuSubContent>
```

---

### 第 274 行: "Help & Documentation"

- 建议键名: `helpDocumentation`
- 英文原文: `Help & Documentation`
- 中文翻译: [待填写]

**上下文:**

```
272:               <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs')}>
273:                 <Icons.HelpCircle className="h-3.5 w-3.5" />
274:                 {t('common.helpDocumentation', 'Help & Documentation')}
275:                 <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
276:               </StyledDropdownMenuItem>
```

---

### 第 279 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
277:               <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
278:                 <Icons.Webhook className="h-3.5 w-3.5" />
279:                 {t('common.automations', 'Automations')}
280:                 <Icons.ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
281:               </StyledDropdownMenuItem>
```

---

### 第 285 行: "Keyboard Shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
283:               <StyledDropdownMenuItem onClick={onOpenKeyboardShortcuts}>
284:                 <Icons.Keyboard className="h-3.5 w-3.5" />
285:                 {t('shortcuts.keyboardShortcuts', 'Keyboard Shortcuts')}
286:                 {keyboardShortcutsHotkey && <DropdownMenuShortcut className="pl-6">{keyboardShortcutsHotkey}</DropdownMenuShortcut>}
287:               </StyledDropdownMenuItem>
```

---

### 第 297 行: "Debug"

- 建议键名: `debug`
- 英文原文: `Debug`
- 中文翻译: [待填写]

**上下文:**

```
295:                 <StyledDropdownMenuSubTrigger>
296:                   <Icons.Bug className="h-3.5 w-3.5" />
297:                   {t('common.debug', 'Debug')}
298:                 </StyledDropdownMenuSubTrigger>
299:                 <StyledDropdownMenuSubContent>
```

---

### 第 302 行: "Check for Updates"

- 建议键名: `checkForUpdates`
- 英文原文: `Check for Updates`
- 中文翻译: [待填写]

**上下文:**

```
300:                   <StyledDropdownMenuItem onClick={() => window.electronAPI.checkForUpdates()}>
301:                     <Icons.Download className="h-3.5 w-3.5" />
302:                     {t('common.checkForUpdates', 'Check for Updates')}
303:                   </StyledDropdownMenuItem>
304:                   <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
```

---

### 第 306 行: "Install Update"

- 建议键名: `installUpdate`
- 英文原文: `Install Update`
- 中文翻译: [待填写]

**上下文:**

```
304:                   <StyledDropdownMenuItem onClick={() => window.electronAPI.installUpdate()}>
305:                     <Icons.Download className="h-3.5 w-3.5" />
306:                     {t('common.installUpdate', 'Install Update')}
307:                   </StyledDropdownMenuItem>
308:                   <StyledDropdownMenuSeparator />
```

---

### 第 311 行: "Toggle DevTools"

- 建议键名: `toggleDevtools`
- 英文原文: `Toggle DevTools`
- 中文翻译: [待填写]

**上下文:**

```
309:                   <StyledDropdownMenuItem onClick={() => window.electronAPI.menuToggleDevTools()}>
310:                     <Icons.Bug className="h-3.5 w-3.5" />
311:                     {t('common.toggleDevTools', 'Toggle DevTools')}
312:                     <DropdownMenuShortcut className="pl-6">{isMac ? '⌥⌘I' : 'Ctrl+Shift+I'}</DropdownMenuShortcut>
313:                   </StyledDropdownMenuItem>
```

---

### 第 324 行: "Quit Craft Agents"

- 建议键名: `quitCraftAgents`
- 英文原文: `Quit Craft Agents`
- 中文翻译: [待填写]

**上下文:**

```
322:           <StyledDropdownMenuItem onClick={() => window.electronAPI.menuQuit()}>
323:             <Icons.LogOut className="h-3.5 w-3.5" />
324:             {t('common.quit', 'Quit Craft Agents')}
325:             {quitHotkey && <DropdownMenuShortcut className="pl-6">{quitHotkey}</DropdownMenuShortcut>}
326:           </StyledDropdownMenuItem>
```

---

## apps\electron\src\renderer\components\automations\AutomationInfoPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\automations\AutomationInfoPage.tsx`

待翻译数量: 2

### 第 193 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
191: 
192:         {/* Section: Settings */}
193:         <Info_Section title={t('common.settings', 'Settings')} actions={editActions}>
194:           <Info_Table>
195:             <Info_Table.Row label={t('common.accessLevel', 'Access Level')} value={getPermissionDisplayName(automation.permissionMode, t)} />
```

---

### 第 202 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
200:             </Info_Table.Row>
201:             {automation.labels && automation.labels.length > 0 && (
202:               <Info_Table.Row label={t('common.labels', 'Labels')}>
203:                 <div className="flex gap-1.5 flex-wrap">
204:                   {automation.labels.map((l) => (
```

---

## apps\electron\src\renderer\components\info\LabelsDataTable.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\LabelsDataTable.tsx`

待翻译数量: 1

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

## apps\electron\src\renderer\components\info\PermissionsDataTable.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\info\PermissionsDataTable.tsx`

待翻译数量: 1

### 第 177 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
175:   maxHeight = 400,
176:   fullscreen = false,
177:   fullscreenTitle = 'Permissions',
178:   className,
179: }: PermissionsDataTableProps) {
```

---

## apps\electron\src\renderer\components\KeyboardShortcutsDialog.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\KeyboardShortcutsDialog.tsx`

待翻译数量: 1

### 第 150 行: "Keyboard Shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
148:       <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
149:         <DialogHeader>
150:           <DialogTitle>Keyboard Shortcuts</DialogTitle>
151:         </DialogHeader>
152:         <div className="space-y-6 py-2">
```

---

## apps\electron\src\renderer\components\settings\SettingsSection.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\settings\SettingsSection.tsx`

待翻译数量: 4

### 第 82 行: "App"

- 建议键名: `app`
- 英文原文: `App`
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

## apps\electron\src\renderer\components\ui\EditPopover.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\EditPopover.tsx`

待翻译数量: 3

### 第 38 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
36:  */
37: export interface EditContext {
38:   /** Human-readable label for badge display and agent context (e.g., "Permissions") */
39:   label: string
40:   /** Absolute path to the file being edited */
```

---

### 第 395 行: "Bug"

- 建议键名: `bug`
- 英文原文: `Bug`
- 中文翻译: [待填写]

**上下文:**

```
393:         'Confirm clearly when done.',
394:     },
395:     example: 'Add a "Bug" label with red color',
396:     model: 'haiku',               // Use fast model for quick config edits
397:     systemPromptPreset: 'mini',   // Use focused mini prompt
```

---

### 第 435 行: "Bug"

- 建议键名: `bug`
- 英文原文: `Bug`
- 中文翻译: [待填写]

**上下文:**

```
433:         'Confirm clearly when done.',
434:     },
435:     example: 'A red "Bug" label',
436:     overridePlaceholder: 'What label would you like to create?',
437:     model: 'haiku',               // Use fast model for quick config edits
```

---

## apps\electron\src\renderer\components\ui\label-menu-utils.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\label-menu-utils.ts`

待翻译数量: 2

### 第 41 行: "Priority"

- 建议键名: `priority`
- 英文原文: `Priority`
- 中文翻译: [待填写]

**上下文:**

```
39: /**
40:  * Score how well a segment matches a path part.
41:  * 3 = starts with segment (best: "pri" → "Priority")
42:  * 2 = word boundary match (after space/hyphen/underscore: "high" → "super-high")
43:  * 1 = contains anywhere (mid-word: "ior" → "Priority")
```

---

### 第 43 行: "Priority"

- 建议键名: `priority`
- 英文原文: `Priority`
- 中文翻译: [待填写]

**上下文:**

```
41:  * 3 = starts with segment (best: "pri" → "Priority")
42:  * 2 = word boundary match (after space/hyphen/underscore: "high" → "super-high")
43:  * 1 = contains anywhere (mid-word: "ior" → "Priority")
44:  * 0 = no match
45:  */
```

---

## apps\electron\src\renderer\components\ui\mention-menu.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\ui\mention-menu.tsx`

待翻译数量: 2

### 第 512 行: "Skills"

- 建议键名: `skills`
- 英文原文: `Skills`
- 中文翻译: [待填写]

**上下文:**

```
510:       result.push({
511:         id: 'skills',
512:         label: 'Skills',
513:         items: skills.map(skill => ({
514:           id: skill.slug,
```

---

### 第 527 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
525:       result.push({
526:         id: 'sources',
527:         label: 'Sources',
528:         items: sources
529:           .filter(source => source.config.slug && source.config.name)
```

---

## apps\electron\src\renderer\components\workspace\AddWorkspaceStep_CreateNew.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\workspace\AddWorkspaceStep_CreateNew.tsx`

待翻译数量: 1

### 第 130 行: "My Workspace"

- 建议键名: `myWorkspace`
- 英文原文: `My Workspace`
- 中文翻译: [待填写]

**上下文:**

```
128:               value={name}
129:               onChange={(e) => setName(e.target.value)}
130:               placeholder="My Workspace"
131:               disabled={isCreating}
132:               autoFocus
```

---

## apps\electron\src\renderer\components\workspace\AddWorkspaceStep_OpenFolder.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\components\workspace\AddWorkspaceStep_OpenFolder.tsx`

待翻译数量: 1

### 第 101 行: "My Workspace"

- 建议键名: `myWorkspace`
- 英文原文: `My Workspace`
- 中文翻译: [待填写]

**上下文:**

```
99:               value={workspaceName}
100:               onChange={(e) => setWorkspaceName(e.target.value)}
101:               placeholder="My Workspace"
102:               disabled={isCreating}
103:             />
```

---

## apps\electron\src\renderer\hooks\useSessionActions.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\hooks\useSessionActions.ts`

待翻译数量: 4

### 第 25 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
23:       description: 'Added to your flagged items',
24:       action: onUnflag ? {
25:         label: 'Undo',
26:         onClick: () => onUnflag(sessionId),
27:       } : undefined,
```

---

### 第 37 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
35:       description: 'Removed from flagged items',
36:       action: onFlag ? {
37:         label: 'Undo',
38:         onClick: () => onFlag(sessionId),
39:       } : undefined,
```

---

### 第 49 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
47:       description: 'Moved to archive',
48:       action: onUnarchive ? {
49:         label: 'Undo',
50:         onClick: () => onUnarchive(sessionId),
51:       } : undefined,
```

---

### 第 61 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
59:       description: 'Moved from archive',
60:       action: onArchive ? {
61:         label: 'Undo',
62:         onClick: () => onArchive(sessionId),
63:       } : undefined,
```

---

## apps\electron\src\renderer\i18n\locales\en-US.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\i18n\locales\en-US.ts`

待翻译数量: 67

### 第 6 行: "App"

- 建议键名: `app`
- 英文原文: `App`
- 中文翻译: [待填写]

**上下文:**

```
4:   settings: {
5:     app: {
6:       label: 'App',
7:       description: 'Notifications and updates',
8:       title: 'App',
```

---

### 第 8 行: "App"

- 建议键名: `app`
- 英文原文: `App`
- 中文翻译: [待填写]

**上下文:**

```
6:       label: 'App',
7:       description: 'Notifications and updates',
8:       title: 'App',
9:       notifications: 'Notifications',
10:       desktopNotifications: 'Desktop notifications',
```

---

### 第 38 行: "AI"

- 建议键名: `ai`
- 英文原文: `AI`
- 中文翻译: [待填写]

**上下文:**

```
36:     },
37:     ai: {
38:       label: 'AI',
39:       description: 'Model, thinking, connections',
40:       title: 'AI',
```

---

### 第 40 行: "AI"

- 建议键名: `ai`
- 英文原文: `AI`
- 中文翻译: [待填写]

**上下文:**

```
38:       label: 'AI',
39:       description: 'Model, thinking, connections',
40:       title: 'AI',
41:       credential: {
42:         fileCorrupted: 'Credential file is corrupted. Please re-authenticate.',
```

---

### 第 61 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
59:         rename: 'Rename',
60:         setAsDefault: 'Set as default',
61:         edit: 'Edit',
62:         validateConnection: 'Validate Connection',
63:         delete: 'Delete'
```

---

### 第 112 行: "Appearance"

- 建议键名: `appearance`
- 英文原文: `Appearance`
- 中文翻译: [待填写]

**上下文:**

```
110:     },
111:     appearance: {
112:       label: 'Appearance',
113:       description: 'Theme, font, tool icons',
114:       title: 'Appearance',
```

---

### 第 114 行: "Appearance"

- 建议键名: `appearance`
- 英文原文: `Appearance`
- 中文翻译: [待填写]

**上下文:**

```
112:       label: 'Appearance',
113:       description: 'Theme, font, tool icons',
114:       title: 'Appearance',
115:       defaultTheme: 'Default Theme',
116:       mode: 'Mode',
```

---

### 第 145 行: "Input"

- 建议键名: `input`
- 英文原文: `Input`
- 中文翻译: [待填写]

**上下文:**

```
143:     },
144:     input: {
145:       label: 'Input',
146:       description: 'Send key, spell check',
147:       title: 'Input',
```

---

### 第 147 行: "Input"

- 建议键名: `input`
- 英文原文: `Input`
- 中文翻译: [待填写]

**上下文:**

```
145:       label: 'Input',
146:       description: 'Send key, spell check',
147:       title: 'Input',
148:       typing: 'Typing',
149:       typingDescription: 'Control how text is entered in the chat input.',
```

---

### 第 165 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
163:     },
164:     workspace: {
165:       label: 'Workspace',
166:       description: 'Name, icon, working directory',
167:       title: 'Workspace Settings',
```

---

### 第 172 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
170:       name: 'Name',
171:       untitled: 'Untitled',
172:       edit: 'Edit',
173:       icon: 'Icon',
174:       uploading: 'Uploading...',
```

---

### 第 179 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
177:       renameWorkspace: 'Rename workspace',
178:       enterWorkspaceName: 'Enter workspace name...',
179:       permissions: 'Permissions',
180:       defaultMode: 'Default mode',
181:       controlWhatAiCanDo: 'Control what AI can do',
```

---

### 第 199 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
197:     },
198:     permissions: {
199:       label: 'Permissions',
200:       description: 'Explore mode rules',
201:       title: 'Permissions',
```

---

### 第 201 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
199:       label: 'Permissions',
200:       description: 'Explore mode rules',
201:       title: 'Permissions',
202:       aboutPermissions: 'About Permissions',
203:       permissionsControlAutonomy: 'Permissions control how much autonomy your agent has. In',
```

---

### 第 222 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
220:     },
221:     labels: {
222:       label: 'Labels',
223:       description: 'Manage session labels',
224:       title: 'Labels',
```

---

### 第 224 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
222:       label: 'Labels',
223:       description: 'Manage session labels',
224:       title: 'Labels',
225:       editFile: 'Edit File',
226:       aboutLabels: 'About Labels',
```

---

### 第 270 行: "Shortcuts"

- 建议键名: `shortcuts`
- 英文原文: `Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
268:     },
269:     shortcuts: {
270:       label: 'Shortcuts',
271:       description: 'Keyboard shortcuts',
272:       title: 'Shortcuts',
```

---

### 第 272 行: "Shortcuts"

- 建议键名: `shortcuts`
- 英文原文: `Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
270:       label: 'Shortcuts',
271:       description: 'Keyboard shortcuts',
272:       title: 'Shortcuts',
273:       section: {
274:         'List Navigation': 'List Navigation',
```

---

### 第 291 行: "Preferences"

- 建议键名: `preferences`
- 英文原文: `Preferences`
- 中文翻译: [待填写]

**上下文:**

```
289:     },
290:     preferences: {
291:       label: 'Preferences',
292:       description: 'User preferences',
293:       title: 'Preferences',
```

---

### 第 293 行: "Preferences"

- 建议键名: `preferences`
- 英文原文: `Preferences`
- 中文翻译: [待填写]

**上下文:**

```
291:       label: 'Preferences',
292:       description: 'User preferences',
293:       title: 'Preferences',
294:       basicInfo: 'Basic Info',
295:       basicInfoDescription: 'Help Craft Agent personalize responses to you.',
```

---

### 第 338 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
336:     cancel: 'Cancel',
337:     delete: 'Delete',
338:     edit: 'Edit',
339:     add: 'Add',
340:     close: 'Close',
```

---

### 第 347 行: "New Window"

- 建议键名: `newWindow`
- 英文原文: `New Window`
- 中文翻译: [待填写]

**上下文:**

```
345:     yes: 'Yes',
346:     no: 'No',
347:     newWindow: 'New Window',
348:     settings: 'Settings',
349:     help: 'Help',
```

---

### 第 348 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
346:     no: 'No',
347:     newWindow: 'New Window',
348:     settings: 'Settings',
349:     help: 'Help',
350:     helpDocumentation: 'Help & Documentation',
```

---

### 第 349 行: "Help"

- 建议键名: `help`
- 英文原文: `Help`
- 中文翻译: [待填写]

**上下文:**

```
347:     newWindow: 'New Window',
348:     settings: 'Settings',
349:     help: 'Help',
350:     helpDocumentation: 'Help & Documentation',
351:     automations: 'Automations',
```

---

### 第 350 行: "Help & Documentation"

- 建议键名: `helpDocumentation`
- 英文原文: `Help & Documentation`
- 中文翻译: [待填写]

**上下文:**

```
348:     settings: 'Settings',
349:     help: 'Help',
350:     helpDocumentation: 'Help & Documentation',
351:     automations: 'Automations',
352:     debug: 'Debug',
```

---

### 第 351 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
349:     help: 'Help',
350:     helpDocumentation: 'Help & Documentation',
351:     automations: 'Automations',
352:     debug: 'Debug',
353:     checkForUpdates: 'Check for Updates',
```

---

### 第 352 行: "Debug"

- 建议键名: `debug`
- 英文原文: `Debug`
- 中文翻译: [待填写]

**上下文:**

```
350:     helpDocumentation: 'Help & Documentation',
351:     automations: 'Automations',
352:     debug: 'Debug',
353:     checkForUpdates: 'Check for Updates',
354:     installUpdate: 'Install Update',
```

---

### 第 353 行: "Check for Updates"

- 建议键名: `checkForUpdates`
- 英文原文: `Check for Updates`
- 中文翻译: [待填写]

**上下文:**

```
351:     automations: 'Automations',
352:     debug: 'Debug',
353:     checkForUpdates: 'Check for Updates',
354:     installUpdate: 'Install Update',
355:     toggleDevTools: 'Toggle DevTools',
```

---

### 第 354 行: "Install Update"

- 建议键名: `installUpdate`
- 英文原文: `Install Update`
- 中文翻译: [待填写]

**上下文:**

```
352:     debug: 'Debug',
353:     checkForUpdates: 'Check for Updates',
354:     installUpdate: 'Install Update',
355:     toggleDevTools: 'Toggle DevTools',
356:     quit: 'Quit Craft Agents',
```

---

### 第 355 行: "Toggle DevTools"

- 建议键名: `toggleDevtools`
- 英文原文: `Toggle DevTools`
- 中文翻译: [待填写]

**上下文:**

```
353:     checkForUpdates: 'Check for Updates',
354:     installUpdate: 'Install Update',
355:     toggleDevTools: 'Toggle DevTools',
356:     quit: 'Quit Craft Agents',
357:     markAllRead: 'Mark All Read',
```

---

### 第 356 行: "Quit Craft Agents"

- 建议键名: `quitCraftAgents`
- 英文原文: `Quit Craft Agents`
- 中文翻译: [待填写]

**上下文:**

```
354:     installUpdate: 'Install Update',
355:     toggleDevTools: 'Toggle DevTools',
356:     quit: 'Quit Craft Agents',
357:     markAllRead: 'Mark All Read',
358:     configureStatuses: 'Configure Statuses',
```

---

### 第 428 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
426:     status: 'Status',
427:     active: 'Active',
428:     labels: 'Labels',
429:     recentActivity: 'Recent Activity',
430:     lastXruns: 'Last {count} runs',
```

---

### 第 569 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
567:   // Menu
568:   menu: {
569:     edit: 'Edit',
570:     view: 'View',
571:     window: 'Window',
```

---

### 第 570 行: "View"

- 建议键名: `view`
- 英文原文: `View`
- 中文翻译: [待填写]

**上下文:**

```
568:   menu: {
569:     edit: 'Edit',
570:     view: 'View',
571:     window: 'Window',
572:     undo: 'Undo',
```

---

### 第 571 行: "Window"

- 建议键名: `window`
- 英文原文: `Window`
- 中文翻译: [待填写]

**上下文:**

```
569:     edit: 'Edit',
570:     view: 'View',
571:     window: 'Window',
572:     undo: 'Undo',
573:     redo: 'Redo',
```

---

### 第 572 行: "Undo"

- 建议键名: `undo`
- 英文原文: `Undo`
- 中文翻译: [待填写]

**上下文:**

```
570:     view: 'View',
571:     window: 'Window',
572:     undo: 'Undo',
573:     redo: 'Redo',
574:     cut: 'Cut',
```

---

### 第 573 行: "Redo"

- 建议键名: `redo`
- 英文原文: `Redo`
- 中文翻译: [待填写]

**上下文:**

```
571:     window: 'Window',
572:     undo: 'Undo',
573:     redo: 'Redo',
574:     cut: 'Cut',
575:     copy: 'Copy',
```

---

### 第 574 行: "Cut"

- 建议键名: `cut`
- 英文原文: `Cut`
- 中文翻译: [待填写]

**上下文:**

```
572:     undo: 'Undo',
573:     redo: 'Redo',
574:     cut: 'Cut',
575:     copy: 'Copy',
576:     paste: 'Paste',
```

---

### 第 575 行: "Copy"

- 建议键名: `copy`
- 英文原文: `Copy`
- 中文翻译: [待填写]

**上下文:**

```
573:     redo: 'Redo',
574:     cut: 'Cut',
575:     copy: 'Copy',
576:     paste: 'Paste',
577:     selectAll: 'Select All',
```

---

### 第 576 行: "Paste"

- 建议键名: `paste`
- 英文原文: `Paste`
- 中文翻译: [待填写]

**上下文:**

```
574:     cut: 'Cut',
575:     copy: 'Copy',
576:     paste: 'Paste',
577:     selectAll: 'Select All',
578:     zoomIn: 'Zoom In',
```

---

### 第 577 行: "Select All"

- 建议键名: `selectAll`
- 英文原文: `Select All`
- 中文翻译: [待填写]

**上下文:**

```
575:     copy: 'Copy',
576:     paste: 'Paste',
577:     selectAll: 'Select All',
578:     zoomIn: 'Zoom In',
579:     zoomOut: 'Zoom Out',
```

---

### 第 578 行: "Zoom In"

- 建议键名: `zoomIn`
- 英文原文: `Zoom In`
- 中文翻译: [待填写]

**上下文:**

```
576:     paste: 'Paste',
577:     selectAll: 'Select All',
578:     zoomIn: 'Zoom In',
579:     zoomOut: 'Zoom Out',
580:     resetZoom: 'Reset Zoom',
```

---

### 第 579 行: "Zoom Out"

- 建议键名: `zoomOut`
- 英文原文: `Zoom Out`
- 中文翻译: [待填写]

**上下文:**

```
577:     selectAll: 'Select All',
578:     zoomIn: 'Zoom In',
579:     zoomOut: 'Zoom Out',
580:     resetZoom: 'Reset Zoom',
581:     toggleFocusMode: 'Toggle Focus Mode',
```

---

### 第 580 行: "Reset Zoom"

- 建议键名: `resetZoom`
- 英文原文: `Reset Zoom`
- 中文翻译: [待填写]

**上下文:**

```
578:     zoomIn: 'Zoom In',
579:     zoomOut: 'Zoom Out',
580:     resetZoom: 'Reset Zoom',
581:     toggleFocusMode: 'Toggle Focus Mode',
582:     toggleSidebar: 'Toggle Sidebar',
```

---

### 第 581 行: "Toggle Focus Mode"

- 建议键名: `toggleFocusMode`
- 英文原文: `Toggle Focus Mode`
- 中文翻译: [待填写]

**上下文:**

```
579:     zoomOut: 'Zoom Out',
580:     resetZoom: 'Reset Zoom',
581:     toggleFocusMode: 'Toggle Focus Mode',
582:     toggleSidebar: 'Toggle Sidebar',
583:     minimize: 'Minimize',
```

---

### 第 582 行: "Toggle Sidebar"

- 建议键名: `toggleSidebar`
- 英文原文: `Toggle Sidebar`
- 中文翻译: [待填写]

**上下文:**

```
580:     resetZoom: 'Reset Zoom',
581:     toggleFocusMode: 'Toggle Focus Mode',
582:     toggleSidebar: 'Toggle Sidebar',
583:     minimize: 'Minimize',
584:     maximize: 'Maximize'
```

---

### 第 583 行: "Minimize"

- 建议键名: `minimize`
- 英文原文: `Minimize`
- 中文翻译: [待填写]

**上下文:**

```
581:     toggleFocusMode: 'Toggle Focus Mode',
582:     toggleSidebar: 'Toggle Sidebar',
583:     minimize: 'Minimize',
584:     maximize: 'Maximize'
585:   },
```

---

### 第 584 行: "Maximize"

- 建议键名: `maximize`
- 英文原文: `Maximize`
- 中文翻译: [待填写]

**上下文:**

```
582:     toggleSidebar: 'Toggle Sidebar',
583:     minimize: 'Minimize',
584:     maximize: 'Maximize'
585:   },
586:   
```

---

### 第 592 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
590:     thinking: 'Thinking...',
591:     typing: 'Typing...',
592:     newChat: 'New Chat',
593:     saveChat: 'Save Chat',
594:     deleteChat: 'Delete Chat',
```

---

### 第 668 行: "New Chat"

- 建议键名: `newChat`
- 英文原文: `New Chat`
- 中文翻译: [待填写]

**上下文:**

```
666:   // Actions
667:   actions: {
668:     newChat: 'New Chat',
669:     createANewChatSession: 'Create a new chat session',
670:     newChatInPanel: 'New Chat in Panel',
```

---

### 第 693 行: "View"

- 建议键名: `view`
- 英文原文: `View`
- 中文翻译: [待填写]

**上下文:**

```
691:     navigateToPreviousSessionArrowKey: 'Navigate to previous session (arrow key)',
692:     navigateToNextSessionArrowKey: 'Navigate to next session (arrow key)',
693:     view: 'View',
694:     hideBothSidebarsForDistractionFreeWork: 'Hide both sidebars for distraction-free work',
695:     navigator: 'Navigator',
```

---

### 第 713 行: "Keyboard Shortcuts"

- 建议键名: `keyboardShortcuts`
- 英文原文: `Keyboard Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
711:   // Shortcuts
712:   shortcuts: {
713:     keyboardShortcuts: 'Keyboard Shortcuts',
714:     editShortcuts: 'Edit Shortcuts',
715:     resetShortcuts: 'Reset Shortcuts',
```

---

### 第 773 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
771:     flagged: 'Flagged',
772:     archived: 'Archived',
773:     labels: 'Labels',
774:     views: 'Views',
775:     sources: 'Sources',
```

---

### 第 775 行: "Sources"

- 建议键名: `sources`
- 英文原文: `Sources`
- 中文翻译: [待填写]

**上下文:**

```
773:     labels: 'Labels',
774:     views: 'Views',
775:     sources: 'Sources',
776:     apis: 'APIs',
777:     mcps: 'MCPs',
```

---

### 第 779 行: "Skills"

- 建议键名: `skills`
- 英文原文: `Skills`
- 中文翻译: [待填写]

**上下文:**

```
777:     mcps: 'MCPs',
778:     localFolders: 'Local Folders',
779:     skills: 'Skills',
780:     allSkills: 'All Skills',
781:     automations: 'Automations',
```

---

### 第 781 行: "Automations"

- 建议键名: `automations`
- 英文原文: `Automations`
- 中文翻译: [待填写]

**上下文:**

```
779:     skills: 'Skills',
780:     allSkills: 'All Skills',
781:     automations: 'Automations',
782:     allAutomations: 'All Automations',
783:     scheduled: 'Scheduled',
```

---

### 第 786 行: "Settings"

- 建议键名: `settings`
- 英文原文: `Settings`
- 中文翻译: [待填写]

**上下文:**

```
784:     eventBased: 'Event-based',
785:     agentic: 'Agentic',
786:     settings: 'Settings',
787:     whatsNew: 'What\'s New'
788:   },
```

---

### 第 801 行: "Content"

- 建议键名: `content`
- 英文原文: `Content`
- 中文翻译: [待填写]

**上下文:**

```
799:   // Label Categories
800:   labelCategories: {
801:     content: 'Content',
802:     design: 'Design',
803:     research: 'Research',
```

---

### 第 802 行: "Design"

- 建议键名: `design`
- 英文原文: `Design`
- 中文翻译: [待填写]

**上下文:**

```
800:   labelCategories: {
801:     content: 'Content',
802:     design: 'Design',
803:     research: 'Research',
804:     writing: 'Writing',
```

---

### 第 803 行: "Research"

- 建议键名: `research`
- 英文原文: `Research`
- 中文翻译: [待填写]

**上下文:**

```
801:     content: 'Content',
802:     design: 'Design',
803:     research: 'Research',
804:     writing: 'Writing',
805:     development: 'Development',
```

---

### 第 804 行: "Writing"

- 建议键名: `writing`
- 英文原文: `Writing`
- 中文翻译: [待填写]

**上下文:**

```
802:     design: 'Design',
803:     research: 'Research',
804:     writing: 'Writing',
805:     development: 'Development',
806:     automation: 'Automation',
```

---

### 第 805 行: "Development"

- 建议键名: `development`
- 英文原文: `Development`
- 中文翻译: [待填写]

**上下文:**

```
803:     research: 'Research',
804:     writing: 'Writing',
805:     development: 'Development',
806:     automation: 'Automation',
807:     bug: 'Bug',
```

---

### 第 806 行: "Automation"

- 建议键名: `automation`
- 英文原文: `Automation`
- 中文翻译: [待填写]

**上下文:**

```
804:     writing: 'Writing',
805:     development: 'Development',
806:     automation: 'Automation',
807:     bug: 'Bug',
808:     code: 'Code',
```

---

### 第 807 行: "Bug"

- 建议键名: `bug`
- 英文原文: `Bug`
- 中文翻译: [待填写]

**上下文:**

```
805:     development: 'Development',
806:     automation: 'Automation',
807:     bug: 'Bug',
808:     code: 'Code',
809:     priority: 'Priority',
```

---

### 第 809 行: "Priority"

- 建议键名: `priority`
- 英文原文: `Priority`
- 中文翻译: [待填写]

**上下文:**

```
807:     bug: 'Bug',
808:     code: 'Code',
809:     priority: 'Priority',
810:     project: 'Project'
811:   },
```

---

### 第 810 行: "Project"

- 建议键名: `project`
- 英文原文: `Project`
- 中文翻译: [待填写]

**上下文:**

```
808:     code: 'Code',
809:     priority: 'Priority',
810:     project: 'Project'
811:   },
812: 
```

---

### 第 818 行: "Statuses"

- 建议键名: `statuses`
- 英文原文: `Statuses`
- 中文翻译: [待填写]

**上下文:**

```
816:     filterChats: 'Filter Chats',
817:     searchStatusesAndLabels: 'Search statuses & labels...',
818:     statuses: 'Statuses',
819:     group: 'Group',
820:     search: 'Search',
```

---

## apps\electron\src\renderer\i18n\locales\zh-CN.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\i18n\locales\zh-CN.ts`

待翻译数量: 3

### 第 38 行: "AI"

- 建议键名: `ai`
- 英文原文: `AI`
- 中文翻译: [待填写]

**上下文:**

```
36:     },
37:     ai: {
38:       label: 'AI',
39:       description: '模型、思考、连接',
40:       title: 'AI',
```

---

### 第 40 行: "AI"

- 建议键名: `ai`
- 英文原文: `AI`
- 中文翻译: [待填写]

**上下文:**

```
38:       label: 'AI',
39:       description: '模型、思考、连接',
40:       title: 'AI',
41:       credential: {
42:         fileCorrupted: '凭证文件已损坏。请重新验证身份。',
```

---

### 第 807 行: "Bug"

- 建议键名: `bug`
- 英文原文: `Bug`
- 中文翻译: [待填写]

**上下文:**

```
805:     development: '开发',
806:     automation: '自动化',
807:     bug: 'Bug',
808:     code: '代码',
809:     priority: '优先级',
```

---

## apps\electron\src\renderer\lib\navigation-registry.ts

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\lib\navigation-registry.ts`

待翻译数量: 2

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

## apps\electron\src\renderer\pages\PreferencesPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\PreferencesPage.tsx`

待翻译数量: 1

### 第 225 行: "Preferences"

- 建议键名: `preferences`
- 英文原文: `Preferences`
- 中文翻译: [待填写]

**上下文:**

```
223:   return (
224:     <div className="h-full flex flex-col">
225:       <PanelHeader title="Preferences" actions={headerActions} />
226:       <Separator />
227:       <ScrollArea className="flex-1">
```

---

## apps\electron\src\renderer\pages\settings\AiSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\AiSettingsPage.tsx`

待翻译数量: 2

### 第 304 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
302:             <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onEdit)}>
303:               <Settings2 className="h-3.5 w-3.5" />
304:               <span>{t('settings.ai.connection.edit', 'Edit')}</span>
305:             </StyledDropdownMenuItem>
306:           )}
```

---

### 第 894 行: "AI"

- 建议键名: `ai`
- 英文原文: `AI`
- 中文翻译: [待填写]

**上下文:**

```
892:   return (
893:     <div className="h-full flex flex-col">
894:       <PanelHeader title={t('settings.ai.title', 'AI')} actions={<HeaderMenu route={routes.view.settings('ai')} />} />
895:       <div className="flex-1 min-h-0 mask-fade-y">
896:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\AppearanceSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\AppearanceSettingsPage.tsx`

待翻译数量: 1

### 第 244 行: "Appearance"

- 建议键名: `appearance`
- 英文原文: `Appearance`
- 中文翻译: [待填写]

**上下文:**

```
242:     <div className="h-full flex flex-col">
243:       <PanelHeader
244:         title={t('settings.appearance.title', 'Appearance')}
245:         actions={<HeaderMenu route={routes.view.settings('appearance')} helpFeature="themes" />}
246:       />
```

---

## apps\electron\src\renderer\pages\settings\AppSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\AppSettingsPage.tsx`

待翻译数量: 1

### 第 203 行: "App"

- 建议键名: `app`
- 英文原文: `App`
- 中文翻译: [待填写]

**上下文:**

```
201:   return (
202:     <div className="h-full flex flex-col">
203:       <PanelHeader title={t('settings.app.title', 'App')} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
204:       <div className="flex-1 min-h-0 mask-fade-y">
205:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\InputSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\InputSettingsPage.tsx`

待翻译数量: 1

### 第 87 行: "Input"

- 建议键名: `input`
- 英文原文: `Input`
- 中文翻译: [待填写]

**上下文:**

```
85:   return (
86:     <div className="h-full flex flex-col">
87:       <PanelHeader title={t('settings.input.title', 'Input')} actions={<HeaderMenu route={routes.view.settings('input')} />} />
88:       <div className="flex-1 min-h-0 mask-fade-y">
89:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\LabelsSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\LabelsSettingsPage.tsx`

待翻译数量: 1

### 第 59 行: "Labels"

- 建议键名: `labels`
- 英文原文: `Labels`
- 中文翻译: [待填写]

**上下文:**

```
57:   return (
58:     <div className="h-full flex flex-col">
59:       <PanelHeader title={t('settings.labels.title', 'Labels')} actions={<HeaderMenu route={routes.view.settings('labels')} />} />
60:       <div className="flex-1 min-h-0 mask-fade-y">
61:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\PermissionsSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\PermissionsSettingsPage.tsx`

待翻译数量: 1

### 第 198 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
196:   return (
197:     <div className="h-full flex flex-col">
198:       <PanelHeader title={t('settings.permissions.title', 'Permissions')} actions={<HeaderMenu route={routes.view.settings('permissions')} helpFeature="permissions" />} />
199:       <div className="flex-1 min-h-0 mask-fade-y">
200:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\PreferencesPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\PreferencesPage.tsx`

待翻译数量: 1

### 第 205 行: "Preferences"

- 建议键名: `preferences`
- 英文原文: `Preferences`
- 中文翻译: [待填写]

**上下文:**

```
203:   return (
204:     <div className="h-full flex flex-col">
205:       <PanelHeader title={t('settings.preferences.title', 'Preferences')} actions={<HeaderMenu route={routes.view.settings('preferences')} helpFeature="preferences" />} />
206:       <div className="flex-1 min-h-0 mask-fade-y">
207:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\ShortcutsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\ShortcutsPage.tsx`

待翻译数量: 1

### 第 98 行: "Shortcuts"

- 建议键名: `shortcuts`
- 英文原文: `Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
96:   return (
97:     <div className="h-full flex flex-col">
98:       <PanelHeader title={t('settings.shortcuts.title', 'Shortcuts')} />
99:       <div className="flex-1 min-h-0 mask-fade-y">
100:         <ScrollArea className="h-full">
```

---

## apps\electron\src\renderer\pages\settings\WorkspaceSettingsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\settings\WorkspaceSettingsPage.tsx`

待翻译数量: 2

### 第 373 行: "Edit"

- 建议键名: `edit`
- 英文原文: `Edit`
- 中文翻译: [待填写]

**上下文:**

```
371:                       className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
372:                     >
373:                       {t('settings.workspace.edit', 'Edit')}
374:                     </button>
375:                   }
```

---

### 第 433 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
431: 
432:             {/* Permissions */}
433:             <SettingsSection title={t('settings.workspace.permissions', 'Permissions')}>
434:               <SettingsCard>
435:                 <SettingsMenuSelectRow
```

---

## apps\electron\src\renderer\pages\ShortcutsPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\ShortcutsPage.tsx`

待翻译数量: 1

### 第 100 行: "Shortcuts"

- 建议键名: `shortcuts`
- 英文原文: `Shortcuts`
- 中文翻译: [待填写]

**上下文:**

```
98:   return (
99:     <div className="h-full flex flex-col">
100:       <PanelHeader title="Shortcuts" actions={<HeaderMenu route={routes.view.settings('shortcuts')} />} />
101:       <Separator />
102:       <ScrollArea className="flex-1">
```

---

## apps\electron\src\renderer\pages\SkillInfoPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\SkillInfoPage.tsx`

待翻译数量: 1

### 第 192 行: "Workspace"

- 建议键名: `workspace`
- 英文原文: `Workspace`
- 中文翻译: [待填写]

**上下文:**

```
190:                 {skill.source === 'project' ? 'Project (.agents/skills/)' :
191:                  skill.source === 'global' ? 'Global (~/.agents/skills/)' :
192:                  'Workspace'}
193:               </Info_Table.Row>
194:               <Info_Table.Row label="Location">
```

---

## apps\electron\src\renderer\pages\SourceInfoPage.tsx

文件路径: `D:\Projects\CraftAgents\apps\electron\src\renderer\pages\SourceInfoPage.tsx`

待翻译数量: 4

### 第 441 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
439:           {source.config.type !== 'mcp' && permissionsConfig && apiPermissionsData.length > 0 && (
440:             <Info_Section
441:               title="Permissions"
442:               description={getPermissionsDescription(source)}
443:               actions={
```

---

### 第 455 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
453:               }
454:             >
455:               <PermissionsDataTable data={apiPermissionsData} fullscreen fullscreenTitle="Permissions" />
456:             </Info_Section>
457:           )}
```

---

### 第 487 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
485:           {source.config.type === 'mcp' && permissionsConfig && mcpPermissionsData.length > 0 && (
486:             <Info_Section
487:               title="Permissions"
488:               description={getPermissionsDescription(source)}
489:               actions={
```

---

### 第 501 行: "Permissions"

- 建议键名: `permissions`
- 英文原文: `Permissions`
- 中文翻译: [待填写]

**上下文:**

```
499:               }
500:             >
501:               <PermissionsDataTable data={mcpPermissionsData} hideTypeColumn fullscreen fullscreenTitle="Permissions" />
502:             </Info_Section>
503:           )}
```

---

