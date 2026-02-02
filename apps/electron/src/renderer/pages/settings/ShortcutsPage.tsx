/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { useI18n } from '@/i18n'

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

const cmdKey = isMac ? '⌘' : 'Ctrl'

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  )
}

export default function ShortcutsPage() {
  const { t } = useI18n('settings')

  const sections: ShortcutSection[] = [
    {
      title: t('shortcuts.global.title'),
      shortcuts: [
        { keys: [cmdKey, '1'], description: t('shortcuts.global.focusSidebar') },
        { keys: [cmdKey, '2'], description: t('shortcuts.global.focusSessionList') },
        { keys: [cmdKey, '3'], description: t('shortcuts.global.focusChatInput') },
        { keys: [cmdKey, 'N'], description: t('shortcuts.global.newChat') },
        { keys: [cmdKey, 'B'], description: t('shortcuts.global.toggleSidebar') },
        { keys: [cmdKey, ','], description: t('shortcuts.global.openSettings') },
      ],
    },
    {
      title: t('shortcuts.navigation.title'),
      shortcuts: [
        { keys: ['Tab'], description: t('shortcuts.navigation.moveToNextZone') },
        { keys: ['Shift', 'Tab'], description: t('shortcuts.navigation.cyclePermissionMode') },
        { keys: ['←', '→'], description: t('shortcuts.navigation.moveBetweenZones') },
        { keys: ['↑', '↓'], description: t('shortcuts.navigation.navigateItems') },
        { keys: ['Home'], description: t('shortcuts.navigation.goToFirst') },
        { keys: ['End'], description: t('shortcuts.navigation.goToLast') },
        { keys: ['Esc'], description: t('shortcuts.navigation.closeDialog') },
      ],
    },
    {
      title: t('shortcuts.sessionList.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sessionList.focusChatInput') },
        { keys: ['Delete'], description: t('shortcuts.sessionList.deleteSession') },
      ],
    },
    {
      title: t('shortcuts.chat.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.chat.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.chat.newLine') },
        { keys: [cmdKey, 'Enter'], description: t('shortcuts.chat.sendMessageCmd') },
      ],
    },
  ]

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('shortcuts.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {sections.map((section) => (
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
