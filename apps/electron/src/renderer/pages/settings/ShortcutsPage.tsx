/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsPage, SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'shortcuts',
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

// Component-specific shortcuts that aren't in the centralized registry
function useComponentSpecificSections(): ShortcutSection[] {
  const { t } = useTranslation()
  return [
    {
      title: t('shortcuts.listNavigation'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('shortcuts.navigateItems') },
        { keys: ['Home'], description: t('shortcuts.goToFirst') },
        { keys: ['End'], description: t('shortcuts.goToLast') },
      ],
    },
    {
      title: t('shortcuts.sessionList'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.focusChatInput') },
        { keys: ['Right-click'], description: t('shortcuts.openContextMenu') },
        { keys: [isMac ? '⌥' : 'Alt', 'Click'], description: t('shortcuts.addFilterExcluded') },
      ],
    },
    {
      title: t('shortcuts.chatInput'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.newLine') },
        { keys: ['Esc'], description: t('shortcuts.closeDialogBlur') },
      ],
    },
  ]
}

/** Single-line key rows are denser than setting rows (44px instead of 56px). */
const SHORTCUT_ROW_CLASS = 'min-h-11 py-2'

/**
 * Renders a shortcut row for an action from the registry
 */
// Map action IDs to i18n keys for translated labels
const ACTION_LABEL_KEYS: Partial<Record<ActionId, string>> = {
  'app.newChat': 'shortcuts.action.newChat',
  'app.newChatInPanel': 'shortcuts.action.newChatInPanel',
  'app.settings': 'shortcuts.action.settings',
  'app.toggleTheme': 'shortcuts.action.toggleTheme',
  'app.search': 'shortcuts.action.search',
  'app.keyboardShortcuts': 'shortcuts.action.keyboardShortcuts',
  'app.newWindow': 'shortcuts.action.newWindow',
  'app.quit': 'shortcuts.action.quit',
  'nav.focusSidebar': 'shortcuts.action.focusSidebar',
  'nav.focusNavigator': 'shortcuts.action.focusNavigator',
  'nav.focusChat': 'shortcuts.action.focusChat',
  'nav.nextZone': 'shortcuts.action.focusNextZone',
  'nav.previousChat': 'shortcuts.action.previousChat',
  'nav.nextChat': 'shortcuts.action.nextChat',
  'nav.goBack': 'shortcuts.action.goBack',
  'nav.goForward': 'shortcuts.action.goForward',
  'nav.goBackAlt': 'shortcuts.action.goBack',
  'nav.goForwardAlt': 'shortcuts.action.goForward',
  'view.toggleSidebar': 'shortcuts.action.toggleSidebar',
  'view.toggleFocusMode': 'shortcuts.action.toggleFocusMode',
  'navigator.selectAll': 'shortcuts.action.selectAll',
  'navigator.clearSelection': 'shortcuts.action.clearSelection',
  'panel.focusNext': 'shortcuts.action.focusNextPanel',
  'panel.focusPrev': 'shortcuts.action.focusPrevPanel',
  'chat.stopProcessing': 'shortcuts.action.stopProcessing',
  'chat.cyclePermissionMode': 'shortcuts.action.cyclePermissionMode',
  'chat.nextSearchMatch': 'shortcuts.action.nextSearchMatch',
  'chat.prevSearchMatch': 'shortcuts.action.prevSearchMatch',
}

function ActionShortcutRow({ actionId }: { actionId: ActionId }) {
  const { t } = useTranslation()
  const { label, hotkey } = useActionLabel(actionId)

  if (!hotkey) return null

  // Split hotkey into individual keys for display
  // Mac: symbols are concatenated (⌘⇧N) - need smart splitting
  // Windows: separated by + (Ctrl+Shift+N) - split on +
  const keys = isMac
    ? hotkey.match(/[⌘⇧⌥←→]|Tab|Esc|./g) || []
    : hotkey.split('+')

  return (
    <SettingsRow label={ACTION_LABEL_KEYS[actionId] ? t(ACTION_LABEL_KEYS[actionId]!) : label} className={SHORTCUT_ROW_CLASS}>
      <KbdGroup>
        {keys.map((key, keyIndex) => (
          <Kbd key={keyIndex}>{key}</Kbd>
        ))}
      </KbdGroup>
    </SettingsRow>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()
  const componentSpecificSections = useComponentSpecificSections()
  return (
    <SettingsPage title={t("settings.shortcuts.title")} description={t("settings.shortcuts.description")}>
      {/* Registry-driven sections */}
      {Object.entries(actionsByCategory).map(([category, actions]) => (
        <SettingsSection key={category} title={t(`shortcuts.category.${category.toLowerCase()}`)}>
          <SettingsCard>
            {actions.map(action => (
              <ActionShortcutRow key={action.id} actionId={action.id as ActionId} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}

      {/* Component-specific sections */}
      {componentSpecificSections.map((section) => (
        <SettingsSection key={section.title} title={section.title}>
          <SettingsCard>
            {section.shortcuts.map((shortcut, index) => (
              <SettingsRow key={index} label={shortcut.description} className={SHORTCUT_ROW_CLASS}>
                <KbdGroup>
                  {shortcut.keys.map((key, keyIndex) => (
                    <Kbd key={keyIndex}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}
    </SettingsPage>
  )
}
