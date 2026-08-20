/**
 * Exhaustive channel routing table for hybrid local/remote transport.
 *
 * Every RPC channel must belong to exactly one of two sets:
 * - LOCAL_ONLY: Always runs on the local Electron server, never proxied.
 * - REMOTE_ELIGIBLE: Runs on whichever server owns the workspace.
 *
 * An exhaustiveness test ensures new channels fail CI until classified.
 */

import { RPC_CHANNELS } from './channels'

// ---------------------------------------------------------------------------
// LOCAL_ONLY — fundamentally requires local OS / Electron
// ---------------------------------------------------------------------------

export const LOCAL_ONLY_CHANNELS = new Set<string>([
  // remote — local connectivity management (reaches out to remote server from local app)
  RPC_CHANNELS.remote.TEST_CONNECTION,

  // workspaces — local workspace CRUD (workspace list is local config)
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,

  // workgraph — app-owned local database, never remote/headless.
  RPC_CHANNELS.workgraph.GET_HEALTH,
  RPC_CHANNELS.workgraph.GET_VERSION,
  RPC_CHANNELS.workgraph.LIST_CONNECTIONS,
  RPC_CHANNELS.workgraph.LIST_CONNECTION_AUDIT,
  RPC_CHANNELS.workgraph.LIST_CONNECTION_BINDINGS,
  RPC_CHANNELS.workgraph.CONVERT_CONNECTION,
  RPC_CHANNELS.workgraph.REVOKE_CONNECTION_BINDING,
  RPC_CHANNELS.workgraph.GET_CONNECTION,
  RPC_CHANNELS.workgraph.CREATE_CONNECTION,
  RPC_CHANNELS.workgraph.GRANT_CONNECTION,
  RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV,
  RPC_CHANNELS.workgraph.IMPORT_GITHUB_ENV,
  RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER,
  RPC_CHANNELS.workgraph.IMPORT_GIT_HELPER,
  RPC_CHANNELS.workgraph.REVOKE_CONNECTION,
  RPC_CHANNELS.workgraph.REPAIR_CONNECTION,
  RPC_CHANNELS.workgraph.ROTATE_CONNECTION,
  RPC_CHANNELS.workgraph.TEST_CONNECTION,
  RPC_CHANNELS.workgraph.PREVIEW_DOCKER_HELPER,
  RPC_CHANNELS.workgraph.IMPORT_DOCKER_HELPER,
  RPC_CHANNELS.workgraph.PREVIEW_AWS_PROFILES,
  RPC_CHANNELS.workgraph.IMPORT_AWS_PROFILE,
  RPC_CHANNELS.workgraph.PREVIEW_KEYCHAIN,
  RPC_CHANNELS.workgraph.IMPORT_KEYCHAIN,
  RPC_CHANNELS.workgraph.PREVIEW_ADC,
  RPC_CHANNELS.workgraph.IMPORT_ADC,
  RPC_CHANNELS.workgraph.PREVIEW_SSH_AGENT,
  RPC_CHANNELS.workgraph.IMPORT_SSH_AGENT,

  // window — Electron window management
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.GET_MODE,
  RPC_CHANNELS.window.OPEN_WORKSPACE,
  RPC_CHANNELS.window.OPEN_SESSION_IN_NEW_WINDOW,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.window.CLOSE,
  RPC_CHANNELS.window.CLOSE_REQUESTED,
  RPC_CHANNELS.window.CONFIRM_CLOSE,
  RPC_CHANNELS.window.CANCEL_CLOSE,
  RPC_CHANNELS.window.SET_TRAFFIC_LIGHTS,
  RPC_CHANNELS.window.FOCUS_STATE,
  RPC_CHANNELS.window.GET_FOCUS_STATE,

  // file — native file dialog
  RPC_CHANNELS.file.OPEN_DIALOG,
  // file — draft hydration for user-attached paths. Paths in drafts.json were captured
  // via webUtils.getPathForFile in the renderer, so they point at the user's local machine
  // — even when the workspace itself lives on a remote server. Routing this REMOTE_ELIGIBLE
  // would send the local path to a remote filesystem that can't resolve it.
  RPC_CHANNELS.file.READ_USER_ATTACHMENT,

  // dialog — native folder dialog
  RPC_CHANNELS.dialog.OPEN_FOLDER,

  // auth — local auth state + native dialogs
  RPC_CHANNELS.auth.LOGOUT,
  RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION,
  RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION,
  RPC_CHANNELS.auth.SHOW_DELETE_WORKSPACE_CONFIRMATION,

  // shell — local OS shell (openFile/showInFolder guarded for remote)
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.shell.OPEN_FILE,
  RPC_CHANNELS.shell.SHOW_IN_FOLDER,

  // skills — local filesystem actions (guarded for remote)
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,

  // system — local OS info
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,

  // toolchain — local config-dir downloads/install state
  RPC_CHANNELS.toolchain.STATUS,
  RPC_CHANNELS.toolchain.STATUS_CHANGED,
  RPC_CHANNELS.toolchain.UPDATE,
  RPC_CHANNELS.toolchain.GET_DISABLED,
  RPC_CHANNELS.toolchain.SET_DISABLED,

  // theme — app/OS-level preferences, not workspace content
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.theme.SYSTEM_CHANGED,
  RPC_CHANNELS.theme.APP_CHANGED,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.PREFERENCES_CHANGED,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME,
  RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED,

  // update — local auto-update
  RPC_CHANNELS.update.CHECK,
  RPC_CHANNELS.update.GET_INFO,
  RPC_CHANNELS.update.INSTALL,
  RPC_CHANNELS.update.DISMISS,
  RPC_CHANNELS.update.GET_DISMISSED,
  RPC_CHANNELS.update.AVAILABLE,
  RPC_CHANNELS.update.DOWNLOAD_PROGRESS,

  // releaseNotes — local app info
  RPC_CHANNELS.releaseNotes.GET,
  RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION,

  // badge — local dock badge
  RPC_CHANNELS.badge.REFRESH,
  RPC_CHANNELS.badge.SET_ICON,
  RPC_CHANNELS.badge.DRAW,
  RPC_CHANNELS.badge.DRAW_WINDOWS,

  // menu — local menu events
  RPC_CHANNELS.menu.NEW_CHAT,
  RPC_CHANNELS.menu.NEW_WINDOW,
  RPC_CHANNELS.menu.OPEN_SETTINGS,
  RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS,
  RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE,
  RPC_CHANNELS.menu.TOGGLE_SIDEBAR,
  RPC_CHANNELS.menu.QUIT,
  RPC_CHANNELS.menu.MINIMIZE,
  RPC_CHANNELS.menu.MAXIMIZE,
  RPC_CHANNELS.menu.ZOOM_IN,
  RPC_CHANNELS.menu.ZOOM_OUT,
  RPC_CHANNELS.menu.ZOOM_RESET,
  RPC_CHANNELS.menu.TOGGLE_DEV_TOOLS,
  RPC_CHANNELS.menu.UNDO,
  RPC_CHANNELS.menu.REDO,
  RPC_CHANNELS.menu.CUT,
  RPC_CHANNELS.menu.COPY,
  RPC_CHANNELS.menu.PASTE,
  RPC_CHANNELS.menu.SELECT_ALL,

  // deeplink — local deep link handling
  RPC_CHANNELS.deeplink.NAVIGATE,

  // notification — local OS notifications
  RPC_CHANNELS.notification.SHOW,
  RPC_CHANNELS.notification.NAVIGATE,
  RPC_CHANNELS.notification.GET_ENABLED,
  RPC_CHANNELS.notification.SET_ENABLED,

  // input — local input preferences
  RPC_CHANNELS.input.GET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.SET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.GET_SPELL_CHECK,
  RPC_CHANNELS.input.SET_SPELL_CHECK,

  // power — local power management
  RPC_CHANNELS.power.GET_KEEP_AWAKE,
  RPC_CHANNELS.power.SET_KEEP_AWAKE,

  // appearance — local UI preferences
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.GET_DEFAULT_ZOOM_LEVEL,
  RPC_CHANNELS.appearance.SET_DEFAULT_ZOOM_LEVEL,

  // caching — prompt cache and context settings
  RPC_CHANNELS.caching.GET_EXTENDED_PROMPT_CACHE,
  RPC_CHANNELS.caching.SET_EXTENDED_PROMPT_CACHE,
  RPC_CHANNELS.caching.GET_ENABLE_1M_CONTEXT,
  RPC_CHANNELS.caching.SET_ENABLE_1M_CONTEXT,

  // rtk — token-optimization opt-in
  RPC_CHANNELS.rtk.GET_ENABLED,
  RPC_CHANNELS.rtk.SET_ENABLED,
  RPC_CHANNELS.rtk.GET_STATUS,
  RPC_CHANNELS.rtk.GET_GAIN,

  // tools — local tool settings
  RPC_CHANNELS.tools.GET_BROWSER_TOOL_ENABLED,
  RPC_CHANNELS.tools.SET_BROWSER_TOOL_ENABLED,

  // browserPane — Electron BrowserView
  RPC_CHANNELS.browserPane.CREATE,
  RPC_CHANNELS.browserPane.DESTROY,
  RPC_CHANNELS.browserPane.LIST,
  RPC_CHANNELS.browserPane.NAVIGATE,
  RPC_CHANNELS.browserPane.GO_BACK,
  RPC_CHANNELS.browserPane.GO_FORWARD,
  RPC_CHANNELS.browserPane.RELOAD,
  RPC_CHANNELS.browserPane.STOP,
  RPC_CHANNELS.browserPane.FOCUS,
  RPC_CHANNELS.browserPane.RESIZE,
  RPC_CHANNELS.browserPane.SNAPSHOT,
  RPC_CHANNELS.browserPane.CLICK,
  RPC_CHANNELS.browserPane.FILL,
  RPC_CHANNELS.browserPane.SELECT,
  RPC_CHANNELS.browserPane.SCREENSHOT,
  RPC_CHANNELS.browserPane.EVALUATE,
  RPC_CHANNELS.browserPane.SCROLL,
  RPC_CHANNELS.browserPane.LAUNCH,
  RPC_CHANNELS.browserPane.STATE_CHANGED,
  RPC_CHANNELS.browserPane.REMOVED,
  RPC_CHANNELS.browserPane.INTERACTED,
  RPC_CHANNELS.browserPane.CREATE_EMBEDDED,
  RPC_CHANNELS.browserPane.SYNC_BOUNDS,
  RPC_CHANNELS.browserPane.CLICK_AT,
  RPC_CHANNELS.browserPane.TYPE,
  RPC_CHANNELS.browserPane.KEY,

  // gitbash — Windows-specific local
  RPC_CHANNELS.gitbash.CHECK,
  RPC_CHANNELS.gitbash.BROWSE,
  RPC_CHANNELS.gitbash.SET_PATH,

  // debug — local debug logging
  RPC_CHANNELS.debug.LOG,

  // onboarding — local auth setup flow
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.START_ROX_CONNECT,
  RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
  RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  RPC_CHANNELS.settings.GET_NETWORK_PROXY,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,

  // env overrides — local config.json runtime.envOverrides applied to spawned agents
  RPC_CHANNELS.settings.GET_ENV_OVERRIDES,
  RPC_CHANNELS.settings.SET_ENV_OVERRIDES,

  // server config — local embedded server settings
  RPC_CHANNELS.settings.GET_SERVER_CONFIG,
  RPC_CHANNELS.settings.SET_SERVER_CONFIG,
  RPC_CHANNELS.settings.GET_SERVER_STATUS,

  // contextDocs — local config-dir documents (runtime context/*.md, not workspace content)
  RPC_CHANNELS.contextDocs.LIST,
  RPC_CHANNELS.contextDocs.READ,
  RPC_CHANNELS.contextDocs.WRITE,
  RPC_CHANNELS.contextDocs.DELETE,
  RPC_CHANNELS.contextDocs.READ_TEMPLATE,
  RPC_CHANNELS.contextDocs.ACCEPT_TEMPLATE,
  RPC_CHANNELS.contextDocs.KEEP_MINE_TEMPLATE,
  RPC_CHANNELS.contextDocs.CHANGED,

  // bundled skill packs — local config + ~/.agents/skills
  RPC_CHANNELS.bundledSkills.LIST,
  RPC_CHANNELS.bundledSkills.GET_DISABLED,
  RPC_CHANNELS.bundledSkills.SET_DISABLED,
  RPC_CHANNELS.bundledSkills.CHANGED,

  // marketplace — curated installs into the local config dir (skills/context/toolchain deferral)
  RPC_CHANNELS.marketplace.CATALOG,
  RPC_CHANNELS.marketplace.STATS,
  RPC_CHANNELS.marketplace.INSTALL,
  RPC_CHANNELS.marketplace.REMOVE,
  RPC_CHANNELS.marketplace.UPDATE,
  RPC_CHANNELS.marketplace.REFRESH,
  RPC_CHANNELS.marketplace.PROGRESS,
  RPC_CHANNELS.marketplace.CHANGED,

  // extensions — Extension Center catalog/state (local config dir + projections; same host as marketplace)
  RPC_CHANNELS.extensions.LIST_CATALOG,
  RPC_CHANNELS.extensions.LIST_INSTALLED,
  RPC_CHANNELS.extensions.SET_ENABLED,
  RPC_CHANNELS.extensions.GET_STATE,
  RPC_CHANNELS.extensions.CHANGED,

  // pluginBridge — SiYuan plugin bridge (local fixtures / residual kernel; never proxied)
  RPC_CHANNELS.pluginBridge.LIST_PLUGINS,
  RPC_CHANNELS.pluginBridge.GET_PROJECTIONS,
  RPC_CHANNELS.pluginBridge.SET_ENABLED,
  RPC_CHANNELS.pluginBridge.OPEN_COMPAT,
  RPC_CHANNELS.pluginBridge.INSTALL_BAZAAR,
  RPC_CHANNELS.pluginBridge.UNINSTALL_BAZAAR,

  // extensionHost — Craft Extension Host lifecycle (local process only; does not run SiYuan plugins)
  RPC_CHANNELS.extensionHost.STATUS,
  RPC_CHANNELS.extensionHost.STATUS_ALL,
  RPC_CHANNELS.extensionHost.START,
  RPC_CHANNELS.extensionHost.STOP,
  RPC_CHANNELS.extensionHost.RESTART,
  RPC_CHANNELS.extensionHost.LOAD,
  RPC_CHANNELS.extensionHost.CALL,
  RPC_CHANNELS.extensionHost.LIST_COMMANDS,
  RPC_CHANNELS.extensionHost.MINT_CAPABILITY,
  RPC_CHANNELS.extensionHost.REVOKE_CAPABILITY,
  RPC_CHANNELS.extensionHost.PROXY_FETCH,
  RPC_CHANNELS.extensionHost.GET_URL_ALLOWLIST,
  RPC_CHANNELS.extensionHost.SET_URL_ALLOWLIST,

  // extensionSurface — sandboxed extension UI BrowserViews (partition persist:ext-*)
  RPC_CHANNELS.extensionSurface.CREATE_EMBEDDED,
  RPC_CHANNELS.extensionSurface.DESTROY,
  RPC_CHANNELS.extensionSurface.LIST,
  RPC_CHANNELS.extensionSurface.SYNC_BOUNDS,
  RPC_CHANNELS.extensionSurface.FOCUS,
  RPC_CHANNELS.extensionSurface.STATE_CHANGED,
  RPC_CHANNELS.extensionSurface.REMOVED,


  // knowledge — engine status/start + install detect reflect the answering host, never proxied
  RPC_CHANNELS.knowledge.ENGINE_STATUS,
  RPC_CHANNELS.knowledge.DETECT_ENGINE,
  RPC_CHANNELS.knowledge.ENGINE_START,
  // Local vault/kernel import: remote clients must not drive host filesystem paths.
  RPC_CHANNELS.knowledge.MIGRATE_NOTES,
  RPC_CHANNELS.mindmap.ENRICH,
  RPC_CHANNELS.mindmap.PIN_LOAD,
  RPC_CHANNELS.mindmap.PIN_SAVE,
  RPC_CHANNELS.mindmap.PIN_CLEAR,

  // siyuan — embedded SiYuan surface lifecycle drives local Electron BrowserViews
  RPC_CHANNELS.siyuan.CREATE_EMBEDDED,
  RPC_CHANNELS.siyuan.DESTROY,
  RPC_CHANNELS.siyuan.LIST,
  RPC_CHANNELS.siyuan.SYNC_BOUNDS,
  RPC_CHANNELS.siyuan.FOCUS,
  RPC_CHANNELS.siyuan.EVALUATE,
  RPC_CHANNELS.siyuan.STATE_CHANGED,
  RPC_CHANNELS.siyuan.REMOVED,

  // gamification — user XP lives in local CONFIG_DIR
  RPC_CHANNELS.gamification.GET,
  RPC_CHANNELS.gamification.AWARD,
  RPC_CHANNELS.gamification.CHANGED,

  // orgs — local-only identity/membership bookkeeping (CONFIG_DIR)
  RPC_CHANNELS.orgs.LIST,
  RPC_CHANNELS.orgs.CREATE,
  RPC_CHANNELS.orgs.INVITE,
  RPC_CHANNELS.orgs.ACCEPT,
  RPC_CHANNELS.orgs.LIST_MEMBERS,
  RPC_CHANNELS.orgs.GET_IDENTITY,
  RPC_CHANNELS.orgs.UPDATE_IDENTITY,
  RPC_CHANNELS.orgs.SET_WORKSPACE_ORG,

  // identity — profile + service connections (Identity Center, S-07)
  RPC_CHANNELS.identity.GET_STATE,
  RPC_CHANNELS.identity.UPDATE_PROFILE,
  RPC_CHANNELS.identity.CONNECT,
  RPC_CHANNELS.identity.DISCONNECT,
  RPC_CHANNELS.identity.REFRESH_STATUS,
  RPC_CHANNELS.identity.CHANGED,

])

// ---------------------------------------------------------------------------
// REMOTE_ELIGIBLE — runs on whichever server owns the workspace
// ---------------------------------------------------------------------------

export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>([
  // server — server-level operations (no workspace context needed)
  RPC_CHANNELS.server.GET_WORKSPACES,
  RPC_CHANNELS.server.CREATE_WORKSPACE,
  RPC_CHANNELS.server.GET_STATUS,
  RPC_CHANNELS.server.GET_HEALTH,
  RPC_CHANNELS.server.GET_ACTIVE_SESSIONS,
  RPC_CHANNELS.server.SHUTTING_DOWN,
  RPC_CHANNELS.server.STATUS_CHANGED,
  RPC_CHANNELS.server.HOME_DIR,

  // sessions — core session runtime
  RPC_CHANNELS.sessions.GET,
  RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY,
  RPC_CHANNELS.sessions.MARK_ALL_READ,
  RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED,
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,
  RPC_CHANNELS.sessions.GET_PROVENANCE,
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.BULK_UPDATE,
  RPC_CHANNELS.sessions.BULK_CHANGED,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,
  RPC_CHANNELS.sessions.GET_PROVENANCE,
  RPC_CHANNELS.sessions.EVENT,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.sessions.GET_FILES,
  RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES,
  RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.UNWATCH_FILES,
  RPC_CHANNELS.sessions.FILES_CHANGED,
  RPC_CHANNELS.sessions.SEARCH_CONTENT,
  RPC_CHANNELS.sessions.EXPORT,
  RPC_CHANNELS.sessions.IMPORT,
  RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER,
  RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER,

  // transfer — chunked large-payload import (sessions, resources)
  RPC_CHANNELS.transfer.START,
  RPC_CHANNELS.transfer.CHUNK,
  RPC_CHANNELS.transfer.COMMIT,
  RPC_CHANNELS.transfer.ABORT,

  // tasks — workspace content (Conductor DAG runs on the workspace server)
  RPC_CHANNELS.tasks.GET_OUTPUT,
  RPC_CHANNELS.tasks.VALIDATE,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.GENERATE,
  RPC_CHANNELS.tasks.GENERATED,
  RPC_CHANNELS.tasks.RUN,
  RPC_CHANNELS.tasks.PAUSE,
  RPC_CHANNELS.tasks.RESUME,
  RPC_CHANNELS.tasks.STOP,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.GET_RESULTS,

  // file — workspace files (not openDialog which is native)
  RPC_CHANNELS.file.READ,
  RPC_CHANNELS.file.READ_DATA_URL,
  RPC_CHANNELS.file.READ_PREVIEW_DATA_URL,
  RPC_CHANNELS.file.READ_BINARY,
  RPC_CHANNELS.file.READ_ATTACHMENT,
  RPC_CHANNELS.file.STORE_ATTACHMENT,
  RPC_CHANNELS.file.GENERATE_THUMBNAIL,

  // fs — workspace filesystem
  RPC_CHANNELS.fs.SEARCH,
  RPC_CHANNELS.fs.LIST_DIRECTORY,

  // notes — workspace note vault
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.READ,
  RPC_CHANNELS.notes.SAVE,
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.RENAME,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.GET_RENAME_IMPACT,
  RPC_CHANNELS.notes.GET_DAILY_NOTE,
  RPC_CHANNELS.notes.IMPORT_ASSET,
  RPC_CHANNELS.notes.LIST_ASSETS,
  RPC_CHANNELS.notes.DELETE_ASSET,
  RPC_CHANNELS.notes.RENAME_ASSET,
  RPC_CHANNELS.notes.UPDATE_PROPERTIES,
  RPC_CHANNELS.notes.WATCH,
  RPC_CHANNELS.notes.UNWATCH,
  RPC_CHANNELS.notes.CHANGED,
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,

  // knowledge — P1 read-only knowledge provider (workspace-data read ops +
  // change broadcast, proxied to the workspace-owning server)
  RPC_CHANNELS.knowledge.LIST_CONNECTIONS,
  RPC_CHANNELS.knowledge.CAPABILITIES,
  RPC_CHANNELS.knowledge.SEARCH,
  RPC_CHANNELS.knowledge.GET,
  RPC_CHANNELS.knowledge.GET_CONTEXT,
  RPC_CHANNELS.knowledge.GET_BACKLINKS,
  RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD,
  RPC_CHANNELS.knowledge.SNAPSHOT_CREATE,
  RPC_CHANNELS.knowledge.SNAPSHOT_GET,
  RPC_CHANNELS.knowledge.CHANGED,

  // knowledge — P3 write-back (spec 05): mutation-proposal lifecycle operates
  // on workspace data, so all seven are proxied to the workspace-owning server.
  RPC_CHANNELS.knowledge.PROPOSE_MUTATION,
  RPC_CHANNELS.knowledge.APPROVE_PROPOSAL,
  RPC_CHANNELS.knowledge.REJECT_PROPOSAL,
  RPC_CHANNELS.knowledge.APPLY_PROPOSAL,
  RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL,
  RPC_CHANNELS.knowledge.GET_PROPOSAL,
  RPC_CHANNELS.knowledge.LIST_PROPOSALS,

  // knowledge — P4 publication pipeline (spec 06): drafts/publications/links
  // are workspace data under {workspaceRoot}/knowledge/.
  RPC_CHANNELS.knowledge.PUBLISH_DISTILL,
  RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT,
  RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT,
  RPC_CHANNELS.knowledge.PUBLISH_PREPARE,
  RPC_CHANNELS.knowledge.PUBLISH_APPLY,
  RPC_CHANNELS.knowledge.PUBLISH_FINALIZE,
  RPC_CHANNELS.knowledge.PUBLISH_LIST,
  RPC_CHANNELS.knowledge.LIST_LINKS,

  // knowledge — P5 saved views + work envelopes (K-09 / S-08): views.json and
  // work-envelopes.jsonl are workspace data on the workspace-owning server.
  RPC_CHANNELS.knowledge.ENVELOPE_GET,
  RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
  RPC_CHANNELS.knowledge.ENVELOPE_LIST,
  RPC_CHANNELS.knowledge.VIEWS_LIST,
  RPC_CHANNELS.knowledge.VIEW_RUN,
  RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
  RPC_CHANNELS.knowledge.WATCH,
  RPC_CHANNELS.knowledge.UNWATCH,
  RPC_CHANNELS.knowledge.METRICS_GET,

  // memory — lesson/context data served by workspace host
  RPC_CHANNELS.memory.LIST_LESSONS,
  RPC_CHANNELS.memory.ADD_LESSON,
  RPC_CHANNELS.memory.UPDATE_LESSON,
  RPC_CHANNELS.memory.DELETE_LESSON,
  RPC_CHANNELS.memory.GET_CONTEXT,
  RPC_CHANNELS.memory.UPDATE_CONTEXT,
  RPC_CHANNELS.memory.LIST_HISTORY,
  RPC_CHANNELS.memory.PROMOTION_CANDIDATES,
  RPC_CHANNELS.memory.PROMOTE_LESSON,
  RPC_CHANNELS.memory.EXPORT,
  RPC_CHANNELS.memory.IMPORT,
  RPC_CHANNELS.memory.CHANGED,
  RPC_CHANNELS.memory.GET_PROJECT_MEMORY,
  RPC_CHANNELS.memory.INSIGHTS,
  RPC_CHANNELS.memory.MARK_ONBOARDED,

  // skillsPending — pending skill approvals per workspace
  RPC_CHANNELS.skillsPending.LIST,
  RPC_CHANNELS.skillsPending.APPROVE,
  RPC_CHANNELS.skillsPending.DISMISS,
  RPC_CHANNELS.skillsPending.CHANGED,
  RPC_CHANNELS.skillsPending.DIFF,

  // credentials — remote server's credential state
  RPC_CHANNELS.credentials.HEALTH_CHECK,

  // llmConnections — LLM config lives on server running workspace
  RPC_CHANNELS.llmConnections.LIST,
  RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,
  RPC_CHANNELS.llmConnections.GET,
  RPC_CHANNELS.llmConnections.GET_API_KEY,
  RPC_CHANNELS.llmConnections.SAVE,
  RPC_CHANNELS.llmConnections.DELETE,
  RPC_CHANNELS.llmConnections.TEST,
  RPC_CHANNELS.llmConnections.SET_DEFAULT,
  RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT,
  RPC_CHANNELS.llmConnections.REFRESH_MODELS,
  RPC_CHANNELS.llmConnections.CHANGED,

  // chatgpt — OAuth via capability passthrough
  RPC_CHANNELS.chatgpt.START_OAUTH,
  RPC_CHANNELS.chatgpt.COMPLETE_OAUTH,
  RPC_CHANNELS.chatgpt.CANCEL_OAUTH,
  RPC_CHANNELS.chatgpt.GET_AUTH_STATUS,
  RPC_CHANNELS.chatgpt.LOGOUT,

  // copilot — OAuth via capability passthrough
  RPC_CHANNELS.copilot.START_OAUTH,
  RPC_CHANNELS.copilot.CANCEL_OAUTH,
  RPC_CHANNELS.copilot.GET_AUTH_STATUS,
  RPC_CHANNELS.copilot.LOGOUT,
  RPC_CHANNELS.copilot.DEVICE_CODE,

  // Claude OAuth — runs on workspace server so credentials and connection config
  // end up on the same server that will use them. Browser opening is client-side.
  // (ChatGPT OAuth stays LOCAL_ONLY — requires localhost callback server.)
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,

  // settings — workspace-level settings
  RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
  RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL,

  // pi — provider config on workspace server
  RPC_CHANNELS.pi.GET_API_KEY_PROVIDERS,
  RPC_CHANNELS.pi.GET_PROVIDER_BASE_URL,
  RPC_CHANNELS.pi.GET_PROVIDER_MODELS,

  // preferences — workspace-level preferences
  RPC_CHANNELS.preferences.READ,
  RPC_CHANNELS.preferences.WRITE,


  // drafts — workspace content
  RPC_CHANNELS.drafts.GET,
  RPC_CHANNELS.drafts.SET,
  RPC_CHANNELS.drafts.DELETE,
  RPC_CHANNELS.drafts.GET_ALL,

  // sources — source config per-workspace
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.UPDATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.CHANGED,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
  RPC_CHANNELS.sources.REINDEX,
  RPC_CHANNELS.sources.SEARCH,

  // oauth — OAuth state management
  RPC_CHANNELS.oauth.START,
  RPC_CHANNELS.oauth.COMPLETE,
  RPC_CHANNELS.oauth.CANCEL,
  RPC_CHANNELS.oauth.REVOKE,

  // workspace — workspace config + images (sharp on headless)
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.workspace.SETTINGS_GET,
  RPC_CHANNELS.workspace.SETTINGS_UPDATE,

  // permissions — workspace permissions
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.permissions.DEFAULTS_CHANGED,

  // skills — skill content per-workspace (not openEditor/openFinder which are local OS)
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.UPDATE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.IMPORT_OMP,
  RPC_CHANNELS.skills.GET_USAGE,
  RPC_CHANNELS.skills.PRUNE_UNUSED,
  RPC_CHANNELS.skills.EXPORT_TO_PROJECT,
  RPC_CHANNELS.skills.CHANGED,

  // statuses — workspace metadata
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.REORDER,
  RPC_CHANNELS.statuses.CHANGED,

  // OpenClaw — safe runtime/audit data for the workspace owner. Host control
  // remains direct Electron IPC and is intentionally absent from this table.
  RPC_CHANNELS.openclawRuntime.GET_STATUS,
  RPC_CHANNELS.openclawRuntime.INSTALL,
  RPC_CHANNELS.openclawRuntime.PROVISION,
  RPC_CHANNELS.openclawRuntime.START,
  RPC_CHANNELS.openclawRuntime.STOP,
  RPC_CHANNELS.securityAudit.RUN,
  RPC_CHANNELS.securityAudit.GET_LATEST,
  RPC_CHANNELS.securityAudit.ACCEPT_RISK,
  RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE,

  // labels — workspace metadata
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.DELETE,
  RPC_CHANNELS.labels.CHANGED,

  // views — workspace UI views
  RPC_CHANNELS.views.LIST,
  RPC_CHANNELS.views.SAVE,

  // toolIcons — workspace config
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,

  // logo — workspace config
  RPC_CHANNELS.logo.GET_URL,

  // automations — workspace automations
  RPC_CHANNELS.automations.GET,
  RPC_CHANNELS.automations.GET_GRAPH,
  RPC_CHANNELS.automations.SAVE_GRAPH,
  RPC_CHANNELS.automations.TEST,
  RPC_CHANNELS.automations.SET_ENABLED,
  RPC_CHANNELS.automations.DUPLICATE,
  RPC_CHANNELS.automations.DELETE,
  RPC_CHANNELS.automations.GET_HISTORY,
  RPC_CHANNELS.automations.GET_LAST_EXECUTED,
  RPC_CHANNELS.automations.REPLAY,
  RPC_CHANNELS.automations.CHANGED,

  // projects — workspace projects
  RPC_CHANNELS.projects.GET,
  RPC_CHANNELS.projects.GET_ONE,
  RPC_CHANNELS.projects.CREATE,
  RPC_CHANNELS.projects.UPDATE,
  RPC_CHANNELS.projects.DELETE,
  RPC_CHANNELS.projects.LIST_ASSETS,
  RPC_CHANNELS.projects.UPLOAD_ASSET,
  RPC_CHANNELS.projects.DELETE_ASSET,
  RPC_CHANNELS.projects.CHANGED,

  // kanban — workspace board config
  RPC_CHANNELS.kanban.GET_CONFIG,
  RPC_CHANNELS.kanban.SET_CONFIG,
  RPC_CHANNELS.kanban.CHANGED,

  // collection — workspace sessions collection display prefs
  RPC_CHANNELS.collection.GET_DISPLAY,
  RPC_CHANNELS.collection.SET_DISPLAY,
  RPC_CHANNELS.collection.CHANGED,

  // git — workspace filesystem
  RPC_CHANNELS.git.GET_BRANCH,

  // resources — workspace resource export/import
  RPC_CHANNELS.resources.EXPORT,
  RPC_CHANNELS.resources.IMPORT,

  // cloudRuns — background research runs execute on the workspace-owning server
  RPC_CHANNELS.cloudRuns.GET_CONFIG,
  RPC_CHANNELS.cloudRuns.SET_CONFIG,
  RPC_CHANNELS.cloudRuns.SUBMIT,
  RPC_CHANNELS.cloudRuns.RESUME,
  RPC_CHANNELS.cloudRuns.SESSION_TOPIC,
  RPC_CHANNELS.cloudRuns.READ_ARTIFACT,
  RPC_CHANNELS.cloudRuns.LIST,
  RPC_CHANNELS.cloudRuns.GET_STATUS,
  RPC_CHANNELS.cloudRuns.CANCEL,
  RPC_CHANNELS.cloudRuns.LIST_ARTIFACTS,
  RPC_CHANNELS.cloudRuns.IMPORT,
  RPC_CHANNELS.cloudRuns.AGGREGATE,
  RPC_CHANNELS.cloudRuns.LIST_SCHEDULES,
  RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE,
  RPC_CHANNELS.cloudRuns.DELETE_SCHEDULE,
  RPC_CHANNELS.cloudRuns.GET_EVENTS,
  RPC_CHANNELS.cloudRuns.SHARE,
  RPC_CHANNELS.cloudRuns.REVOKE_SHARE,

  // messaging — gateway channels run on workspace server
  RPC_CHANNELS.messaging.WA_REGISTER,
  RPC_CHANNELS.messaging.WA_INCOMING,
  RPC_CHANNELS.messaging.WA_BUTTON_PRESS,
  RPC_CHANNELS.messaging.WA_STATUS,
  RPC_CHANNELS.messaging.WA_QR,
  RPC_CHANNELS.messaging.WA_SEND,
  RPC_CHANNELS.messaging.WA_SEND_BUTTONS,
  RPC_CHANNELS.messaging.WA_SEND_TYPING,
  RPC_CHANNELS.messaging.WA_SEND_FILE,
  RPC_CHANNELS.messaging.WA_CONNECT,
  RPC_CHANNELS.messaging.WA_DISCONNECT,
  RPC_CHANNELS.messaging.BINDING_CHANGED,
  RPC_CHANNELS.messaging.PLATFORM_STATUS,
  RPC_CHANNELS.messaging.PENDING_CHANGED,
  RPC_CHANNELS.messaging.GET_CONFIG,
  RPC_CHANNELS.messaging.UPDATE_CONFIG,
  RPC_CHANNELS.messaging.TEST_TELEGRAM,
  RPC_CHANNELS.messaging.SAVE_TELEGRAM,
  RPC_CHANNELS.messaging.TEST_LARK,
  RPC_CHANNELS.messaging.SAVE_LARK,
  RPC_CHANNELS.messaging.TEST_DISCORD,
  RPC_CHANNELS.messaging.SAVE_DISCORD,
  RPC_CHANNELS.messaging.DISCONNECT,
  RPC_CHANNELS.messaging.FORGET,
  RPC_CHANNELS.messaging.GET_BINDINGS,
  RPC_CHANNELS.messaging.GENERATE_CODE,
  RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE,
  RPC_CHANNELS.messaging.GET_SUPERGROUP,
  RPC_CHANNELS.messaging.UNBIND_SUPERGROUP,
  RPC_CHANNELS.messaging.UNBIND,
  RPC_CHANNELS.messaging.UNBIND_BINDING,
  RPC_CHANNELS.messaging.WA_START_CONNECT,
  RPC_CHANNELS.messaging.WA_SUBMIT_PHONE,
  RPC_CHANNELS.messaging.WA_UI_EVENT,
  RPC_CHANNELS.messaging.WECHAT_START_CONNECT,
  RPC_CHANNELS.messaging.WECHAT_SUBMIT_CODE,
  RPC_CHANNELS.messaging.WECHAT_UI_EVENT,
  RPC_CHANNELS.messaging.WC_START_CONNECT,
  RPC_CHANNELS.messaging.WC_CANCEL_CONNECT,
  RPC_CHANNELS.messaging.WC_UI_EVENT,
  // messaging access control — UI ↔ Server, per-platform owners + per-binding allow-list
  RPC_CHANNELS.messaging.GET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.SET_PLATFORM_OWNERS,
  RPC_CHANNELS.messaging.GET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.SET_PLATFORM_ACCESS_MODE,
  RPC_CHANNELS.messaging.GET_PENDING_SENDERS,
  RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER,
  RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER,
  RPC_CHANNELS.messaging.SET_BINDING_ACCESS,
])

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function isLocalOnly(channel: string): boolean {
  return LOCAL_ONLY_CHANNELS.has(channel)
}

export function isRemoteEligible(channel: string): boolean {
  return REMOTE_ELIGIBLE_CHANNELS.has(channel)
}
