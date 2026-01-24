import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'

/**
 * TerminalPage - Blank page for the terminal feature
 */
export default function TerminalPage() {
  return (
    <div className="flex flex-col h-full bg-background">
      <PanelHeader title="Terminal" />
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-foreground">Terminal</h2>
          <p className="text-sm max-w-xs">
            The terminal feature is coming soon. Work across your data sources through a powerful command-line interface.
          </p>
        </div>
      </div>
    </div>
  )
}
