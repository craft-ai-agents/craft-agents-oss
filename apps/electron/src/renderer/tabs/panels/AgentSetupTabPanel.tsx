/**
 * AgentSetupTabPanel
 *
 * Multi-step agent setup flow in a tab.
 * Uses useAgentSetup hook for agent-scoped setup (no session required).
 * Session is created only when user clicks "Start Chat".
 */

import * as React from 'react'
import { useEffect } from 'react'
import type { Tab, AgentSetupTab } from '../types'
import { useTabs } from '../useTabs'
import { useAgentSetup, type SetupStep } from '../../hooks/useAgentSetup'
import {
  AgentSetupWizard,
  type AgentSetupState,
  type AgentSetupStep,
} from '../../components/agent-setup'

interface AgentSetupTabPanelProps {
  tab: Tab
}

/**
 * Map hook step to wizard step
 */
function mapToWizardStep(step: SetupStep): AgentSetupStep {
  switch (step) {
    case 'idle':
    case 'extracting':
      return 'extracting'
    case 'review':
      return 'review'
    case 'mcp-auth':
      return 'mcp-auth'
    case 'api-auth':
      return 'api-auth'
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    default:
      return 'extracting'
  }
}

export default function AgentSetupTabPanel({ tab }: AgentSetupTabPanelProps) {
  const setupTab = tab as AgentSetupTab
  const { workspaceId, agentId } = setupTab

  const setup = useAgentSetup(workspaceId, agentId)
  const { openChatTab, closeTab } = useTabs()

  // Auto-start setup on mount
  useEffect(() => {
    if (setup.step === 'idle') {
      setup.startSetup()
    }
  }, [setup.step, setup.startSetup])

  // Build wizard state from hook
  const wizardState: AgentSetupState = {
    step: mapToWizardStep(setup.step),
    agentId,
    agentName: setup.definition?.name || agentId.split('/').pop() || agentId,
    extractionMessage: setup.extractionMessage || undefined,
    concerns: setup.concerns,
    mcpServers: setup.mcpServers,
    mcpServerStatus: setup.mcpServerStatus,
    apis: setup.apis,
    apiStatus: setup.apiStatus,
    capabilities: setup.definition?.capabilities || [],
    errorMessage: setup.errorMessage || undefined,
    isLoading: setup.isLoading,
  }

  // Handle "Start Chat" - create session and switch to chat tab
  const handleStartChat = async () => {
    try {
      const session = await window.electronAPI.createSession(
        workspaceId,
        agentId,
        setup.definition?.name
      )
      // Open chat tab with the new session
      openChatTab(
        session.id,
        workspaceId,
        session.name || setup.definition?.name || 'New Chat',
        agentId
      )
      // Close setup tab
      closeTab(tab.id)
    } catch (error) {
      console.error('[AgentSetupTabPanel] Error creating session:', error)
    }
  }

  // Handle close/cancel
  const handleClose = () => {
    closeTab(tab.id)
  }

  return (
    <div className="h-full overflow-hidden">
      <AgentSetupWizard
        state={wizardState}
        onCancel={handleClose}
        onBack={handleClose}
        onSubmitReview={setup.submitReview}
        onStartMcpOAuth={setup.startMcpOAuth}
        onSubmitMcpBearer={setup.submitMcpBearer}
        onSkipMcpServer={setup.skipMcpServer}
        onMcpAuthComplete={setup.completeMcpAuth}
        onSubmitApiCredentials={setup.submitApiCredentials}
        onSkipApi={setup.skipApi}
        onApiAuthComplete={setup.completeApiAuth}
        onActivate={handleStartChat}
        onRetry={setup.retry}
        onStartChat={handleStartChat}
        onClose={handleClose}
        className="h-full"
      />
    </div>
  )
}
