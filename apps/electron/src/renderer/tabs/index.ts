/**
 * Tab System Public Exports
 */

// Types
export type {
  TabType,
  TabBase,
  Tab,
  ChatTab,
  SettingsTab,
  ShortcutsTab,
  AgentInfoTab,
  AgentSetupTab,
  FileTab,
  BrowserTab,
  TabState,
  OpenChatTabOptions,
} from './types'

// Hook
export { useTabs } from './useTabs'

// Components
export { TabBar } from './TabBar'
export { TabContent } from './TabContent'
export { TabContainer } from './TabContainer'

// Atoms (for advanced use cases)
export {
  tabStateAtom,
  activeTabAtom,
  isTabBarVisibleAtom,
  openTabAtom,
  closeTabAtom,
  setActiveTabAtom,
  validateTabsAtom,
} from './atoms'
