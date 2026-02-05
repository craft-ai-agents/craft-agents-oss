import type { ActionDefinition } from './types'

export const actions = {
  // ═══════════════════════════════════════════
  // General
  // ═══════════════════════════════════════════
  'app.newChat': {
    id: 'app.newChat',
    label: 'New Chat',
    description: 'Create a new chat session',
    defaultHotkey: 'mod+n',
    category: 'General',
  },
  'app.settings': {
    id: 'app.settings',
    label: 'Settings',
    description: 'Open application settings',
    defaultHotkey: 'mod+,',
    category: 'General',
  },
  'app.toggleTheme': {
    id: 'app.toggleTheme',
    label: 'Toggle Theme',
    description: 'Switch between light and dark mode',
    defaultHotkey: 'mod+shift+a',
    category: 'General',
  },
  'app.search': {
    id: 'app.search',
    label: 'Search',
    description: 'Open search panel',
    defaultHotkey: 'mod+f',
    category: 'General',
  },
  'app.keyboardShortcuts': {
    id: 'app.keyboardShortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Show keyboard shortcuts reference',
    defaultHotkey: 'mod+/',
    category: 'General',
  },
  'app.newWindow': {
    id: 'app.newWindow',
    label: 'New Window',
    description: 'Open a new window',
    defaultHotkey: 'mod+shift+n',
    category: 'General',
  },
  'app.quit': {
    id: 'app.quit',
    label: 'Quit',
    description: 'Quit the application',
    defaultHotkey: 'mod+q',
    category: 'General',
  },

  // ═══════════════════════════════════════════
  // Navigation
  // ═══════════════════════════════════════════
  'nav.focusSidebar': {
    id: 'nav.focusSidebar',
    label: 'Focus Sidebar',
    defaultHotkey: 'mod+1',
    category: 'Navigation',
  },
  'nav.focusSessionList': {
    id: 'nav.focusSessionList',
    label: 'Focus Session List',
    defaultHotkey: 'mod+2',
    category: 'Navigation',
  },
  'nav.focusChat': {
    id: 'nav.focusChat',
    label: 'Focus Chat',
    defaultHotkey: 'mod+3',
    category: 'Navigation',
  },
  'nav.nextZone': {
    id: 'nav.nextZone',
    label: 'Focus Next Zone',
    defaultHotkey: 'tab',
    category: 'Navigation',
  },
  'nav.goBack': {
    id: 'nav.goBack',
    label: 'Go Back',
    description: 'Navigate to previous session',
    defaultHotkey: 'mod+[',
    category: 'Navigation',
  },
  'nav.goForward': {
    id: 'nav.goForward',
    label: 'Go Forward',
    description: 'Navigate to next session',
    defaultHotkey: 'mod+]',
    category: 'Navigation',
  },
  'nav.goBackAlt': {
    id: 'nav.goBackAlt',
    label: 'Go Back',
    description: 'Navigate to previous session (arrow key)',
    defaultHotkey: 'mod+left',
    category: 'Navigation',
  },
  'nav.goForwardAlt': {
    id: 'nav.goForwardAlt',
    label: 'Go Forward',
    description: 'Navigate to next session (arrow key)',
    defaultHotkey: 'mod+right',
    category: 'Navigation',
  },

  // ═══════════════════════════════════════════
  // View
  // ═══════════════════════════════════════════
  'view.toggleSidebar': {
    id: 'view.toggleSidebar',
    label: 'Toggle Sidebar',
    defaultHotkey: 'mod+b',
    category: 'View',
  },
  'view.toggleFocusMode': {
    id: 'view.toggleFocusMode',
    label: 'Toggle Focus Mode',
    description: 'Hide both sidebars for distraction-free work',
    defaultHotkey: 'mod+.',
    category: 'View',
  },

  // ═══════════════════════════════════════════
  // Session List (scoped)
  // ═══════════════════════════════════════════
  'sessionList.selectAll': {
    id: 'sessionList.selectAll',
    label: 'Select All Sessions',
    defaultHotkey: 'mod+a',
    category: 'Session List',
    scope: 'session-list',
  },
  'sessionList.clearSelection': {
    id: 'sessionList.clearSelection',
    label: 'Clear Selection',
    defaultHotkey: 'escape',
    category: 'Session List',
    scope: 'session-list',
    inputSafe: true,  // Works even when typing in search/chat input
  },

  // ═══════════════════════════════════════════
  // Chat
  // ═══════════════════════════════════════════
  'chat.stopProcessing': {
    id: 'chat.stopProcessing',
    label: 'Stop Processing',
    description: 'Cancel the current agent task (double-press)',
    defaultHotkey: 'escape',
    category: 'Chat',
    scope: 'chat',
    inputSafe: true,  // Must work while typing in chat input
  },
  'chat.cyclePermissionMode': {
    id: 'chat.cyclePermissionMode',
    label: 'Cycle Permission Mode',
    description: 'Switch between Explore, Ask, and Execute modes',
    defaultHotkey: 'shift+tab',
    category: 'Chat',
  },
  'chat.nextSearchMatch': {
    id: 'chat.nextSearchMatch',
    label: 'Next Search Match',
    defaultHotkey: 'mod+g',
    category: 'Chat',
    inputSafe: true,  // Must work while typing in search input
  },
  'chat.prevSearchMatch': {
    id: 'chat.prevSearchMatch',
    label: 'Previous Search Match',
    defaultHotkey: 'mod+shift+g',
    category: 'Chat',
    inputSafe: true,  // Must work while typing in search input
  },

} as const satisfies Record<string, ActionDefinition>

// Type-safe action IDs
export type ActionId = keyof typeof actions

// Get all actions as array (for shortcuts page)
export const actionList = Object.values(actions)

// Get actions by category (for organized display)
export const actionsByCategory = actionList.reduce((acc, action) => {
  if (!acc[action.category]) acc[action.category] = []
  acc[action.category].push(action)
  return acc
}, {} as Record<string, ActionDefinition[]>)
