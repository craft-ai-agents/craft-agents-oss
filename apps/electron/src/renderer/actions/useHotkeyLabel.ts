import { useActionRegistry } from './registry'
import type { ActionId } from './definitions'
import { useTranslations } from '@/i18n'

/**
 * Get the display string for an action's hotkey.
 *
 * @example
 * const hotkey = useHotkeyLabel('app.newChat') // "⌘N" on Mac
 *
 * @example
 * // In a tooltip
 * <Tooltip content={`New Chat ${useHotkeyLabel('app.newChat')}`}>
 */
export function useHotkeyLabel(actionId: ActionId): string | null {
  const { getHotkeyDisplay } = useActionRegistry()
  return getHotkeyDisplay(actionId)
}

/**
 * Get the action label and hotkey for display.
 *
 * @example
 * const { label, hotkey } = useActionLabel('app.newChat')
 * // label: "New Chat", hotkey: "⌘N"
 */
export function useActionLabel(actionId: ActionId) {
  const { getAction, getHotkeyDisplay } = useActionRegistry()
  const { t } = useTranslations()
  const action = getAction(actionId)
  
  // 翻译逻辑：根据actionId映射到对应的翻译键
  let labelKey = ''
  let descriptionKey = ''
  
  switch (actionId) {
    case 'app.newChat':
      labelKey = 'actions.newChat'
      descriptionKey = 'actions.createANewChatSession'
      break
    case 'app.newChatInPanel':
      labelKey = 'actions.newChatInPanel'
      descriptionKey = 'actions.createANewChatSessionInANewPanel'
      break
    case 'app.settings':
      labelKey = 'common.settings'
      descriptionKey = 'actions.openApplicationSettings'
      break
    case 'app.toggleTheme':
      labelKey = 'actions.toggleTheme'
      descriptionKey = 'actions.switchBetweenLightAndDarkMode'
      break
    case 'app.search':
      labelKey = 'actions.search'
      descriptionKey = 'actions.openSearchPanel'
      break
    case 'app.keyboardShortcuts':
      labelKey = 'shortcuts.keyboardShortcuts'
      descriptionKey = 'actions.showKeyboardShortcutsReference'
      break
    case 'app.newWindow':
      labelKey = 'common.newWindow'
      descriptionKey = 'actions.openANewWindow'
      break
    case 'app.quit':
      labelKey = 'actions.quit'
      descriptionKey = 'actions.quitTheApplication'
      break
    case 'nav.focusSidebar':
      labelKey = 'actions.focusSidebar'
      break
    case 'nav.focusNavigator':
      labelKey = 'actions.focusNavigator'
      break
    case 'nav.focusChat':
      labelKey = 'actions.focusChat'
      break
    case 'nav.nextZone':
      labelKey = 'actions.focusNextZone'
      break
    case 'nav.goBack':
      labelKey = 'actions.goBack'
      descriptionKey = 'actions.navigateToPreviousSession'
      break
    case 'nav.goForward':
      labelKey = 'actions.goForward'
      descriptionKey = 'actions.navigateToNextSession'
      break
    case 'nav.goBackAlt':
      labelKey = 'actions.goBack'
      descriptionKey = 'actions.navigateToPreviousSessionArrowKey'
      break
    case 'nav.goForwardAlt':
      labelKey = 'actions.goForward'
      descriptionKey = 'actions.navigateToNextSessionArrowKey'
      break
    case 'view.toggleSidebar':
      labelKey = 'menu.toggleSidebar'
      break
    case 'view.toggleFocusMode':
      labelKey = 'menu.toggleFocusMode'
      descriptionKey = 'actions.hideBothSidebarsForDistractionFreeWork'
      break
    case 'navigator.selectAll':
      labelKey = 'menu.selectAll'
      break
    case 'navigator.clearSelection':
      labelKey = 'actions.clearSelection'
      break
    case 'panel.focusNext':
      labelKey = 'actions.focusNextPanel'
      descriptionKey = 'actions.moveFocusToTheNextPanel'
      break
    case 'panel.focusPrev':
      labelKey = 'actions.focusPreviousPanel'
      descriptionKey = 'actions.moveFocusToThePreviousPanel'
      break
    case 'chat.stopProcessing':
      labelKey = 'actions.stopProcessing'
      descriptionKey = 'actions.cancelTheCurrentAgentTaskDoublePress'
      break
    case 'chat.cyclePermissionMode':
      labelKey = 'actions.cyclePermissionMode'
      descriptionKey = 'actions.switchBetweenExploreAskAndExecuteModes'
      break
    case 'chat.nextSearchMatch':
      labelKey = 'actions.nextSearchMatch'
      break
    case 'chat.prevSearchMatch':
      labelKey = 'actions.previousSearchMatch'
      break
  }
  
  return {
    label: labelKey ? t(labelKey, action.label) : action.label,
    description: 'description' in action 
      ? (descriptionKey ? t(descriptionKey, action.description) : action.description)
      : undefined,
    hotkey: getHotkeyDisplay(actionId),
  }
}
