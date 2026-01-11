/**
 * Navigation Registry
 *
 * Type-safe registry that defines the relationships between navigators and details pages.
 * This ensures compile-time safety: you cannot add a page without registering it here,
 * and the app won't compile if relationships are incomplete.
 *
 * Structure:
 *   Navigator → Details Pages → Components
 *
 * Each navigator has:
 * - A list of valid details page types
 * - A default details page (or null for empty state)
 * - Logic to get the first item for auto-selection
 */

import type { ComponentType } from 'react'
import type { ChatFilter } from '../../shared/types'

// =============================================================================
// Types
// =============================================================================

/**
 * Props passed to navigator components
 */
export interface NavigatorProps {
  /** Called when a details item is selected */
  onSelectDetails: (detailsType: string, detailsId: string) => void
  /** Currently selected details */
  selectedDetails?: { type: string; id: string }
}

/**
 * Props passed to details page components
 */
export interface DetailsProps {
  /** The ID of the selected item */
  id: string
  /** Additional props specific to the page */
  [key: string]: unknown
}

/**
 * Context data available for navigation inference
 */
export interface NavigationData {
  /** All sessions in the current filter */
  sessions: Array<{ id: string; isFlagged?: boolean; isArchived?: boolean; agentId?: string; stateId?: string }>
  /** All sources */
  sources: Array<{ slug: string }>
  /** Current chat filter (if in chats mode) */
  chatFilter?: ChatFilter
}

/**
 * Configuration for a single navigator
 */
export interface NavigatorConfig<TDetailsPages extends Record<string, ComponentType<DetailsProps>>> {
  /** Display name for the navigator */
  displayName: string
  /** Valid details page types and their components */
  detailsPages: TDetailsPages
  /** Default details page when navigating to this navigator (null = allow empty state) */
  defaultDetails: (keyof TDetailsPages & string) | null
  /** Get the first item ID for auto-selection (returns null if empty) */
  getFirstItem: (context: NavigationData) => string | null
}

// =============================================================================
// Navigator Types
// =============================================================================

/**
 * All navigator types in the app
 */
export type NavigatorType = 'chats' | 'sources' | 'settings'

/**
 * Chat filter kinds that map to sidebar routes
 */
export type ChatFilterKind = 'inbox' | 'archive' | 'flagged' | 'agent' | 'state'

// =============================================================================
// Details Page Metadata
// =============================================================================

/**
 * Metadata that each details page should export
 * This helps with reverse lookups and validation
 */
export interface DetailsPageMeta {
  /** The navigator this page belongs to */
  navigator: NavigatorType
  /** The slug used in routes */
  slug: string
}

// =============================================================================
// Registry Definition
// =============================================================================

/**
 * Placeholder components - will be replaced with real imports
 * These ensure type safety during the transition
 */
const PlaceholderComponent: ComponentType<DetailsProps> = () => null

/**
 * The central navigation registry
 *
 * IMPORTANT: This object defines ALL valid navigation paths in the app.
 * Adding a new page requires:
 * 1. Creating the component
 * 2. Adding it to the appropriate navigator's detailsPages
 * 3. Exporting meta from the component
 */
export const NavigationRegistry = {
  chats: {
    displayName: 'Chats',
    detailsPages: {
      chat: PlaceholderComponent, // Will be: ChatPage
    },
    defaultDetails: null, // Empty state when no sessions
    getFirstItem: (ctx: NavigationData) => {
      if (!ctx.sessions.length) return null
      // Filter based on current chat filter
      const filter = ctx.chatFilter
      if (!filter) return ctx.sessions[0]?.id ?? null

      let filtered = ctx.sessions
      switch (filter.kind) {
        case 'flagged':
          filtered = ctx.sessions.filter(s => s.isFlagged)
          break
        case 'archive':
          filtered = ctx.sessions.filter(s => s.isArchived)
          break
        case 'agent':
          filtered = ctx.sessions.filter(s => s.agentId === filter.agentId)
          break
        case 'state':
          filtered = ctx.sessions.filter(s => s.stateId === filter.stateId)
          break
        case 'inbox':
        default:
          filtered = ctx.sessions.filter(s => !s.isArchived)
          break
      }
      return filtered[0]?.id ?? null
    },
  },

  sources: {
    displayName: 'Sources',
    detailsPages: {
      source: PlaceholderComponent, // Will be: SourceInfoPage
    },
    defaultDetails: null, // Empty state when no sources
    getFirstItem: (ctx: NavigationData) => ctx.sources[0]?.slug ?? null,
  },

  settings: {
    displayName: 'Settings',
    detailsPages: {
      general: PlaceholderComponent, // Will be: SettingsGeneralPage
      shortcuts: PlaceholderComponent, // Will be: ShortcutsPage
      preferences: PlaceholderComponent, // Will be: PreferencesPage
    },
    defaultDetails: 'general', // Always has a default
    getFirstItem: () => 'general',
  },
} as const satisfies Record<NavigatorType, NavigatorConfig<Record<string, ComponentType<DetailsProps>>>>

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extract details page types for a given navigator
 */
export type DetailsType<N extends NavigatorType> = keyof (typeof NavigationRegistry)[N]['detailsPages'] & string

/**
 * All possible details types across all navigators
 */
export type AnyDetailsType = DetailsType<'chats'> | DetailsType<'sources'> | DetailsType<'settings'>

// =============================================================================
// Navigation State Types
// =============================================================================

/**
 * Represents the full navigation state
 */
export type NavigationState =
  | { navigator: 'chats'; chatFilter: ChatFilter; details: { type: 'chat'; id: string } | null }
  | { navigator: 'sources'; details: { type: 'source'; id: string } | null }
  | { navigator: 'settings'; details: { type: DetailsType<'settings'>; id: string } }

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the navigator type for a given details page type
 */
export function getNavigatorForDetails(detailsType: string): NavigatorType | null {
  for (const [navigatorType, config] of Object.entries(NavigationRegistry)) {
    if (detailsType in config.detailsPages) {
      return navigatorType as NavigatorType
    }
  }
  return null
}

/**
 * Check if a details type is valid for a navigator
 */
export function isValidDetailsType(navigator: NavigatorType, detailsType: string): boolean {
  return detailsType in NavigationRegistry[navigator].detailsPages
}

/**
 * Get the default details for a navigator
 */
export function getDefaultDetails(navigator: NavigatorType): string | null {
  return NavigationRegistry[navigator].defaultDetails
}

/**
 * Get the first item for a navigator (for auto-selection)
 */
export function getFirstItem(navigator: NavigatorType, context: NavigationData): string | null {
  return NavigationRegistry[navigator].getFirstItem(context)
}

/**
 * Get all valid details types for a navigator
 */
export function getValidDetailsTypes(navigator: NavigatorType): string[] {
  return Object.keys(NavigationRegistry[navigator].detailsPages)
}

// =============================================================================
// Route Helpers
// =============================================================================

/**
 * Parse a compound route into navigation state
 * Format: {sidebar}[/{details-type}/{details-id}]
 *
 * Examples:
 *   'inbox' → chats navigator, inbox filter, no details
 *   'inbox/chat/abc123' → chats navigator, inbox filter, chat details
 *   'flagged/chat/abc123' → chats navigator, flagged filter, chat details
 *   'agent/my-agent/chat/abc123' → chats navigator, agent filter, chat details
 *   'sources' → sources navigator, no details
 *   'sources/source/github' → sources navigator, source details
 *   'settings' → settings navigator, general details (default)
 *   'settings/shortcuts' → settings navigator, shortcuts details
 */
export function parseCompoundRoute(route: string): NavigationState | null {
  const segments = route.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]

  // Settings navigator
  if (first === 'settings') {
    const detailsType = segments[1] || 'general'
    if (!isValidDetailsType('settings', detailsType)) return null
    return {
      navigator: 'settings',
      details: { type: detailsType as DetailsType<'settings'>, id: detailsType },
    }
  }

  // Sources navigator
  if (first === 'sources') {
    if (segments.length === 1) {
      return { navigator: 'sources', details: null }
    }
    if (segments[1] === 'source' && segments[2]) {
      return {
        navigator: 'sources',
        details: { type: 'source', id: segments[2] },
      }
    }
    return null
  }

  // Chats navigator (inbox, archive, flagged, agent, state)
  let chatFilter: ChatFilter
  let detailsStartIndex: number

  switch (first) {
    case 'inbox':
      chatFilter = { kind: 'inbox' }
      detailsStartIndex = 1
      break
    case 'archive':
      chatFilter = { kind: 'archive' }
      detailsStartIndex = 1
      break
    case 'flagged':
      chatFilter = { kind: 'flagged' }
      detailsStartIndex = 1
      break
    case 'agent':
      if (!segments[1]) return null
      chatFilter = { kind: 'agent', agentId: segments[1] }
      detailsStartIndex = 2
      break
    case 'state':
      if (!segments[1]) return null
      chatFilter = { kind: 'state', stateId: segments[1] as ChatFilter & { kind: 'state' } extends { stateId: infer T } ? T : never }
      detailsStartIndex = 2
      break
    default:
      return null
  }

  // Check for details
  if (segments.length > detailsStartIndex) {
    const detailsType = segments[detailsStartIndex]
    const detailsId = segments[detailsStartIndex + 1]
    if (detailsType === 'chat' && detailsId) {
      return {
        navigator: 'chats',
        chatFilter,
        details: { type: 'chat', id: detailsId },
      }
    }
  }

  return {
    navigator: 'chats',
    chatFilter,
    details: null,
  }
}

/**
 * Build a compound route from navigation state
 */
export function buildCompoundRoute(state: NavigationState): string {
  if (state.navigator === 'settings') {
    const detailsType = state.details?.type || 'general'
    return detailsType === 'general' ? 'settings' : `settings/${detailsType}`
  }

  if (state.navigator === 'sources') {
    if (!state.details) return 'sources'
    return `sources/source/${state.details.id}`
  }

  // Chats navigator
  let base: string
  switch (state.chatFilter.kind) {
    case 'inbox':
      base = 'inbox'
      break
    case 'archive':
      base = 'archive'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'agent':
      base = `agent/${state.chatFilter.agentId}`
      break
    case 'state':
      base = `state/${state.chatFilter.stateId}`
      break
    default:
      base = 'inbox'
  }

  if (!state.details) return base
  return `${base}/chat/${state.details.id}`
}
