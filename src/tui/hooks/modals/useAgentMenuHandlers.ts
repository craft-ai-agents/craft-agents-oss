import { useCallback } from 'react';
import type { AgentAction } from '../../components/AgentMenu.tsx';
import type { SubAgentDefinition, McpServerConfig } from '../../../agents/types.ts';
import type { Message } from '../../components/Messages.tsx';
import { debug } from '../../utils/debug.ts';

/**
 * Tool group structure for agent info display
 */
export interface ToolGroup {
  name: string;
  tools: { name: string; description?: string }[];
}

/**
 * Result of agent action execution
 */
export interface AgentActionResult {
  /** Optional message to display */
  message?: { content: string; type: Message['type'] };
}

/**
 * Props for useAgentMenuHandlers hook
 */
export interface UseAgentMenuHandlersProps {
  closeModal: () => void;
  activateAgent: (name: string) => Promise<boolean | 'pending_auth'>;
  deactivateAgent: () => void;
  reloadAgent: () => Promise<boolean>;
  resetAgent: () => Promise<boolean>;
  refreshAgents: () => Promise<string[] | { error: string }>;
  fetchTools: () => Promise<ToolGroup[]>;
  triggerMcpAuth: () => void;
  triggerApiAuth: () => void;
  activeAgentName: string | null;
  activeAgentDefinition: SubAgentDefinition | null;
  activeAgentMcpServers: McpServerConfig[];
}

/**
 * Result of useAgentMenuHandlers hook
 */
export interface UseAgentMenuHandlersResult {
  /** Handle agent menu action */
  handleAgentAction: (action: AgentAction) => Promise<AgentActionResult>;
  /** Cancel agent menu */
  handleAgentMenuCancel: () => void;
}

/**
 * Hook that handles all agent menu actions.
 *
 * Extracts ~110 lines of agent menu handling logic from SessionContainer.
 * Mirrors the pattern used by useCommands.
 *
 * Usage:
 * ```tsx
 * const { handleAgentAction, handleAgentMenuCancel } = useAgentMenuHandlers({
 *   closeModal,
 *   activateAgent,
 *   deactivateAgent,
 *   // ...
 * });
 *
 * // In AgentMenu component
 * <AgentMenu
 *   onAction={handleAgentAction}
 *   onCancel={handleAgentMenuCancel}
 * />
 * ```
 */
export function useAgentMenuHandlers(props: UseAgentMenuHandlersProps): UseAgentMenuHandlersResult {
  const {
    closeModal,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    triggerMcpAuth,
    triggerApiAuth,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
  } = props;

  const handleAgentAction = useCallback(async (action: AgentAction): Promise<AgentActionResult> => {
    closeModal();

    switch (action.type) {
      case 'activate': {
        const result = await activateAgent(action.name);
        if (result === true) {
          // Message shown by activationComplete() in useAgent
          return {};
        } else if (result === 'pending_auth') {
          // Auth flow started
          return {};
        } else {
          return { message: { content: `Failed to activate agent: ${action.name}`, type: 'error' } };
        }
      }

      case 'clear':
        deactivateAgent();
        return { message: { content: 'Returned to main assistant', type: 'system' } };

      case 'reload': {
        if (!activeAgentName) return {};
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
        setTerminalProgressIndeterminate();
        try {
          const success = await reloadAgent();
          if (success) {
            return { message: { content: `Agent @${activeAgentName} instructions reloaded.`, type: 'system' } };
          } else {
            return { message: { content: `Failed to reload agent @${activeAgentName}`, type: 'error' } };
          }
        } finally {
          clearTerminalProgress();
        }
      }

      case 'reset': {
        if (!activeAgentName) return {};
        const agentToReset = activeAgentName;
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
        setTerminalProgressIndeterminate();
        try {
          const success = await resetAgent();
          if (success) {
            return { message: { content: `Agent @${agentToReset} reset. Select it again to restart setup.`, type: 'system' } };
          } else {
            return { message: { content: `Failed to reset agent @${agentToReset}`, type: 'error' } };
          }
        } finally {
          clearTerminalProgress();
        }
      }

      case 'refresh': {
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
        setTerminalProgressIndeterminate();
        try {
          const result = await refreshAgents();
          if ('error' in result) {
            return { message: { content: result.error, type: 'error' } };
          } else {
            const agentList = result.length > 0
              ? `Found ${result.length} agent${result.length === 1 ? '' : 's'}: ${result.map(a => `@${a}`).join(', ')}`
              : 'No agents found. Create an "Agents" folder in Craft with agent documents.';
            return { message: { content: agentList, type: 'system' } };
          }
        } finally {
          clearTerminalProgress();
        }
      }

      case 'info': {
        debug('[handleAgentAction.info] activeAgentName:', activeAgentName, 'mcpServers:', activeAgentMcpServers.length);
        if (activeAgentName && activeAgentDefinition) {
          let info = `**Active Agent**: @${activeAgentName}`;

          if (activeAgentDefinition.info && activeAgentDefinition.info.length > 0) {
            info += '\n\n**Info**';
            for (const msg of activeAgentDefinition.info) {
              info += `\nℹ ${msg}`;
            }
          }

          const toolGroups = await fetchTools();
          const agentToolGroups = toolGroups.filter(g => g.name !== 'Craft');
          for (const group of agentToolGroups) {
            info += `\n\n**${group.name}**`;
            if (group.tools.length > 0) {
              info += `: ${group.tools.map(t => t.name).join(', ')}`;
            } else {
              info += ': (no tools)';
            }
          }

          debug('[handleAgentAction.info] Adding message:', info);
          return { message: { content: info, type: 'assistant' } };
        } else {
          return { message: { content: 'No sub-agent active. Use @agentname to activate one.', type: 'system' } };
        }
      }

      case 'reauth':
        triggerMcpAuth();
        triggerApiAuth();
        return {};

      default:
        return {};
    }
  }, [
    closeModal,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    triggerMcpAuth,
    triggerApiAuth,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
  ]);

  const handleAgentMenuCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  return {
    handleAgentAction,
    handleAgentMenuCancel,
  };
}
