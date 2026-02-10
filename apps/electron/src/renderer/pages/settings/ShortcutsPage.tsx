/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'
import { useLocale } from '@/context/LocaleContext'

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
function getComponentSpecificSections(t: (key: any) => string): ShortcutSection[] {
  return [
    {
      title: t('settings.shortcuts.section.listNavigation'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('settings.shortcuts.navigateItems') },
        { keys: ['Home'], description: t('settings.shortcuts.goToFirst') },
        { keys: ['End'], description: t('settings.shortcuts.goToLast') },
      ],
    },
    {
      title: t('settings.shortcuts.section.sessionList'),
      shortcuts: [
        { keys: ['Enter'], description: t('settings.shortcuts.focusChatInput') },
        { keys: ['Right-click'], description: t('settings.shortcuts.openContextMenu') },
      ],
    },
    {
      title: t('settings.shortcuts.section.chatInput'),
      shortcuts: [
        { keys: ['Enter'], description: t('settings.shortcuts.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('settings.shortcuts.newLine') },
        { keys: ['Esc'], description: t('settings.shortcuts.closeDialog') },
      ],
    },
  ]
}

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
  const { t } = useLocale()
  const componentSections = getComponentSpecificSections(t)

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.shortcuts.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {/* Registry-driven sections */}
            {Object.entries(actionsByCategory).map(([category, actions]) => (
              <SettingsSection key={category} title={category}>
                <SettingsCard>
                  {actions.map(action => (
                    <ActionShortcutRow key={action.id} actionId={action.id as ActionId} />
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}

            {/* Component-specific sections */}
            {componentSections.map((section) => (
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
