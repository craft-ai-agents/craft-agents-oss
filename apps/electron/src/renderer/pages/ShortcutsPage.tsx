/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { isMac } from '@/lib/platform'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'

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
      title: t('shortcuts.agentTree'),
      shortcuts: [
        { keys: ['←'], description: t('shortcuts.collapseFolder') },
        { keys: ['→'], description: t('shortcuts.expandFolder') },
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

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-[6px] border border-white/[0.08] bg-white/[0.055] px-1.5 font-sans text-[11px] font-medium text-white/68 ${className || ''}`}>
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
    <div className="group flex items-center justify-between py-1.5">
      <span className="text-sm text-white/72">{label}</span>
      <div className="mx-3 h-px flex-1 bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_8px)] text-white opacity-0 group-hover:opacity-15" />
      <div className="flex items-center gap-1">
        {keys.map((key, keyIndex) => (
          <Kbd key={keyIndex} className="group-hover:border-white/[0.14] group-hover:bg-white/[0.085]">{key}</Kbd>
        ))}
      </div>
    </div>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()
  const componentSpecificSections = useComponentSpecificSections()

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6">
          <h1 className="runneros-page-title">{t("shortcuts.title")}</h1>
          <p className="runneros-page-subtitle">Keyboard commands for moving through RunnerOS quickly.</p>
        </div>
        <div className="runneros-card p-4">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Registry-driven sections */}
            {Object.entries(actionsByCategory).map(([category, actions]) => (
              <div key={category}>
                <h3 className="mb-2 border-b border-white/[0.07] pb-1.5 text-xs font-semibold uppercase tracking-wide text-white/45">
                  {category}
                </h3>
                <div className="space-y-0.5">
                  {actions.map(action => (
                    <ActionShortcutRow key={action.id} actionId={action.id as ActionId} />
                  ))}
                </div>
              </div>
            ))}

            {/* Component-specific sections */}
            {componentSpecificSections.map((section) => (
              <div key={section.title}>
                <h3 className="mb-2 border-b border-white/[0.07] pb-1.5 text-xs font-semibold uppercase tracking-wide text-white/45">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="group flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm text-white/72">{shortcut.description}</span>
                      <div className="mx-3 h-px flex-1 bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_8px)] text-white opacity-0 group-hover:opacity-15" />
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex} className="group-hover:border-white/[0.14] group-hover:bg-white/[0.085]">{key}</Kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
