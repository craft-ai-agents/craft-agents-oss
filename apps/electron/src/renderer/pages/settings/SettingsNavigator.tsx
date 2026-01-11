/**
 * SettingsNavigator
 *
 * Navigator panel content for settings. Displays a list of settings sections
 * (General, Shortcuts, Preferences) that can be selected to show in the details panel.
 */

import * as React from 'react'
import { Settings, Keyboard, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

interface SettingsNavigatorProps {
  /** Currently selected settings subpage */
  selectedSubpage: 'general' | 'shortcuts' | 'preferences'
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: 'general' | 'shortcuts' | 'preferences') => void
}

interface SettingsItem {
  id: 'general' | 'shortcuts' | 'preferences'
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const settingsItems: SettingsItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Appearance, billing, workspace settings',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Keyboard,
    description: 'Keyboard shortcuts reference',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: User,
    description: 'Your personal preferences',
  },
]

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
}: SettingsNavigatorProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="py-2">
          {settingsItems.map((item) => {
            const Icon = item.icon
            const isSelected = selectedSubpage === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSubpage(item.id)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors',
                  'hover:bg-foreground/5',
                  isSelected && 'bg-foreground/5'
                )}
              >
                <Icon
                  className={cn(
                    'w-4 h-4 mt-0.5 shrink-0',
                    isSelected ? 'text-foreground' : 'text-muted-foreground'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-sm font-medium block',
                      isSelected ? 'text-foreground' : 'text-foreground/80'
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground block mt-0.5 line-clamp-1">
                    {item.description}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
