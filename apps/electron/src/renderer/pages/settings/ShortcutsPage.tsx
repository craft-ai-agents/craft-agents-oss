/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import { useTranslation } from 'react-i18next'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'shortcuts',
}

export function getShortcutsLabels(t: (key: string) => string) {
  return [
    {
      title: t('settings:shortcuts.sections.global.title'),
      shortcuts: [
        { keys: ['cmdKey', '1'], description: t('settings:shortcuts.sections.global.focusSidebar') },
        { keys: ['cmdKey', '2'], description: t('settings:shortcuts.sections.global.focusSessionList') },
        { keys: ['cmdKey', '3'], description: t('settings:shortcuts.sections.global.focusChatInput') },
        { keys: ['cmdKey', 'N'], description: t('settings:shortcuts.sections.global.newChat') },
        { keys: ['cmdKey', 'B'], description: t('settings:shortcuts.sections.global.toggleSidebar') },
        { keys: ['cmdKey', ','], description: t('settings:shortcuts.sections.global.openSettings') },
      ],
    },
    {
      title: t('settings:shortcuts.sections.navigation.title'),
      shortcuts: [
        { keys: ['Tab'], description: t('settings:shortcuts.sections.navigation.moveNextZone') },
        { keys: ['Shift', 'Tab'], description: t('settings:shortcuts.sections.navigation.cyclePermissionMode') },
        { keys: ['←', '→'], description: t('settings:shortcuts.sections.navigation.moveBetweenZones') },
        { keys: ['↑', '↓'], description: t('settings:shortcuts.sections.navigation.navigateItems') },
        { keys: ['Home'], description: t('settings:shortcuts.sections.navigation.goToFirstItem') },
        { keys: ['End'], description: t('settings:shortcuts.sections.navigation.goToLastItem') },
        { keys: ['Esc'], description: t('settings:shortcuts.sections.navigation.closeDialog') },
      ],
    },
    {
      title: t('settings:shortcuts.sections.sessionList.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('settings:shortcuts.sections.sessionList.sessionFocusChatInput') },
        { keys: ['Delete'], description: t('settings:shortcuts.sections.sessionList.deleteSession') },
      ],
    },
    {
      title: t('settings:shortcuts.sections.chat.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('settings:shortcuts.sections.chat.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('settings:shortcuts.sections.chat.newLine') },
        { keys: ['cmdKey', 'Enter'], description: t('settings:shortcuts.sections.chat.sendMessageAlt') },
      ],
    },
  ]
}

const cmdKey = isMac ? '⌘' : 'Ctrl'



function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium font-sans bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  )
}

/**
 * Renders a shortcut row for an action from the registry
 */
function ActionShortcutRow({ actionId }: { actionId: ActionId }) {
  const { label, hotkey } = useActionLabel(actionId)

  if (!hotkey) return null

  // Split hotkey into individual keys for display
  // Mac: symbols are concatenated (⌘⇧N) - need smart splitting
  // Windows: separated by + (Ctrl+Shift+N) - split on +
  const keys = isMac
    ? hotkey.match(/[⌘⇧⌥←→]|Tab|Esc|./g) || []
    : hotkey.split('+')

  return (
    <SettingsRow label={label}>
      <div className="flex items-center gap-1">
        {keys.map((key, keyIndex) => (
          <Kbd key={keyIndex}>{key}</Kbd>
        ))}
      </div>
    </SettingsRow>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation(['settings'])
  const localizedSections = getShortcutsLabels(t).map((section) => ({
    title: section.title,
    shortcuts: section.shortcuts.map((shortcut) => ({
      ...shortcut,
      keys: shortcut.keys.map((key) => (key === 'cmdKey' ? cmdKey : key)),
    })),
  }))

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings:shortcuts.pageTitle')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {localizedSections.map((section) => (
              <SettingsSection key={section.title} title={section.title}>
                <SettingsCard>
                  {section.shortcuts.map((shortcut, index) => (
                    <SettingsRow key={index} label={shortcut.description}>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex}>{key}</Kbd>
                        ))}
                      </div>
                    </SettingsRow>
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
