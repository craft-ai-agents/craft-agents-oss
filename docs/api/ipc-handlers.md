# IPC Handlers Reference

Complete reference of Inter-Process Communication (IPC) handlers between Electron main and renderer processes.

## Overview

Vesper uses Electron's IPC mechanism for main/renderer communication:

- **Handlers** (`ipcMain.handle`) - Request/response pattern
- **Events** (`webContents.send`) - One-way broadcasts from main to renderer
- **Listeners** (`ipcRenderer.on`) - Receive broadcasts in renderer

## Architecture

```
┌─────────────┐         IPC          ┌─────────────┐
│  Renderer   │ ◄─────────────────► │    Main     │
│  (React)    │    invoke/handle    │  (Node.js)  │
└─────────────┘                      └─────────────┘
      ▲                                     │
      │                                     │
      └─────── Broadcast Events ────────────┘
           (webContents.send)
```

## Categories

- [Session Management](#session-management)
- [Workspace Management](#workspace-management)
- [Window Management](#window-management)
- [File Operations](#file-operations)
- [Templates](#templates)
- [Task Lists](#task-lists)
- [Labels](#labels)
- [Slack Integration](#slack-integration)
- [Telegram Integration](#telegram-integration)
- [WhatsApp Integration](#whatsapp-integration)
- [Notifications](#notifications)
- [Scheduler](#scheduler)
- [Skills](#skills)
- [Sources](#sources)
- [Orchestrate](#orchestrate)
- [GitHub Integration](#github-integration)
- [Configuration](#configuration)
- [Theme](#theme)
- [System](#system)

---

## Session Management

Full documentation: [sessions.md](./sessions.md)

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `sessions:get` | - | `Session[]` | Get all sessions (lazy) |
| `sessions:getMessages` | `sessionId` | `Session` | Get session with messages |
| `sessions:create` | `workspaceId, options` | `Session` | Create new session |
| `sessions:delete` | `sessionId` | `void` | Delete session |
| `sessions:sendMessage` | `sessionId, message, attachments` | `{ started: boolean }` | Send message (async) |
| `sessions:cancel` | `sessionId, silent?` | `void` | Cancel processing |
| `sessions:killShell` | `sessionId, shellId` | `void` | Kill background shell |
| `sessions:respondToPermission` | `sessionId, requestId, allowed, alwaysAllow` | `boolean` | Respond to permission request |
| `sessions:respondToCredential` | `sessionId, requestId, response` | `boolean` | Respond to credential request |
| `sessions:resumeInTerminal` | `sessionId` | `{ success, error? }` | Resume in terminal |
| `sessions:command` | `sessionId, command` | `void` | Unified session operations |
| `sessions:getFiles` | `sessionId` | `SessionFile[]` | Get session directory files |
| `sessions:getNotes` | `sessionId` | `string` | Get session notes |
| `sessions:setNotes` | `sessionId, notes` | `void` | Set session notes |
| `sessions:watchFiles` | `sessionId` | `void` | Watch session directory |
| `sessions:unwatchFiles` | `sessionId` | `void` | Stop watching |
| `tasks:getOutput` | `taskId` | `string` | Get background task output |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `session:event` | `{ type, sessionId, ... }` | Session processing events |
| `sessions:filesChanged` | `{ sessionId, files }` | Session directory changed |

---

## Workspace Management

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `workspaces:get` | - | `Workspace[]` | Get all workspaces |
| `workspaces:create` | `folderPath, name` | `Workspace` | Create workspace |
| `workspaces:checkSlug` | `slug` | `{ exists, path }` | Check if slug exists |
| `workspace:readImage` | `workspaceId, filename` | `string \| null` | Read workspace image |
| `workspace:writeImage` | `workspaceId, filename, base64` | `void` | Write workspace image |
| `workspaceSettings:get` | `workspaceId` | `WorkspaceSettings` | Get workspace settings |
| `workspaceSettings:update` | `workspaceId, updates` | `void` | Update workspace settings |
| `workspace:getPermissions` | `workspaceId` | `PermissionsConfig` | Get workspace permissions |

---

## Window Management

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `window:getWorkspace` | - | `string` | Get workspace ID for window |
| `window:getMode` | - | `'main'` | Get window mode |
| `window:openWorkspace` | `workspaceId` | `void` | Open/focus workspace |
| `window:openSessionInNewWindow` | `workspaceId, sessionId` | `void` | Open session in new window |
| `window:switchWorkspace` | `workspaceId` | `void` | Switch workspace in window |
| `window:close` | - | `void` | Close window |
| `window:confirmClose` | - | `void` | Force close window |
| `window:setTrafficLights` | `visible` | `void` | Show/hide macOS traffic lights |
| `window:getFocusState` | - | `boolean` | Get window focus state |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `window:closeRequested` | - | Window close intercepted |
| `window:focusState` | `boolean` | Window focus changed |

---

## File Operations

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `file:read` | `filePath` | `string` | Read file contents |
| `file:openDialog` | `options` | `string[] \| null` | Open file picker |
| `file:readAttachment` | `filePath` | `FileAttachment` | Read file as attachment |
| `file:storeAttachment` | `sessionId, attachment` | `StoredAttachment` | Store attachment |
| `file:generateThumbnail` | `filePath` | `string` | Generate Quick Look thumbnail |
| `dialog:openFolder` | - | `string \| null` | Open folder picker |

---

## Templates

Full documentation: [templates.md](./templates.md)

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `template:list` | `scope, workspaceId?` | `SessionTemplate[]` | List templates |
| `template:create` | `options` | `SessionTemplate` | Create template |
| `template:get` | `id, scope, workspaceId?` | `SessionTemplate` | Get template |
| `template:update` | `id, scope, workspaceId?, updates` | `SessionTemplate` | Update template |
| `template:delete` | `id, scope, workspaceId?` | `void` | Delete template |
| `template:save-from-session` | `options` | `SessionTemplate` | Save session as template |
| `template:use` | `templateId, scope, workspaceId?` | `SessionTemplate` | Use template (increments count) |
| `template:create-defaults` | `workspaceId` | `SessionTemplate[]` | Create default templates |

---

## Task Lists

Full documentation: [task-lists.md](./task-lists.md)

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `task-lists:list` | - | `TaskListMeta[]` | List all task lists |
| `task-lists:create` | `name, description?` | `TaskList` | Create task list |
| `task-lists:get` | `taskListId` | `TaskList \| null` | Get task list |
| `task-lists:delete` | `taskListId` | `void` | Delete task list |
| `task-lists:task-create` | `taskListId, subject, description, ...` | `Task` | Create task |
| `task-lists:task-batch-create` | `taskListId, tasks[]` | `Task[]` | Batch create tasks |
| `task-lists:task-update` | `taskListId, taskId, updates` | `Task` | Update task |
| `task-lists:task-delete` | `taskListId, taskId` | `void` | Delete task |
| `task-lists:tasks-list` | `taskListId` | `Task[]` | Get all tasks |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `task-lists:changed` | `taskListId` | Task list changed |

---

## Labels

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `labels:list` | `workspaceId` | `Label[]` | List labels |
| `labels:create` | `workspaceId, name, color` | `Label` | Create label |
| `labels:update` | `workspaceId, labelId, updates` | `Label` | Update label |
| `labels:delete` | `workspaceId, labelId` | `void` | Delete label |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `labels:changed` | `workspaceId` | Labels changed |

---

## Slack Integration

Full documentation: [slack.md](./slack.md)

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `slack:start-oauth` | `workspaceId` | `{ success, connection?, workspaces?, error? }` | Start OAuth flow |
| `slack:get-status` | `workspaceId` | `{ success, connection?, workspaces?, error? }` | Get OAuth status |
| `slack:disconnect` | `workspaceId, teamId?` | `{ success, error? }` | Disconnect OAuth |
| `slack:has-oauth-credentials` | - | `boolean` | Check if OAuth configured |
| `slack:connect` | `workspaceId, accountId?, config?` | `{ success, state?, error? }` | Start service |
| `slack:disconnect-service` | `workspaceId, accountId?` | `{ success, error? }` | Stop service |
| `slack:send-message` | `workspaceId, accountId?, message` | `{ success, ts?, error? }` | Send message |
| `slack:get-service-status` | `workspaceId, accountId?` | `{ connected, state? }` | Get service status |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `slack:message-received` | `{ workspaceId, accountId, message, sessionKey, permissionMode }` | Message received |
| `slack:status-changed` | `{ workspaceId, accountId, status, state }` | Status changed |
| `slack:error` | `{ workspaceId, accountId, error }` | Error occurred |

---

## Telegram Integration

Full documentation: [telegram.md](./telegram.md)

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `telegram:connect` | `workspaceId, botToken, accountId?` | `{ success, error? }` | Connect to Telegram |
| `telegram:disconnect` | `workspaceId, accountId?` | `{ success, error? }` | Disconnect |
| `telegram:status` | `workspaceId, accountId?` | `{ success, status?, error? }` | Get status |
| `telegram:send-message` | `workspaceId, chatId, content, accountId?` | `{ success, messageId?, error? }` | Send message |
| `telegram:get-saved-token` | `workspaceId, accountId?` | `{ success, token?, error? }` | Get saved token |
| `telegram:get-access-control` | `workspaceId, accountId?` | `{ success, accessControl?, error? }` | Get access control |
| `telegram:set-access-control` | `workspaceId, accountId?, accessControl` | `{ success, error? }` | Set access control |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `telegram:error` | `{ workspaceId, accountId, message, timestamp }` | Error occurred |

---

## WhatsApp Integration

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `whatsapp:connect` | `workspaceId` | `{ success, error? }` | Connect to WhatsApp |
| `whatsapp:disconnect` | `workspaceId` | `{ success, error? }` | Disconnect |
| `whatsapp:status` | `workspaceId` | `{ success, status?, error? }` | Get status |
| `whatsapp:send-message` | `workspaceId, chatId, content` | `{ success, error? }` | Send message |
| `whatsapp:getGroups` | `workspaceId` | `{ success, groups?, error? }` | Get groups |
| `whatsapp:getRouteConfig` | `workspaceId` | `{ success, config?, error? }` | Get routing config |
| `whatsapp:setRouteConfig` | `workspaceId, config` | `{ success, error? }` | Set routing config |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `whatsapp:qr-code` | `{ workspaceId, qrCode }` | QR code for auth |
| `whatsapp:authenticated` | `{ workspaceId }` | Authenticated |
| `whatsapp:disconnected` | `{ workspaceId }` | Disconnected |
| `whatsapp:error` | `{ workspaceId, error }` | Error occurred |
| `whatsapp:message-activity` | `{ workspaceId, chatId, isTyping }` | Typing indicator |

---

## Notifications

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `notification:show` | `title, body, sessionId?` | `void` | Show notification |
| `notification:getEnabled` | - | `boolean` | Get enabled state |
| `notification:setEnabled` | `enabled` | `void` | Set enabled state |
| `notifications:getSettings` | - | `NotificationSettings` | Get settings |
| `notifications:setSettings` | `settings` | `{ success, error? }` | Update settings |
| `notifications:test` | - | `{ success, error? }` | Send test notification |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `notification:navigate` | `{ workspaceId, sessionId }` | Notification clicked |
| `notifications:settingsChanged` | - | Settings updated |
| `notifications:playSound` | `volume` | Play notification sound |

---

## Scheduler

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `schedule:list` | `workspaceId` | `Schedule[]` | List schedules |
| `schedule:get` | `workspaceId, scheduleId` | `Schedule` | Get schedule |
| `schedule:create` | `workspaceId, schedule` | `Schedule` | Create schedule |
| `schedule:update` | `workspaceId, scheduleId, updates` | `Schedule` | Update schedule |
| `schedule:delete` | `workspaceId, scheduleId` | `void` | Delete schedule |
| `schedule:toggle` | `workspaceId, scheduleId` | `Schedule` | Toggle enabled |
| `schedule:runNow` | `workspaceId, scheduleId` | `void` | Run immediately |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `schedule:event` | `{ type, scheduleId, ... }` | Schedule execution events |

---

## Skills

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `skills:get` | `workspaceId` | `LoadedSkill[]` | Get skills |
| `skills:getFiles` | `workspaceId, skillId` | `SkillFile[]` | Get skill files |
| `skills:delete` | `workspaceId, skillId` | `void` | Delete skill |
| `skills:openEditor` | `workspaceId, skillId` | `void` | Open in editor |
| `skills:openFinder` | `workspaceId, skillId` | `void` | Open in Finder |
| `team-skills:setConfig` | `workspaceId, config` | `void` | Set team skills config |
| `team-skills:sync` | `workspaceId` | `{ success, error? }` | Sync team skills |
| `team-skills:getStatus` | `workspaceId` | `TeamSkillsStatus` | Get sync status |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `skills:changed` | `workspaceId` | Skills changed |

---

## Sources

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `sources:get` | `workspaceId` | `LoadedSource[]` | Get sources |
| `sources:create` | `workspaceId, source` | `LoadedSource` | Create source |
| `sources:delete` | `workspaceId, sourceId` | `void` | Delete source |
| `sources:startOAuth` | `workspaceId, sourceId, service` | `OAuthResult` | Start OAuth |
| `sources:saveCredentials` | `workspaceId, sourceId, credentials` | `void` | Save credentials |
| `sources:getPermissions` | `workspaceId, sourceId` | `PermissionsConfig` | Get permissions |
| `sources:getMcpTools` | `workspaceId, sourceId` | `McpToolsResult` | Get MCP tools |
| `sources:callMcpTool` | `workspaceId, sourceId, toolName, args` | `any` | Call MCP tool |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `sources:changed` | `workspaceId` | Sources changed |

---

## Orchestrate

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `loop:start` | `sessionId, prd` | `void` | Start loop |
| `loop:pause` | `sessionId` | `void` | Pause loop |
| `loop:resume` | `sessionId` | `void` | Resume loop |
| `loop:cancel` | `sessionId` | `void` | Cancel loop |
| `loop:getState` | `sessionId` | `LoopState` | Get loop state |

---

## GitHub Integration

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `github:startOAuth` | `workspaceId` | `{ success, error? }` | Start OAuth |
| `github:getStatus` | `workspaceId` | `{ success, status?, error? }` | Get status |
| `github:setStatus` | `workspaceId, status` | `void` | Set status |
| `github:setOAuthCredentials` | `clientId, clientSecret` | `void` | Set OAuth credentials |
| `github:hasOAuthCredentials` | - | `boolean` | Check if configured |
| `github:testCredentials` | `workspaceId` | `{ success, error? }` | Test credentials |

---

## Configuration

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `config:get` | - | `Config` | Get global config |
| `preferences:read` | - | `Preferences` | Read preferences |
| `preferences:write` | `preferences` | `void` | Write preferences |
| `drafts:get` | `sessionId` | `string \| null` | Get session draft |
| `drafts:set` | `sessionId, draft` | `void` | Set session draft |
| `drafts:delete` | `sessionId` | `void` | Delete session draft |
| `drafts:getAll` | - | `Record<string, string>` | Get all drafts |
| `permissions:getDefaults` | - | `PermissionsConfig` | Get default permissions |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `permissions:defaultsChanged` | - | Default permissions changed |

---

## Theme

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `theme:getSystemPreference` | - | `'light' \| 'dark'` | Get system theme |
| `theme:getApp` | - | `AppTheme` | Get app theme |
| `theme:getPresets` | - | `ThemePreset[]` | Get theme presets |
| `theme:loadPreset` | `presetId` | `void` | Load theme preset |
| `theme:getColorTheme` | - | `'light' \| 'dark' \| 'auto'` | Get color theme |
| `theme:setColorTheme` | `theme` | `void` | Set color theme |
| `theme:broadcastPreferences` | `preferences` | `void` | Broadcast preferences |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `theme:systemChanged` | `'light' \| 'dark'` | System theme changed |
| `theme:appChanged` | - | App theme changed |
| `theme:preferencesChanged` | `preferences` | Preferences changed |

---

## System

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `system:versions` | - | `{ app, electron, chrome, node }` | Get versions |
| `system:homeDir` | - | `string` | Get home directory |
| `system:isDebugMode` | - | `boolean` | Check debug mode |
| `git:branch` | `directory` | `string \| null` | Get git branch |
| `shell:openUrl` | `url` | `void` | Open URL |
| `shell:openFile` | `path` | `void` | Open file |
| `shell:showInFolder` | `path` | `void` | Show in folder |
| `logo:getUrl` | `workspaceId` | `string \| null` | Get logo URL |

---

## Auto-Update

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `update:check` | - | `void` | Check for updates |
| `update:getInfo` | - | `UpdateInfo \| null` | Get update info |
| `update:install` | - | `void` | Install update |
| `update:dismiss` | `version` | `void` | Dismiss update |
| `update:getDismissed` | - | `string \| null` | Get dismissed version |

### Events

| Channel | Payload | Description |
|---------|---------|-------------|
| `update:available` | `{ version, ... }` | Update available |
| `update:downloadProgress` | `{ percent, ... }` | Download progress |

---

## Menu Actions (Events)

| Channel | Payload | Description |
|---------|---------|-------------|
| `menu:newChat` | - | New chat requested |
| `menu:newWindow` | - | New window requested |
| `menu:openSettings` | - | Settings requested |
| `menu:keyboardShortcuts` | - | Shortcuts requested |

---

## Deep Link (Events)

| Channel | Payload | Description |
|---------|---------|-------------|
| `deeplink:navigate` | `url` | Deep link navigation |

---

## Onboarding

| Channel | Request | Response | Description |
|---------|---------|----------|-------------|
| `onboarding:getAuthState` | - | `AuthState` | Get auth state |
| `onboarding:validateMcp` | `config` | `McpValidationResult` | Validate MCP |
| `onboarding:startMcpOAuth` | `service` | `OAuthResult` | Start MCP OAuth |
| `onboarding:saveConfig` | `config` | `OnboardingSaveResult` | Save config |
| `onboarding:getExistingClaudeToken` | - | `string \| null` | Get CLI token |
| `onboarding:isClaudeCliInstalled` | - | `boolean` | Check if CLI installed |
| `onboarding:runClaudeSetupToken` | - | `{ success, error? }` | Run CLI setup |
| `onboarding:startClaudeOAuth` | - | `{ url, state }` | Start OAuth |
| `onboarding:exchangeClaudeCode` | `code, state` | `{ success, error? }` | Exchange code |
| `onboarding:hasClaudeOAuthState` | - | `boolean` | Check OAuth state |
| `onboarding:clearClaudeOAuthState` | - | `void` | Clear OAuth state |

---

## Best Practices

1. **Error Handling** - Always handle errors from IPC calls
2. **Event Cleanup** - Remove event listeners on unmount
3. **Broadcast Events** - Use for cross-window synchronization
4. **Async Operations** - Use separate events for long-running tasks
5. **Type Safety** - Import types from `@vesper/core/types`
6. **Security** - Validate inputs in main process handlers
7. **Performance** - Use lazy loading for large datasets

---

## Example Usage

```typescript
// Renderer process
import { ipcRenderer } from 'electron';

// Request/response
const sessions = await ipcRenderer.invoke('sessions:get');

// Event listener
ipcRenderer.on('session:event', (event, data) => {
  if (data.type === 'complete') {
    console.log('Session complete:', data.sessionId);
  }
});

// Cleanup
useEffect(() => {
  const handler = (event, data) => { ... };
  ipcRenderer.on('session:event', handler);
  return () => ipcRenderer.removeListener('session:event', handler);
}, []);
```

---

## Related Documentation

- [Sessions API](./sessions.md)
- [Task Lists API](./task-lists.md)
- [Templates API](./templates.md)
- [Slack API](./slack.md)
- [Telegram API](./telegram.md)
- [Credentials API](./credentials.md)
