# Channel Boundary Matrix

Every `ElectronAPI` method classified into one of three buckets.

## Bucket A — Core Runtime (symmetric, WS)

Runs identically on local Electron and headless remote. No Electron imports.

### Sessions (`sessions.ts` handler)
| Channel | Method | Notes |
|---------|--------|-------|
| `sessions:get` | `getSessions` | |
| `sessions:getUnreadSummary` | `getUnreadSummary` | |
| `sessions:markAllRead` | `markAllSessionsRead` | |
| `sessions:getMessages` | `getSessionMessages` | |
| `sessions:create` | `createSession` | |
| `sessions:delete` | `deleteSession` | |
| `sessions:sendMessage` | `sendMessage` | Currently uses `sendToWindow()` for error/complete — change to `ctx.clientId` push |
| `sessions:cancel` | `cancelProcessing` | |
| `sessions:killShell` | `killShell` | |
| `tasks:getOutput` | `getTaskOutput` | |
| `sessions:respondToPermission` | `respondToPermission` | |
| `sessions:respondToCredential` | `respondToCredential` | |
| `sessions:command` | `sessionCommand` | Contains `shell.showItemInFolder()` — extract to `platform.showItemInFolder?.()` |
| `sessions:getPendingPlanExecution` | `getPendingPlanExecution` | |
| `sessions:getPermissionModeState` | `getSessionPermissionModeState` | |
| `sessions:searchContent` | `searchSessionContent` | |
| `sessions:getFiles` | `getSessionFiles` | |
| `sessions:getNotes` | `getSessionNotes` | |
| `sessions:setNotes` | `setSessionNotes` | |
| `sessions:watchFiles` | `watchSessionFiles` | |
| `sessions:unwatchFiles` | `unwatchSessionFiles` | |
| `session:getModel` | `getSessionModel` | |
| `session:setModel` | `setSessionModel` | |

**Push events:**
| Channel | Current source | New target |
|---------|---------------|-----------|
| `session:event` | SessionManager `sendEvent()` | `{ to: 'workspace', workspaceId }` |
| `sessions:unreadSummaryChanged` | SessionManager | `{ to: 'workspace', workspaceId }` |
| `sessions:filesChanged` | File watcher in handler | `{ to: 'all' }` |

### Labels (`labels.ts`)
| Channel | Method | Notes |
|---------|--------|-------|
| `labels:list` | `listLabels` | |
| `labels:create` | `createLabel` | |
| `labels:delete` | `deleteLabel` | |

**Push:** `labels:changed` → `{ to: 'all' }`

### Statuses (`statuses.ts`)
| Channel | Method | Notes |
|---------|--------|-------|
| `statuses:list` | `listStatuses` | |
| `statuses:reorder` | `reorderStatuses` | |

**Push:** `statuses:changed` → `{ to: 'all' }` (via ConfigWatcher)

### Sources (`sources.ts`)
| Channel | Method | Notes |
|---------|--------|-------|
| `sources:get` | `getSources` | |
| `sources:create` | `createSource` | |
| `sources:delete` | `deleteSource` | |
| `sources:startOAuth` | `startSourceOAuth` | OAuth browser flow — needs platform.openExternal on headless? Or Shell only. See note below. |
| `sources:saveCredentials` | `saveSourceCredentials` | |
| `sources:getPermissions` | `getSourcePermissionsConfig` | |
| `sources:getMcpTools` | `getMcpTools` | |
| `workspace:getPermissions` | `getWorkspacePermissionsConfig` | |
| `permissions:getDefaults` | `getDefaultPermissionsConfig` | |

**Push:** `sources:changed` → `{ to: 'all' }` (via ConfigWatcher)
**Push:** `permissions:defaultsChanged` → `{ to: 'all' }` (via ConfigWatcher)

> **Note on `sources:startOAuth`:** OAuth flows use `shell.openExternal()` internally in SessionManager. On headless, the URL should be returned to the client for opening. Move to `platform.openExternal?.()`.

### Skills (`skills.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `skills:get` | `getSkills` | |
| `skills:getFiles` | `getSkillFiles` | |
| `skills:delete` | `deleteSkill` | |

**Push:** `skills:changed` → `{ to: 'all' }` (via ConfigWatcher)

### Automations (`automations.ts`)
| Channel | Method | Notes |
|---------|--------|-------|
| `automations:test` | `testAutomation` | |
| `automations:setEnabled` | `setAutomationEnabled` | |
| `automations:duplicate` | `duplicateAutomation` | |
| `automations:delete` | `deleteAutomation` | |
| `automations:getHistory` | `getAutomationHistory` | |
| `automations:getLastExecuted` | `getAutomationLastExecuted` | |

**Push:** `automations:changed` → `{ to: 'all' }` (via ConfigWatcher)

### LLM Connections (`llm-connections.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `LLM_Connection:list` | `listLlmConnections` | |
| `LLM_Connection:listWithStatus` | `listLlmConnectionsWithStatus` | |
| `LLM_Connection:get` | `getLlmConnection` | |
| `LLM_Connection:getApiKey` | `getLlmConnectionApiKey` | |
| `LLM_Connection:save` | `saveLlmConnection` | |
| `LLM_Connection:delete` | `deleteLlmConnection` | |
| `LLM_Connection:test` | `testLlmConnection` | |
| `LLM_Connection:setDefault` | `setDefaultLlmConnection` | |
| `LLM_Connection:setWorkspaceDefault` | `setWorkspaceDefaultLlmConnection` | |
| `LLM_Connection:refreshModels` | (internal) | Not on ElectronAPI — internal refresh |
| `settings:setupLlmConnection` | `setupLlmConnection` | |
| `settings:testLlmConnectionSetup` | `testLlmConnectionSetup` | |
| `pi:getApiKeyProviders` | `getPiApiKeyProviders` | |
| `pi:getProviderBaseUrl` | `getPiProviderBaseUrl` | |
| `pi:getProviderModels` | `getPiProviderModels` | |

**Push:** `LLM_Connection:changed` → `{ to: 'all' }`

### Onboarding (`onboarding.ts`)
| Channel | Method | Notes |
|---------|--------|-------|
| `onboarding:getAuthState` | `getAuthState` / `getSetupNeeds` | Single handler, renderer splits result |
| `onboarding:startMcpOAuth` | `startWorkspaceMcpOAuth` | |
| `onboarding:startClaudeOAuth` | `startClaudeOAuth` | |
| `onboarding:exchangeClaudeCode` | `exchangeClaudeCode` | |
| `onboarding:hasClaudeOAuthState` | `hasClaudeOAuthState` | |
| `onboarding:clearClaudeOAuthState` | `clearClaudeOAuthState` | |

### Settings — Domain Config (`settings.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `workspaceSettings:get` | `getWorkspaceSettings` | |
| `workspaceSettings:update` | `updateWorkspaceSetting` | |
| `preferences:read` | `readPreferences` | |
| `preferences:write` | `writePreferences` | |
| `drafts:get` | `getDraft` | |
| `drafts:set` | `setDraft` | |
| `drafts:delete` | `deleteDraft` | |
| `drafts:getAll` | `getAllDrafts` | |
| `input:getAutoCapitalisation` | `getAutoCapitalisation` | |
| `input:setAutoCapitalisation` | `setAutoCapitalisation` | |
| `input:getSendMessageKey` | `getSendMessageKey` | |
| `input:setSendMessageKey` | `setSendMessageKey` | |
| `input:getSpellCheck` | `getSpellCheck` | |
| `input:setSpellCheck` | `setSpellCheck` | |
| `power:getKeepAwake` | `getKeepAwakeWhileRunning` | |
| `power:setKeepAwake` | `setKeepAwakeWhileRunning` | |
| `appearance:getRichToolDescriptions` | `getRichToolDescriptions` | |
| `appearance:setRichToolDescriptions` | `setRichToolDescriptions` | |

### Workspace — Config (`workspace.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `workspaces:get` | `getWorkspaces` | |
| `workspaces:create` | `createWorkspace` | |
| `workspaces:checkSlug` | `checkWorkspaceSlug` | |
| `views:list` | `listViews` | |
| `views:save` | `saveViews` | |
| `toolIcons:getMappings` | `getToolIconMappings` | |
| `logo:getUrl` | `getLogoUrl` | |

### Files — I/O (`files.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `file:read` | `readFile` | Pure fs |
| `file:readDataUrl` | `readFileDataUrl` | Pure fs + mime |
| `file:readBinary` | `readFileBinary` | Pure fs |
| `file:readAttachment` | `readFileAttachment` | Pure fs |
| `file:storeAttachment` | `storeAttachment` | Needs `platform.resizeImage?.()` for thumbnail |
| `fs:search` | `searchFiles` | Pure fs traversal |

### Auth — Core (`auth.ts` — partial)
| Channel | Method | Notes |
|---------|--------|-------|
| `auth:logout` | `logout` | Clears credentials, restarts — partially Shell |
| `credentials:healthCheck` | `getCredentialHealth` | Pure credential validation |

### Git
| Channel | Method | Notes |
|---------|--------|-------|
| `git:getBranch` | `getGitBranch` | Pure `execSync('git')` — works headless |

---

## Bucket B — Desktop Shell (local-only WS channels)

Requires Electron APIs. Only registered in Electron entry point.

### Window Management (`workspace.ts` — partial)
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `window:getWorkspace` | `getWindowWorkspace` | `BrowserWindow.fromWebContents()` |
| `window:getMode` | `getWindowMode` | WindowManager |
| `window:openWorkspace` | `openWorkspace` | WindowManager |
| `window:openSessionInNewWindow` | `openSessionInNewWindow` | WindowManager |
| `window:switchWorkspace` | `switchWorkspace` | WindowManager |
| `window:close` | `closeWindow` | `BrowserWindow.fromWebContents()` |
| `window:confirmClose` | `confirmCloseWindow` | `BrowserWindow.fromWebContents()` |
| `window:cancelClose` | `cancelCloseWindow` | `BrowserWindow.fromWebContents()` |
| `window:setTrafficLights` | `setTrafficLightsVisible` | `BrowserWindow.fromWebContents()` |
| `window:getFocusState` | `getWindowFocusState` | `BrowserWindow.getFocusedWindow()` |

**Push events:**
| Channel | Electron dep |
|---------|-------------|
| `window:closeRequested` | WindowManager → client |
| `window:focusState` | Window focus listener |

### Native Dialogs
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `file:openDialog` | `openFileDialog` | `dialog.showOpenDialog()` |
| `dialog:openFolder` | `openFolderDialog` | `dialog.showOpenDialog()` |
| `auth:showLogoutConfirmation` | `showLogoutConfirmation` | `dialog.showMessageBox()` |
| `auth:showDeleteSessionConfirmation` | `showDeleteSessionConfirmation` | `dialog.showMessageBox()` |

### Shell Operations
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `shell:openUrl` | `openUrl` | `shell.openExternal()` |
| `shell:openFile` | `openFile` | `shell.openPath()` |
| `shell:showInFolder` | `showInFolder` | `shell.showItemInFolder()` |
| `skills:openEditor` | `openSkillInEditor` | `shell.openPath()` |
| `skills:openFinder` | `openSkillInFinder` | `shell.showItemInFolder()` |

### System / OS
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `theme:getSystemPreference` | `getSystemTheme` | `nativeTheme.shouldUseDarkColors` |
| `system:homeDir` | `getHomeDir` | `os.homedir()` (works in Node too, but grouped with system) |
| `system:isDebugMode` | `isDebugMode` | `app.isPackaged` |

**Push:** `theme:systemChanged` → `{ to: 'all' }` (nativeTheme listener)

### Auto-Update
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `update:check` | `checkForUpdates` | `electron-updater` |
| `update:getInfo` | `getUpdateInfo` | `electron-updater` |
| `update:install` | `installUpdate` | `electron-updater` |
| `update:dismiss` | `dismissUpdate` | |
| `update:getDismissed` | `getDismissedUpdateVersion` | |
| `releaseNotes:get` | `getReleaseNotes` | |
| `releaseNotes:getLatestVersion` | `getLatestReleaseVersion` | |

**Push:** `update:available`, `update:downloadProgress` → `{ to: 'all' }`

### Badge / Dock
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `badge:refresh` | `refreshBadge` | `app.dock.setIcon()`, `app.setBadgeCount()` |
| `badge:setIcon` | `setDockIconWithBadge` | `app.dock.setIcon()` |

**Push:** `badge:draw`, `badge:draw-windows` → `{ to: 'all' }`

### Menu Actions
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `menu:quit` | `menuQuit` | `app.quit()` |
| `menu:newWindow` | `menuNewWindow` | WindowManager |
| `menu:minimize` | `menuMinimize` | `BrowserWindow.getFocusedWindow()` |
| `menu:maximize` | `menuMaximize` | `BrowserWindow.getFocusedWindow()` |
| `menu:zoomIn` | `menuZoomIn` | `webContents.zoomLevel` |
| `menu:zoomOut` | `menuZoomOut` | `webContents.zoomLevel` |
| `menu:zoomReset` | `menuZoomReset` | `webContents.zoomLevel` |
| `menu:toggleDevTools` | `menuToggleDevTools` | `webContents.toggleDevTools()` |
| `menu:undo` | `menuUndo` | `webContents.undo()` |
| `menu:redo` | `menuRedo` | `webContents.redo()` |
| `menu:cut` | `menuCut` | `webContents.cut()` |
| `menu:copy` | `menuCopy` | `webContents.copy()` |
| `menu:paste` | `menuPaste` | `webContents.paste()` |
| `menu:selectAll` | `menuSelectAll` | `webContents.selectAll()` |

**Push (main→renderer):**
| Channel | Source |
|---------|--------|
| `menu:newChat` | Menu bar |
| `menu:openSettings` | Menu bar |
| `menu:keyboardShortcuts` | Menu bar |
| `menu:toggleFocusMode` | Menu bar |
| `menu:toggleSidebar` | Menu bar |

### Notifications
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `notification:show` | `showNotification` | `new Notification()` |
| `notification:getEnabled` | `getNotificationsEnabled` | |
| `notification:setEnabled` | `setNotificationsEnabled` | |

**Push:** `notification:navigate` → `{ to: 'all' }` (notification click)

### Theme Sync (cross-window)
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `theme:getApp` | `getAppTheme` | ConfigWatcher |
| `theme:getPresets` | `loadPresetThemes` | fs read |
| `theme:loadPreset` | `loadPresetTheme` | fs read |
| `theme:getColorTheme` | `getColorTheme` | settings store |
| `theme:setColorTheme` | `setColorTheme` | settings store |
| `theme:broadcastPreferences` | `broadcastThemePreferences` | `broadcastToAllExcept()` |
| `theme:getWorkspaceColorTheme` | `getWorkspaceColorTheme` | workspace config |
| `theme:setWorkspaceColorTheme` | `setWorkspaceColorTheme` | workspace config |
| `theme:getAllWorkspaceThemes` | `getAllWorkspaceThemes` | workspace config |
| `theme:broadcastWorkspaceTheme` | `broadcastWorkspaceThemeChange` | `broadcastToAllExcept()` |

**Push:** `theme:appChanged`, `theme:preferencesChanged`, `theme:workspaceThemeChanged` → `{ to: 'all' }`

### Workspace Images
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `workspace:readImage` | `readWorkspaceImage` | `nativeImage.createFromBuffer()` for resize |
| `workspace:writeImage` | `writeWorkspaceImage` | `nativeImage.createFromBuffer()` for resize |

### Image Processing
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `file:generateThumbnail` | `generateThumbnail` | `nativeImage.createThumbnailFromPath()` |

### Browser Panes (`browser.ts`)
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `browser-pane:create` | `browserPane.create` | BrowserPaneManager (BrowserView) |
| `browser-pane:destroy` | `browserPane.destroy` | BrowserPaneManager |
| `browser-pane:list` | `browserPane.list` | BrowserPaneManager |
| `browser-pane:navigate` | `browserPane.navigate` | BrowserPaneManager |
| `browser-pane:go-back` | `browserPane.goBack` | BrowserPaneManager |
| `browser-pane:go-forward` | `browserPane.goForward` | BrowserPaneManager |
| `browser-pane:reload` | `browserPane.reload` | BrowserPaneManager |
| `browser-pane:stop` | `browserPane.stop` | BrowserPaneManager |
| `browser-pane:focus` | `browserPane.focus` | BrowserPaneManager |
| `browser-empty-state:launch` | `browserPane.emptyStateLaunch` | BrowserPaneManager |

**Push:** `browser-pane:state-changed`, `browser-pane:removed`, `browser-pane:interacted` → `{ to: 'all' }`

### OAuth (browser-opening flows)
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `chatgpt:startOAuth` | `startChatGptOAuth` | `shell.openExternal()` |
| `chatgpt:cancelOAuth` | `cancelChatGptOAuth` | |
| `chatgpt:getAuthStatus` | `getChatGptAuthStatus` | |
| `chatgpt:logout` | `chatGptLogout` | |
| `copilot:startOAuth` | `startCopilotOAuth` | `shell.openExternal()` |
| `copilot:cancelOAuth` | `cancelCopilotOAuth` | |
| `copilot:getAuthStatus` | `getCopilotAuthStatus` | |
| `copilot:logout` | `copilotLogout` | |

**Push:** `copilot:deviceCode` → `{ to: 'client', clientId }` (via `event.sender.send()`)

### Git Bash (Windows-only)
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `gitbash:check` | `checkGitBash` | `execSync` + Windows paths |
| `gitbash:browse` | `browseForGitBash` | `dialog.showOpenDialog()` |
| `gitbash:setPath` | `setGitBashPath` | |

### Deep Link
| Channel | Method | Electron dep |
|---------|--------|-------------|
| `deeplink:navigate` | (push only) | Protocol handler registration |

---

## Bucket C — Remove / Merge

| Item | Disposition | Notes |
|------|-------------|-------|
| `debug:log` | Remove fire-and-forget `send()` | Becomes `server.handle('debug:log', ...)` returning void. Or drop entirely — use WS transport logging. |
| `getVersions()` | Rework | Currently synchronous in preload using `process.versions`. Becomes RPC or static config. |
| `onboarding:validateMcp` | Check if used | Defined in `RPC_CHANNELS` but not in preload — may be dead code. |

---

## Handler File Refactoring Plan

Each current handler file maps to the new split:

| Current file | Core extract | Shell remainder |
|-------------|-------------|----------------|
| `sessions.ts` | All channels (extract `shell.*` to `platform`) | — |
| `labels.ts` | All channels | — |
| `statuses.ts` | All channels | — |
| `sources.ts` | All channels | — |
| `skills.ts` | `GET`, `GET_FILES`, `DELETE` | `OPEN_EDITOR`, `OPEN_FINDER` |
| `automations.ts` | All channels | — |
| `llm-connections.ts` | CRUD + Pi + setup channels | ChatGPT/Copilot OAuth flows |
| `settings.ts` | All except dialog | `dialog:openFolder` |
| `onboarding.ts` | All channels | — |
| `files.ts` | `READ`, `READ_DATA_URL`, `READ_BINARY`, `READ_ATTACHMENT`, `STORE_ATTACHMENT`, `SEARCH` | `OPEN_DIALOG`, `GENERATE_THUMBNAIL` |
| `workspace.ts` | `workspaces:*`, `views:*`, `toolIcons:*`, `logo:*` | `window:*`, `theme:*` sync, image resize |
| `system.ts` | `git:getBranch` | Everything else (updates, shell, menu, badge, notifications, theme) |
| `auth.ts` | `credentials:healthCheck` | Dialog confirmations, logout |
| `browser.ts` | — | All channels (BrowserPaneManager is Electron-only) |

---

## Totals

| Bucket | Channel count | Handler files |
|--------|--------------|--------------|
| **A — Core** | ~88 | 9 pure + 5 partial |
| **B — Shell** | ~85 | 6 pure + 5 partial |
| **C — Remove** | ~3 | — |
| **Total** | ~176 | 14 |
