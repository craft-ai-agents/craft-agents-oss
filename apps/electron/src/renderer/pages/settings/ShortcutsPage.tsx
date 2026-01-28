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
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('settings')

  const sections: ShortcutSection[] = [
    {
      title: t('shortcuts.sections.global.title'),
      shortcuts: [
        { keys: [cmdKey, '1'], description: t('shortcuts.sections.global.items.focusSidebar') },
        { keys: [cmdKey, '2'], description: t('shortcuts.sections.global.items.focusSessionList') },
        { keys: [cmdKey, '3'], description: t('shortcuts.sections.global.items.focusChatInput') },
        { keys: [cmdKey, 'N'], description: t('shortcuts.sections.global.items.newChat') },
        { keys: [cmdKey, 'B'], description: t('shortcuts.sections.global.items.toggleSidebar') },
        { keys: [cmdKey, ','], description: t('shortcuts.sections.global.items.openSettings') },
      ],
    },
    {
      title: t('shortcuts.sections.navigation.title'),
      shortcuts: [
        { keys: ['Tab'], description: t('shortcuts.sections.navigation.items.nextZone') },
        { keys: ['Shift', 'Tab'], description: t('shortcuts.sections.navigation.items.cyclePermissionMode') },
        { keys: ['←', '→'], description: t('shortcuts.sections.navigation.items.moveBetweenZones') },
        { keys: ['↑', '↓'], description: t('shortcuts.sections.navigation.items.navigateList') },
        { keys: ['Home'], description: t('shortcuts.sections.navigation.items.firstItem') },
        { keys: ['End'], description: t('shortcuts.sections.navigation.items.lastItem') },
        { keys: ['Esc'], description: t('shortcuts.sections.navigation.items.closeDialog') },
      ],
    },
    {
      title: t('shortcuts.sections.sessionList.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sections.sessionList.items.focusChatInput') },
        { keys: ['Delete'], description: t('shortcuts.sections.sessionList.items.deleteSession') },
      ],
    },
    {
      title: t('shortcuts.sections.chat.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sections.chat.items.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.sections.chat.items.newLine') },
        { keys: [cmdKey, 'Enter'], description: t('shortcuts.sections.chat.items.sendMessage') },
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
