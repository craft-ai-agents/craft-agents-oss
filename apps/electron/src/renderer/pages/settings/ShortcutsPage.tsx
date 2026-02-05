/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'shortcuts',
}

interface ShortcutItem {
  keys: string[]
  descriptionKey: string
}

interface ShortcutSection {
  titleKey: string
  shortcuts: ShortcutItem[]
}

const cmdKey = isMac ? '⌘' : 'Ctrl'

const sections: ShortcutSection[] = [
  {
    titleKey: 'shortcutsSettings.global',
    shortcuts: [
      { keys: [cmdKey, '1'], descriptionKey: 'shortcutsSettings.focusSidebar' },
      { keys: [cmdKey, '2'], descriptionKey: 'shortcutsSettings.focusSessionList' },
      { keys: [cmdKey, '3'], descriptionKey: 'shortcutsSettings.focusChatInput' },
      { keys: [cmdKey, 'N'], descriptionKey: 'shortcutsSettings.newChat' },
      { keys: [cmdKey, 'B'], descriptionKey: 'shortcutsSettings.toggleSidebar' },
      { keys: [cmdKey, ','], descriptionKey: 'shortcutsSettings.openSettings' },
    ],
  },
  {
    titleKey: 'shortcutsSettings.navigation',
    shortcuts: [
      { keys: ['Tab'], descriptionKey: 'shortcutsSettings.moveToNextZone' },
      { keys: ['Shift', 'Tab'], descriptionKey: 'shortcutsSettings.cyclePermissionMode' },
      { keys: ['←', '→'], descriptionKey: 'shortcutsSettings.moveBetweenZones' },
      { keys: ['↑', '↓'], descriptionKey: 'shortcutsSettings.navigateItems' },
      { keys: ['Home'], descriptionKey: 'shortcutsSettings.goToFirst' },
      { keys: ['End'], descriptionKey: 'shortcutsSettings.goToLast' },
      { keys: ['Esc'], descriptionKey: 'shortcutsSettings.closeDialogBlur' },
    ],
  },
  {
    titleKey: 'shortcutsSettings.sessionList',
    shortcuts: [
      { keys: ['Enter'], descriptionKey: 'shortcutsSettings.focusChatInputFromList' },
      { keys: ['Delete'], descriptionKey: 'shortcutsSettings.deleteSession' },
    ],
  },
  {
    titleKey: 'shortcutsSettings.chat',
    shortcuts: [
      { keys: ['Enter'], descriptionKey: 'shortcutsSettings.sendMessage' },
      { keys: ['Shift', 'Enter'], descriptionKey: 'shortcutsSettings.newLine' },
      { keys: [cmdKey, 'Enter'], descriptionKey: 'shortcutsSettings.sendMessage' },
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
      <PanelHeader title={t('shortcutsSettings.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {sections.map((section) => (
              <SettingsSection key={section.titleKey} title={t(section.titleKey)}>
                <SettingsCard>
                  {section.shortcuts.map((shortcut, index) => (
                    <SettingsRow key={index} label={t(shortcut.descriptionKey)}>
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
