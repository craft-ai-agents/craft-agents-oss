/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { isMac } from '@/lib/platform'

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

const cmdKey = isMac ? '⌘' : 'Ctrl'

const sections: ShortcutSection[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: [cmdKey, '1'], description: 'Focus sidebar' },
      { keys: [cmdKey, '2'], description: 'Focus session list' },
      { keys: [cmdKey, '3'], description: 'Focus chat input' },
      { keys: [cmdKey, 'N'], description: 'New chat' },
      { keys: [cmdKey, 'B'], description: 'Toggle sidebar' },
      { keys: [cmdKey, ','], description: 'Open settings' },
      { keys: [cmdKey, '/'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Tab'], description: 'Move to next zone' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous zone' },
      { keys: ['←', '→'], description: 'Move between zones (in lists)' },
      { keys: ['↑', '↓'], description: 'Navigate items in list' },
      { keys: ['Home'], description: 'Go to first item' },
      { keys: ['End'], description: 'Go to last item' },
      { keys: ['Esc'], description: 'Close dialog / blur input' },
    ],
  },
  {
    title: 'Session List',
    shortcuts: [
      { keys: ['Enter'], description: 'Focus chat input' },
      { keys: ['Delete'], description: 'Delete session' },
      { keys: ['R'], description: 'Rename session' },
      { keys: ['Right-click'], description: 'Open context menu' },
    ],
  },
  {
    title: 'Agent Tree',
    shortcuts: [
      { keys: ['←'], description: 'Collapse folder' },
      { keys: ['→'], description: 'Expand folder' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line' },
      { keys: [cmdKey, 'Enter'], description: 'Send message' },
      { keys: ['Esc'], description: 'Stop agent (when processing)' },
    ],
  },
]

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium bg-muted border border-border rounded shadow-sm ${className || ''}`}>
      {children}
    </kbd>
  )
}

export default function ShortcutsPage() {
  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Shortcuts" actions={<HeaderMenu route={routes.view.settings('shortcuts')} />} />
      <Separator />
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 pb-1.5 border-b border-border/50">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="group flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <div className="flex-1 mx-3 h-px bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_8px)] opacity-0 group-hover:opacity-15" />
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex} className="group-hover:bg-foreground/10 group-hover:border-foreground/20">{key}</Kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
