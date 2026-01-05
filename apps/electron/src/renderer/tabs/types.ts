/**
 * Tab System Types
 *
 * Defines the data model for the tabbed panel system.
 * Each tab type has specific fields relevant to its content.
 */

export type TabType =
  | 'chat'
  | 'settings'
  | 'shortcuts'
  | 'agent-info'
  | 'file'
  | 'browser'
  | 'preferences'
  | 'source-info'

/**
 * Base interface for all tab types
 */
export interface TabBase {
  /** Unique identifier (e.g., "chat:session-123", "settings") */
  id: string
  /** Tab type for component mapping */
  type: TabType
  /** Display label in tab bar */
  label: string
  /** Whether the tab can be closed */
  closable: boolean
  /** Has unsaved changes (for future use) */
  dirty?: boolean
}

/**
 * Chat tab - displays a conversation session
 */
export interface ChatTab extends TabBase {
  type: 'chat'
  sessionId: string
  workspaceId: string
  agentId?: string
}

/**
 * Settings tab - singleton for app configuration
 * Contains both global settings (Appearance, Billing) and
 * workspace settings (Model, Permission Mode, Working Directory, Credential Strategy)
 */
export interface SettingsTab extends TabBase {
  type: 'settings'
}

/**
 * Keyboard shortcuts tab - singleton reference guide
 */
export interface ShortcutsTab extends TabBase {
  type: 'shortcuts'
}

/**
 * Agent info tab - displays agent definition details
 */
export interface AgentInfoTab extends TabBase {
  type: 'agent-info'
  agentId: string
  workspaceId: string
}

/**
 * File viewer tab - displays file contents
 */
export interface FileTab extends TabBase {
  type: 'file'
  path: string
}

/**
 * Browser tab - displays web content
 */
export interface BrowserTab extends TabBase {
  type: 'browser'
  url: string
}

/**
 * Preferences tab - edits user preferences file (singleton)
 */
export interface PreferencesTab extends TabBase {
  type: 'preferences'
}

/**
 * Source info tab - displays source details (view-only)
 */
export interface SourceInfoTab extends TabBase {
  type: 'source-info'
  sourceSlug: string
  workspaceId: string
  /** If this is an agent-scoped source */
  agentSlug?: string
}

/**
 * Union type of all tab types
 */
export type Tab =
  | ChatTab
  | SettingsTab
  | ShortcutsTab
  | AgentInfoTab
  | FileTab
  | BrowserTab
  | PreferencesTab
  | SourceInfoTab

/**
 * Tab state stored in Jotai atom
 */
export interface TabState {
  /** Ordered list of open tabs */
  tabs: Tab[]
  /** Currently active tab ID */
  activeTabId: string
}

/**
 * Options for opening a chat tab
 */
export interface OpenChatTabOptions {
  /** Force opening a new tab even if session already has one */
  forceNew?: boolean
  /** Pre-fill the chat input with this text (not sent automatically) */
  initialInput?: string
}

/**
 * Tab definition for the registry
 */
export interface TabDefinition {
  type: TabType
  /** Whether only one instance can exist */
  singleton: boolean
  /** Default closable state */
  defaultClosable: boolean
}

/**
 * Registry of tab type definitions
 */
export const TAB_DEFINITIONS: Record<TabType, TabDefinition> = {
  chat: {
    type: 'chat',
    singleton: false,
    defaultClosable: true,
  },
  settings: {
    type: 'settings',
    singleton: true,
    defaultClosable: true,
  },
  shortcuts: {
    type: 'shortcuts',
    singleton: true,
    defaultClosable: true,
  },
  'agent-info': {
    type: 'agent-info',
    singleton: false,
    defaultClosable: true,
  },
  file: {
    type: 'file',
    singleton: false,
    defaultClosable: true,
  },
  browser: {
    type: 'browser',
    singleton: false,
    defaultClosable: true,
  },
  preferences: {
    type: 'preferences',
    singleton: true,
    defaultClosable: true,
  },
  'source-info': {
    type: 'source-info',
    singleton: false,
    defaultClosable: true,
  },
}
