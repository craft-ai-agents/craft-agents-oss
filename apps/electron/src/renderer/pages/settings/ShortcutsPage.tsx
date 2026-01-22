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
import { useTranslation } from '@/i18n'

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

const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toUpperCase().indexOf('MAC') >= 0
const cmdKey = isMac ? '⌘' : 'Ctrl'

const sections: ShortcutSection[] = [
  {
    title: 'shortcutsGlobal',
    shortcuts: [
      { keys: [cmdKey, '1'], description: 'shortcutFocusSidebar' },
      { keys: [cmdKey, '2'], description: 'shortcutFocusSessionList' },
      { keys: [cmdKey, '3'], description: 'shortcutFocusChatInput' },
      { keys: [cmdKey, 'N'], description: 'shortcutNewChat' },
      { keys: [cmdKey, 'B'], description: 'shortcutToggleSidebar' },
      { keys: [cmdKey, ','], description: 'shortcutOpenSettings' },
    ],
  },
  {
    title: 'shortcutsNavigation',
    shortcuts: [
      { keys: ['Tab'], description: 'shortcutMoveToNextZone' },
      { keys: ['Shift', 'Tab'], description: 'shortcutCyclePermissionMode' },
      { keys: ['←', '→'], description: 'shortcutMoveBetweenZones' },
      { keys: ['↑', '↓'], description: 'shortcutNavigateItems' },
      { keys: ['Home'], description: 'shortcutGoToFirstItem' },
      { keys: ['End'], description: 'shortcutGoToLastItem' },
      { keys: ['Esc'], description: 'shortcutCloseDialog' },
    ],
  },
  {
    title: 'shortcutsSessionList',
    shortcuts: [
      { keys: ['Enter'], description: 'shortcutFocusChatInputSession' },
      { keys: ['Delete'], description: 'shortcutDeleteSession' },
    ],
  },
  {
    title: 'shortcutsChat',
    shortcuts: [
      { keys: ['Enter'], description: 'shortcutSendMessage' },
      { keys: ['Shift', 'Enter'], description: 'shortcutNewLine' },
      { keys: [cmdKey, 'Enter'], description: 'shortcutSendMessageCmd' },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()
  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settingsShortcuts' as any)} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-6">
            {sections.map((section) => (
              <SettingsSection key={section.title} title={t(section.title as any)}>
                <SettingsCard>
                  {section.shortcuts.map((shortcut, index) => (
                    <SettingsRow key={index} label={t(shortcut.description as any)}>
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
