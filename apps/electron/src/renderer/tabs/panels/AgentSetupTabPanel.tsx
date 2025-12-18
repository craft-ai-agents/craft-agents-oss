/**
 * AgentSetupTabPanel
 *
 * Multi-step agent authentication flow (placeholder for now).
 * TODO: Extract and adapt flow from AgentAuthDialog.
 */

import * as React from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Tab, AgentSetupTab } from '../types'

interface AgentSetupTabPanelProps {
  tab: Tab
}

export default function AgentSetupTabPanel({ tab }: AgentSetupTabPanelProps) {
  const setupTab = tab as AgentSetupTab

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">
          Agent setup flow coming soon. This will guide you through
          authenticating MCP servers and configuring API credentials for{' '}
          <span className="font-medium">{setupTab.agentId}</span>.
        </p>
      </div>
    </ScrollArea>
  )
}
