#!/usr/bin/env bun
/**
 * IPC Channel Migration Script (Phase 2A Step 3)
 *
 * Replaces all RPC_CHANNELS.FLAT_KEY references with RPC_CHANNELS.ns.NEW_KEY
 * across the codebase. Hardcoded migration map matches the nested structure.
 *
 * Usage: bun run scripts/ipc-migrate.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = join(import.meta.dir, '..')

// Complete migration map: OLD_KEY → 'namespace.NEW_KEY'
// Generated from ipc-inventory.ts output, adjusted to match actual nested structure.
const MIGRATION_MAP: Record<string, string> = {
  // sessions namespace (includes merged session:* channels)
  GET_SESSIONS: 'sessions.GET',
  GET_UNREAD_SUMMARY: 'sessions.GET_UNREAD_SUMMARY',
  MARK_ALL_SESSIONS_READ: 'sessions.MARK_ALL_READ',
  SESSIONS_UNREAD_SUMMARY_CHANGED: 'sessions.UNREAD_SUMMARY_CHANGED',
  CREATE_SESSION: 'sessions.CREATE',
  DELETE_SESSION: 'sessions.DELETE',
  GET_SESSION_MESSAGES: 'sessions.GET_MESSAGES',
  SEND_MESSAGE: 'sessions.SEND_MESSAGE',
  CANCEL_PROCESSING: 'sessions.CANCEL',
  KILL_SHELL: 'sessions.KILL_SHELL',
  RESPOND_TO_PERMISSION: 'sessions.RESPOND_TO_PERMISSION',
  RESPOND_TO_CREDENTIAL: 'sessions.RESPOND_TO_CREDENTIAL',
  SESSION_COMMAND: 'sessions.COMMAND',
  GET_PENDING_PLAN_EXECUTION: 'sessions.GET_PENDING_PLAN_EXECUTION',
  GET_SESSION_PERMISSION_MODE_STATE: 'sessions.GET_PERMISSION_MODE_STATE',
  SESSION_EVENT: 'sessions.EVENT',
  GET_SESSION_FILES: 'sessions.GET_FILES',
  GET_SESSION_NOTES: 'sessions.GET_NOTES',
  SET_SESSION_NOTES: 'sessions.SET_NOTES',
  WATCH_SESSION_FILES: 'sessions.WATCH_FILES',
  UNWATCH_SESSION_FILES: 'sessions.UNWATCH_FILES',
  SESSION_FILES_CHANGED: 'sessions.FILES_CHANGED',
  SESSION_GET_MODEL: 'sessions.GET_MODEL',
  SESSION_SET_MODEL: 'sessions.SET_MODEL',
  SEARCH_SESSIONS: 'sessions.SEARCH_CONTENT',

  // tasks
  GET_TASK_OUTPUT: 'tasks.GET_OUTPUT',

  // workspaces
  GET_WORKSPACES: 'workspaces.GET',
  CREATE_WORKSPACE: 'workspaces.CREATE',
  CHECK_WORKSPACE_SLUG: 'workspaces.CHECK_SLUG',

  // window
  GET_WINDOW_WORKSPACE: 'window.GET_WORKSPACE',
  GET_WINDOW_MODE: 'window.GET_MODE',
  OPEN_WORKSPACE: 'window.OPEN_WORKSPACE',
  OPEN_SESSION_IN_NEW_WINDOW: 'window.OPEN_SESSION_IN_NEW_WINDOW',
  SWITCH_WORKSPACE: 'window.SWITCH_WORKSPACE',
  CLOSE_WINDOW: 'window.CLOSE',
  WINDOW_CLOSE_REQUESTED: 'window.CLOSE_REQUESTED',
  WINDOW_CONFIRM_CLOSE: 'window.CONFIRM_CLOSE',
  WINDOW_CANCEL_CLOSE: 'window.CANCEL_CLOSE',
  WINDOW_SET_TRAFFIC_LIGHTS: 'window.SET_TRAFFIC_LIGHTS',
  WINDOW_FOCUS_STATE: 'window.FOCUS_STATE',
  WINDOW_GET_FOCUS_STATE: 'window.GET_FOCUS_STATE',

  // file
  READ_FILE: 'file.READ',
  READ_FILE_DATA_URL: 'file.READ_DATA_URL',
  READ_FILE_BINARY: 'file.READ_BINARY',
  OPEN_FILE_DIALOG: 'file.OPEN_DIALOG',
  READ_FILE_ATTACHMENT: 'file.READ_ATTACHMENT',
  STORE_ATTACHMENT: 'file.STORE_ATTACHMENT',
  GENERATE_THUMBNAIL: 'file.GENERATE_THUMBNAIL',

  // fs
  FS_SEARCH: 'fs.SEARCH',

  // debug
  DEBUG_LOG: 'debug.LOG',

  // theme
  GET_SYSTEM_THEME: 'theme.GET_SYSTEM_PREFERENCE',
  SYSTEM_THEME_CHANGED: 'theme.SYSTEM_CHANGED',
  THEME_APP_CHANGED: 'theme.APP_CHANGED',
  THEME_GET_APP: 'theme.GET_APP',
  THEME_GET_PRESETS: 'theme.GET_PRESETS',
  THEME_LOAD_PRESET: 'theme.LOAD_PRESET',
  THEME_GET_COLOR_THEME: 'theme.GET_COLOR_THEME',
  THEME_SET_COLOR_THEME: 'theme.SET_COLOR_THEME',
  THEME_BROADCAST_PREFERENCES: 'theme.BROADCAST_PREFERENCES',
  THEME_PREFERENCES_CHANGED: 'theme.PREFERENCES_CHANGED',
  THEME_GET_WORKSPACE_COLOR_THEME: 'theme.GET_WORKSPACE_COLOR_THEME',
  THEME_SET_WORKSPACE_COLOR_THEME: 'theme.SET_WORKSPACE_COLOR_THEME',
  THEME_GET_ALL_WORKSPACE_THEMES: 'theme.GET_ALL_WORKSPACE_THEMES',
  THEME_BROADCAST_WORKSPACE_THEME: 'theme.BROADCAST_WORKSPACE_THEME',
  THEME_WORKSPACE_THEME_CHANGED: 'theme.WORKSPACE_THEME_CHANGED',

  // system
  GET_VERSIONS: 'system.VERSIONS',
  GET_HOME_DIR: 'system.HOME_DIR',
  IS_DEBUG_MODE: 'system.IS_DEBUG_MODE',

  // update
  UPDATE_CHECK: 'update.CHECK',
  UPDATE_GET_INFO: 'update.GET_INFO',
  UPDATE_INSTALL: 'update.INSTALL',
  UPDATE_DISMISS: 'update.DISMISS',
  UPDATE_GET_DISMISSED: 'update.GET_DISMISSED',
  UPDATE_AVAILABLE: 'update.AVAILABLE',
  UPDATE_DOWNLOAD_PROGRESS: 'update.DOWNLOAD_PROGRESS',

  // shell
  OPEN_URL: 'shell.OPEN_URL',
  OPEN_FILE: 'shell.OPEN_FILE',
  SHOW_IN_FOLDER: 'shell.SHOW_IN_FOLDER',

  // menu
  MENU_NEW_CHAT: 'menu.NEW_CHAT',
  MENU_NEW_WINDOW: 'menu.NEW_WINDOW',
  MENU_OPEN_SETTINGS: 'menu.OPEN_SETTINGS',
  MENU_KEYBOARD_SHORTCUTS: 'menu.KEYBOARD_SHORTCUTS',
  MENU_TOGGLE_FOCUS_MODE: 'menu.TOGGLE_FOCUS_MODE',
  MENU_TOGGLE_SIDEBAR: 'menu.TOGGLE_SIDEBAR',
  MENU_QUIT: 'menu.QUIT',
  MENU_MINIMIZE: 'menu.MINIMIZE',
  MENU_MAXIMIZE: 'menu.MAXIMIZE',
  MENU_ZOOM_IN: 'menu.ZOOM_IN',
  MENU_ZOOM_OUT: 'menu.ZOOM_OUT',
  MENU_ZOOM_RESET: 'menu.ZOOM_RESET',
  MENU_TOGGLE_DEVTOOLS: 'menu.TOGGLE_DEV_TOOLS',
  MENU_UNDO: 'menu.UNDO',
  MENU_REDO: 'menu.REDO',
  MENU_CUT: 'menu.CUT',
  MENU_COPY: 'menu.COPY',
  MENU_PASTE: 'menu.PASTE',
  MENU_SELECT_ALL: 'menu.SELECT_ALL',

  // deeplink
  DEEP_LINK_NAVIGATE: 'deeplink.NAVIGATE',

  // auth
  LOGOUT: 'auth.LOGOUT',
  SHOW_LOGOUT_CONFIRMATION: 'auth.SHOW_LOGOUT_CONFIRMATION',
  SHOW_DELETE_SESSION_CONFIRMATION: 'auth.SHOW_DELETE_SESSION_CONFIRMATION',

  // credentials
  CREDENTIAL_HEALTH_CHECK: 'credentials.HEALTH_CHECK',

  // onboarding
  ONBOARDING_GET_AUTH_STATE: 'onboarding.GET_AUTH_STATE',
  ONBOARDING_VALIDATE_MCP: 'onboarding.VALIDATE_MCP',
  ONBOARDING_START_MCP_OAUTH: 'onboarding.START_MCP_OAUTH',
  ONBOARDING_START_CLAUDE_OAUTH: 'onboarding.START_CLAUDE_OAUTH',
  ONBOARDING_EXCHANGE_CLAUDE_CODE: 'onboarding.EXCHANGE_CLAUDE_CODE',
  ONBOARDING_HAS_CLAUDE_OAUTH_STATE: 'onboarding.HAS_CLAUDE_OAUTH_STATE',
  ONBOARDING_CLEAR_CLAUDE_OAUTH_STATE: 'onboarding.CLEAR_CLAUDE_OAUTH_STATE',

  // llmConnections (wire prefix: LLM_Connection)
  LLM_CONNECTION_LIST: 'llmConnections.LIST',
  LLM_CONNECTION_LIST_WITH_STATUS: 'llmConnections.LIST_WITH_STATUS',
  LLM_CONNECTION_GET: 'llmConnections.GET',
  LLM_CONNECTION_GET_API_KEY: 'llmConnections.GET_API_KEY',
  LLM_CONNECTION_SAVE: 'llmConnections.SAVE',
  LLM_CONNECTION_DELETE: 'llmConnections.DELETE',
  LLM_CONNECTION_TEST: 'llmConnections.TEST',
  LLM_CONNECTION_SET_DEFAULT: 'llmConnections.SET_DEFAULT',
  LLM_CONNECTION_SET_WORKSPACE_DEFAULT: 'llmConnections.SET_WORKSPACE_DEFAULT',
  LLM_CONNECTION_REFRESH_MODELS: 'llmConnections.REFRESH_MODELS',
  LLM_CONNECTIONS_CHANGED: 'llmConnections.CHANGED',

  // chatgpt
  CHATGPT_START_OAUTH: 'chatgpt.START_OAUTH',
  CHATGPT_CANCEL_OAUTH: 'chatgpt.CANCEL_OAUTH',
  CHATGPT_GET_AUTH_STATUS: 'chatgpt.GET_AUTH_STATUS',
  CHATGPT_LOGOUT: 'chatgpt.LOGOUT',

  // copilot
  COPILOT_START_OAUTH: 'copilot.START_OAUTH',
  COPILOT_CANCEL_OAUTH: 'copilot.CANCEL_OAUTH',
  COPILOT_GET_AUTH_STATUS: 'copilot.GET_AUTH_STATUS',
  COPILOT_LOGOUT: 'copilot.LOGOUT',
  COPILOT_DEVICE_CODE: 'copilot.DEVICE_CODE',

  // settings
  SETUP_LLM_CONNECTION: 'settings.SETUP_LLM_CONNECTION',
  SETTINGS_TEST_LLM_CONNECTION_SETUP: 'settings.TEST_LLM_CONNECTION_SETUP',

  // pi
  PI_GET_API_KEY_PROVIDERS: 'pi.GET_API_KEY_PROVIDERS',
  PI_GET_PROVIDER_BASE_URL: 'pi.GET_PROVIDER_BASE_URL',
  PI_GET_PROVIDER_MODELS: 'pi.GET_PROVIDER_MODELS',

  // dialog
  OPEN_FOLDER_DIALOG: 'dialog.OPEN_FOLDER',

  // preferences
  PREFERENCES_READ: 'preferences.READ',
  PREFERENCES_WRITE: 'preferences.WRITE',

  // drafts
  DRAFTS_GET: 'drafts.GET',
  DRAFTS_SET: 'drafts.SET',
  DRAFTS_DELETE: 'drafts.DELETE',
  DRAFTS_GET_ALL: 'drafts.GET_ALL',

  // sources
  SOURCES_GET: 'sources.GET',
  SOURCES_CREATE: 'sources.CREATE',
  SOURCES_DELETE: 'sources.DELETE',
  SOURCES_START_OAUTH: 'sources.START_OAUTH',
  SOURCES_SAVE_CREDENTIALS: 'sources.SAVE_CREDENTIALS',
  SOURCES_CHANGED: 'sources.CHANGED',
  SOURCES_GET_PERMISSIONS: 'sources.GET_PERMISSIONS',
  SOURCES_GET_MCP_TOOLS: 'sources.GET_MCP_TOOLS',

  // workspace (includes merged workspaceSettings:*)
  WORKSPACE_GET_PERMISSIONS: 'workspace.GET_PERMISSIONS',
  WORKSPACE_READ_IMAGE: 'workspace.READ_IMAGE',
  WORKSPACE_WRITE_IMAGE: 'workspace.WRITE_IMAGE',
  WORKSPACE_SETTINGS_GET: 'workspace.SETTINGS_GET',
  WORKSPACE_SETTINGS_UPDATE: 'workspace.SETTINGS_UPDATE',

  // permissions
  DEFAULT_PERMISSIONS_GET: 'permissions.GET_DEFAULTS',
  DEFAULT_PERMISSIONS_CHANGED: 'permissions.DEFAULTS_CHANGED',

  // skills
  SKILLS_GET: 'skills.GET',
  SKILLS_GET_FILES: 'skills.GET_FILES',
  SKILLS_DELETE: 'skills.DELETE',
  SKILLS_OPEN_EDITOR: 'skills.OPEN_EDITOR',
  SKILLS_OPEN_FINDER: 'skills.OPEN_FINDER',
  SKILLS_CHANGED: 'skills.CHANGED',

  // statuses
  STATUSES_LIST: 'statuses.LIST',
  STATUSES_REORDER: 'statuses.REORDER',
  STATUSES_CHANGED: 'statuses.CHANGED',

  // labels
  LABELS_LIST: 'labels.LIST',
  LABELS_CREATE: 'labels.CREATE',
  LABELS_DELETE: 'labels.DELETE',
  LABELS_CHANGED: 'labels.CHANGED',

  // views
  VIEWS_LIST: 'views.LIST',
  VIEWS_SAVE: 'views.SAVE',

  // toolIcons
  TOOL_ICONS_GET_MAPPINGS: 'toolIcons.GET_MAPPINGS',

  // logo
  LOGO_GET_URL: 'logo.GET_URL',

  // notification
  NOTIFICATION_SHOW: 'notification.SHOW',
  NOTIFICATION_NAVIGATE: 'notification.NAVIGATE',
  NOTIFICATION_GET_ENABLED: 'notification.GET_ENABLED',
  NOTIFICATION_SET_ENABLED: 'notification.SET_ENABLED',

  // input
  INPUT_GET_AUTO_CAPITALISATION: 'input.GET_AUTO_CAPITALISATION',
  INPUT_SET_AUTO_CAPITALISATION: 'input.SET_AUTO_CAPITALISATION',
  INPUT_GET_SEND_MESSAGE_KEY: 'input.GET_SEND_MESSAGE_KEY',
  INPUT_SET_SEND_MESSAGE_KEY: 'input.SET_SEND_MESSAGE_KEY',
  INPUT_GET_SPELL_CHECK: 'input.GET_SPELL_CHECK',
  INPUT_SET_SPELL_CHECK: 'input.SET_SPELL_CHECK',

  // power
  POWER_GET_KEEP_AWAKE: 'power.GET_KEEP_AWAKE',
  POWER_SET_KEEP_AWAKE: 'power.SET_KEEP_AWAKE',

  // appearance
  APPEARANCE_GET_RICH_TOOL_DESCRIPTIONS: 'appearance.GET_RICH_TOOL_DESCRIPTIONS',
  APPEARANCE_SET_RICH_TOOL_DESCRIPTIONS: 'appearance.SET_RICH_TOOL_DESCRIPTIONS',

  // badge
  BADGE_REFRESH: 'badge.REFRESH',
  BADGE_SET_ICON: 'badge.SET_ICON',
  BADGE_DRAW: 'badge.DRAW',
  BADGE_DRAW_WINDOWS: 'badge.DRAW_WINDOWS',

  // releaseNotes
  GET_RELEASE_NOTES: 'releaseNotes.GET',
  GET_LATEST_RELEASE_VERSION: 'releaseNotes.GET_LATEST_VERSION',

  // git
  GET_GIT_BRANCH: 'git.GET_BRANCH',

  // gitbash
  GITBASH_CHECK: 'gitbash.CHECK',
  GITBASH_BROWSE: 'gitbash.BROWSE',
  GITBASH_SET_PATH: 'gitbash.SET_PATH',

  // browserPane (includes merged browser-empty-state:*)
  BROWSER_PANE_CREATE: 'browserPane.CREATE',
  BROWSER_PANE_DESTROY: 'browserPane.DESTROY',
  BROWSER_PANE_LIST: 'browserPane.LIST',
  BROWSER_PANE_NAVIGATE: 'browserPane.NAVIGATE',
  BROWSER_PANE_GO_BACK: 'browserPane.GO_BACK',
  BROWSER_PANE_GO_FORWARD: 'browserPane.GO_FORWARD',
  BROWSER_PANE_RELOAD: 'browserPane.RELOAD',
  BROWSER_PANE_STOP: 'browserPane.STOP',
  BROWSER_PANE_FOCUS: 'browserPane.FOCUS',
  BROWSER_PANE_SNAPSHOT: 'browserPane.SNAPSHOT',
  BROWSER_PANE_CLICK: 'browserPane.CLICK',
  BROWSER_PANE_FILL: 'browserPane.FILL',
  BROWSER_PANE_SELECT: 'browserPane.SELECT',
  BROWSER_PANE_SCREENSHOT: 'browserPane.SCREENSHOT',
  BROWSER_PANE_EVALUATE: 'browserPane.EVALUATE',
  BROWSER_PANE_SCROLL: 'browserPane.SCROLL',
  BROWSER_EMPTY_STATE_LAUNCH: 'browserPane.LAUNCH',
  BROWSER_PANE_STATE_CHANGED: 'browserPane.STATE_CHANGED',
  BROWSER_PANE_REMOVED: 'browserPane.REMOVED',
  BROWSER_PANE_INTERACTED: 'browserPane.INTERACTED',

  // automations
  TEST_AUTOMATION: 'automations.TEST',
  AUTOMATIONS_SET_ENABLED: 'automations.SET_ENABLED',
  AUTOMATIONS_DUPLICATE: 'automations.DUPLICATE',
  AUTOMATIONS_DELETE: 'automations.DELETE',
  AUTOMATIONS_GET_HISTORY: 'automations.GET_HISTORY',
  AUTOMATIONS_GET_LAST_EXECUTED: 'automations.GET_LAST_EXECUTED',
  AUTOMATIONS_CHANGED: 'automations.CHANGED',
}

console.log(`Migration map: ${Object.keys(MIGRATION_MAP).length} entries`)

// ── Find all .ts/.tsx files that reference RPC_CHANNELS ──

const SRC_DIR = join(ROOT, 'apps', 'electron', 'src')

const glob = new Bun.Glob('**/*.{ts,tsx}')
const allFiles: string[] = []
for (const path of glob.scanSync({ cwd: SRC_DIR })) {
  allFiles.push(join(SRC_DIR, path))
}

// Filter to files that contain RPC_CHANNELS (skip types.ts itself — already restructured)
const targetFiles = allFiles.filter(f => {
  if (f.endsWith('shared/types.ts')) return false
  if (f.endsWith('ipc-channels.test.ts')) return false
  const content = readFileSync(f, 'utf-8')
  return content.includes('RPC_CHANNELS.')
})

console.log(`Found ${targetFiles.length} files to process`)

// Sort keys by length (longest first) to avoid partial matches
// e.g., BROWSER_PANE_STATE_CHANGED before BROWSER_PANE_STATE
const sortedKeys = Object.keys(MIGRATION_MAP).sort((a, b) => b.length - a.length)

// ── Perform replacements ──

let totalReplacements = 0

for (const filePath of targetFiles) {
  let content = readFileSync(filePath, 'utf-8')
  let fileReplacements = 0
  const relativePath = filePath.replace(ROOT + '/', '')

  for (const oldKey of sortedKeys) {
    const newPath = MIGRATION_MAP[oldKey]
    // Match RPC_CHANNELS.OLD_KEY followed by non-word char or end of string
    const regex = new RegExp(`RPC_CHANNELS\\.${oldKey}(?!\\w)`, 'g')
    const matches = content.match(regex)
    if (matches) {
      content = content.replace(regex, `RPC_CHANNELS.${newPath}`)
      fileReplacements += matches.length
    }
  }

  if (fileReplacements > 0) {
    if (!DRY_RUN) {
      writeFileSync(filePath, content)
    }
    console.log(`  ${relativePath}: ${fileReplacements} replacements`)
    totalReplacements += fileReplacements
  }
}

console.log(`\nTotal: ${totalReplacements} replacements across ${targetFiles.length} files`)
if (DRY_RUN) {
  console.log('(dry run — no files modified)')
}
