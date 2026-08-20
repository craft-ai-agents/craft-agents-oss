/**
 * Typed event map for server → client push channels.
 * Keys are channel string literals, values are argument tuples.
 */

import type { ThemeOverrides } from '../config/index'
import type { LoadedSource } from '../sources/types'
import type { LoadedSkill } from '../skills/types'
import type { LoadedProject } from '../projects/types'
import type { KanbanBoardConfig } from '../kanban/types'
import type { CollectionDisplay } from '../sessions/collection-display-storage'

import type { ToolStatus } from '../toolchain/types'
import { RPC_CHANNELS } from './channels'
import type {
  SessionEvent,
  UnreadSummary,
  UpdateInfo,
  BrowserInstanceInfo,
  DeepLinkNavigation,
  TaskGenerateResult,
  NoteChangedPayload,
  KnowledgeChangedPayload,
  SiyuanSurfaceState,
  ExtensionSurfaceState,
  SessionsBulkChangedEvent,
} from './dto'
import type { ExtensionsChangedPayload } from '../extensions/types'

/** Payload of marketplace:CHANGED — pushed after an install/update/remove completes. */
export interface MarketplaceChangedPayload {
  id: string
  action: 'installed' | 'updated' | 'removed'
  /** Pinned source ref when known (absent for remove-what-we-never-installed). */
  ref?: string
}

/** Payload of marketplace:progress — live install/update phases. */
export interface MarketplaceProgressPayload {
  id: string
  phase: 'clone' | 'verify' | 'install' | 'fetch' | 'collision'
  detail?: string
}

export interface BroadcastEventMap {
  // Session events (workspace-scoped via broadcastToWorkspace)
  [RPC_CHANNELS.sessions.EVENT]: [event: SessionEvent]
  [RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED]: [summary: UnreadSummary]
  [RPC_CHANNELS.sessions.FILES_CHANGED]: [sessionId: string]
  [RPC_CHANNELS.sessions.BULK_CHANGED]: [event: SessionsBulkChangedEvent]

  // Domain change broadcasts (global via broadcastToAll)
  [RPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: LoadedSource[]]
  [RPC_CHANNELS.labels.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.statuses.CHANGED]: [workspaceId: string]
  // Toolchain install progress (global, local toolchain)
  [RPC_CHANNELS.toolchain.STATUS_CHANGED]: [status: ToolStatus]
  [RPC_CHANNELS.automations.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.skills.CHANGED]: [workspaceId: string, skills: LoadedSkill[]]
  [RPC_CHANNELS.skillsPending.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.memory.CHANGED]: [workspaceId: string | null, scope: 'global' | 'workspace' | 'both']
  [RPC_CHANNELS.projects.CHANGED]: [workspaceId: string, projects: LoadedProject[]]
  [RPC_CHANNELS.kanban.CHANGED]: [workspaceId: string, config: KanbanBoardConfig]
  [RPC_CHANNELS.collection.CHANGED]: [workspaceId: string, display: CollectionDisplay]

  [RPC_CHANNELS.tasks.GENERATED]: [workspaceId: string, result: TaskGenerateResult]
  [RPC_CHANNELS.notes.CHANGED]: [payload: NoteChangedPayload]
  [RPC_CHANNELS.knowledge.CHANGED]: [payload: KnowledgeChangedPayload]
  [RPC_CHANNELS.llmConnections.CHANGED]: []
  [RPC_CHANNELS.identity.CHANGED]: []
  [RPC_CHANNELS.extensions.CHANGED]: [payload: ExtensionsChangedPayload]
  [RPC_CHANNELS.permissions.DEFAULTS_CHANGED]: [value: null]
  [RPC_CHANNELS.gamification.CHANGED]: [payload: {
    xp: number
    level: number
    balance: number | null
    progress: number
    xpIntoLevel: number
    xpForNext: number
    nextThreshold: number | null
  }]

  // Theme broadcasts (global)
  [RPC_CHANNELS.theme.APP_CHANGED]: [theme: ThemeOverrides | null]
  [RPC_CHANNELS.theme.SYSTEM_CHANGED]: [isDark: boolean]
  [RPC_CHANNELS.theme.PREFERENCES_CHANGED]: [preferences: { mode: string; colorTheme: string; font: string }]
  [RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED]: [data: { workspaceId: string; themeId: string | null }]

  // Update broadcasts (global)
  [RPC_CHANNELS.update.AVAILABLE]: [info: UpdateInfo]
  [RPC_CHANNELS.update.DOWNLOAD_PROGRESS]: [progress: number]

  // Badge broadcasts (global)
  [RPC_CHANNELS.badge.DRAW]: [data: { count: number; iconDataUrl: string }]
  [RPC_CHANNELS.badge.DRAW_WINDOWS]: [data: { count: number }]

  // Window events (per-window)
  [RPC_CHANNELS.window.FOCUS_STATE]: [isFocused: boolean]
  [RPC_CHANNELS.window.CLOSE_REQUESTED]: []

  // Browser pane events (global)
  [RPC_CHANNELS.browserPane.STATE_CHANGED]: [info: BrowserInstanceInfo]
  [RPC_CHANNELS.browserPane.REMOVED]: [id: string]
  [RPC_CHANNELS.browserPane.INTERACTED]: [id: string]

  // SiYuan engine surface events (global; workspace isolation renderer-side)
  [RPC_CHANNELS.siyuan.STATE_CHANGED]: [state: SiyuanSurfaceState]
  [RPC_CHANNELS.siyuan.REMOVED]: [id: string]

  // Extension UI surface events (global; workspace isolation renderer-side)
  [RPC_CHANNELS.extensionSurface.STATE_CHANGED]: [state: ExtensionSurfaceState]
  [RPC_CHANNELS.extensionSurface.REMOVED]: [id: string]

  // Navigation events (per-window)
  [RPC_CHANNELS.notification.NAVIGATE]: [data: { workspaceId: string; sessionId: string }]
  [RPC_CHANNELS.deeplink.NAVIGATE]: [navigation: DeepLinkNavigation]

  // Copilot device code event
  [RPC_CHANNELS.copilot.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]

  // Context documents broadcasts (global)
  [RPC_CHANNELS.contextDocs.CHANGED]: []

  // Bundled skill packs (global) — disabled list changed
  [RPC_CHANNELS.bundledSkills.CHANGED]: [payload: { disabled: string[] }]

  // Marketplace broadcasts (global) — pushed after an install/update/remove completes
  [RPC_CHANNELS.marketplace.PROGRESS]: [payload: MarketplaceProgressPayload]
  [RPC_CHANNELS.marketplace.CHANGED]: [payload: MarketplaceChangedPayload]

  // Menu events (per-window, no payload)
  [RPC_CHANNELS.menu.NEW_CHAT]: []
  [RPC_CHANNELS.menu.OPEN_SETTINGS]: []
  [RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS]: []
  [RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE]: []
  [RPC_CHANNELS.menu.TOGGLE_SIDEBAR]: []

  // Messaging gateway broadcasts
  [RPC_CHANNELS.messaging.BINDING_CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.messaging.PLATFORM_STATUS]: [workspaceId: string, platform: string, status: {
    platform: string
    configured: boolean
    connected: boolean
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
    identity?: string
    lastError?: string
    updatedAt: number
  }]
}
