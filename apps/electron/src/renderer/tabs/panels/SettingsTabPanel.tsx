/**
 * SettingsTabPanel
 *
 * Settings UI (placeholder for now).
 * TODO: Implement model selector, theme picker, preferences.
 */

import * as React from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Tab } from '../types'

interface SettingsTabPanelProps {
  tab: Tab
}

export default function SettingsTabPanel({ tab }: SettingsTabPanelProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">
          Settings panel coming soon. This will include model selection, theme
          preferences, and other configuration options.
        </p>
      </div>
    </ScrollArea>
  )
}
