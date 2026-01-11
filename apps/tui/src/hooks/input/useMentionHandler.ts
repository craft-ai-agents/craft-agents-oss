import { useCallback } from 'react';
import { resolveAgentMention } from '../../utils/filtering.ts';
import { debug } from '@craft-agent/shared/utils';
import type { Message } from '../../components/Messages.tsx';

/**
 * Result of mention handling
 */
export interface MentionResult {
  /** Whether the mention was handled (false = not a mention, pass to message handler) */
  handled: boolean;
  /** Optional message to display */
  message?: { content: string; type: Message['type'] };
  /** Remaining text to send after agent activation (if any) */
  remainingText?: string;
}

/**
 * Props for useMentionHandler hook
 */
export interface UseMentionHandlerProps {
  availableAgents: string[];
  activateAgent: (name: string) => Promise<boolean | 'pending_auth'>;
  deactivateAgent: () => void;
  sendMessage: (text: string) => Promise<void>;
}

/**
 * Hook that handles @mention parsing and agent activation.
 *
 * Extracts ~40 lines of mention handling logic from SessionContainer.
 *
 * Usage:
 * ```tsx
 * const { handleMention } = useMentionHandler({
 *   availableAgents,
 *   activateAgent,
 *   deactivateAgent,
 *   sendMessage,
 * });
 *
 * // In submit handler
 * if (input.startsWith('@')) {
 *   const result = await handleMention(input);
 *   if (result.handled) {
 *     if (result.message) {
 *       addLocalMessage(result.message.content, result.message.type);
 *     }
 *     return;
 *   }
 * }
 * ```
 */
export function useMentionHandler(props: UseMentionHandlerProps) {
  const { availableAgents, activateAgent, deactivateAgent, sendMessage } = props;

  const handleMention = useCallback(async (input: string): Promise<MentionResult> => {
    if (!input.startsWith('@')) {
      return { handled: false };
    }

    const [mentionInput, ...rest] = input.slice(1).split(/\s+/);

    debug('[useMentionHandler] @mention input:', mentionInput);
    debug('[useMentionHandler] availableAgents:', availableAgents);

    // Just "@" - show available agents
    if (!mentionInput) {
      const agentList = availableAgents.length > 0
        ? availableAgents.map(a => `@${a}`).join(', ')
        : 'No agents available';
      return {
        handled: true,
        message: { content: `Available agents: ${agentList}. Type @<name> to activate.`, type: 'info' },
      };
    }

    const resolvedAgent = resolveAgentMention(mentionInput, availableAgents);
    debug('[useMentionHandler] resolvedAgent:', resolvedAgent);

    // @main - return to main assistant
    if (resolvedAgent === 'main') {
      deactivateAgent();
      return {
        handled: true,
        message: { content: 'Returned to main assistant', type: 'system' },
      };
    }

    // @agent - show available agents
    if (resolvedAgent === 'agent') {
      const agentList = availableAgents.length > 0
        ? availableAgents.map(a => `@${a}`).join(', ')
        : 'No agents available';
      return {
        handled: true,
        message: { content: `Available agents: ${agentList}. Type @<name> to activate.`, type: 'info' },
      };
    }

    // @<agent-name> - activate agent
    if (resolvedAgent) {
      const activated = await activateAgent(resolvedAgent);
      if (activated) {
        const remainingText = rest.join(' ').trim();
        if (remainingText) {
          // Send remaining text as message to the newly activated agent
          await sendMessage(remainingText);
        }
        return { handled: true };
      }
      return {
        handled: true,
        message: { content: `Agent not found: @${resolvedAgent}`, type: 'error' },
      };
    }

    // Agent not found
    return {
      handled: true,
      message: { content: `Agent not found: @${mentionInput}`, type: 'error' },
    };
  }, [availableAgents, activateAgent, deactivateAgent, sendMessage]);

  return { handleMention };
}
