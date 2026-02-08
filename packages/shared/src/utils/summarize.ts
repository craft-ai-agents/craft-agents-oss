/**
 * Shared summarization utility for large tool results.
 * Uses Claude Haiku for fast, cost-effective summarization.
 *
 * Uses Agent SDK query() for proper OAuth token handling (same pattern as title-generator.ts).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { getDefaultSummarizationModel } from '../config/models.ts';

import { debug } from './debug.ts';

// Token limit for summarization trigger (roughly ~60KB of text)
export const TOKEN_LIMIT = 15000;

// Max tokens to send to Haiku for summarization (~400KB, Haiku handles this quickly)
// Beyond this, even Haiku can't process - we save to file and provide reference only
export const MAX_SUMMARIZATION_INPUT = 100000;

/**
 * Reset the cached summarization client.
 * @deprecated No longer needed - SDK query() handles auth automatically.
 * Kept for backwards compatibility.
 */
export function resetSummarizationClient(): void {
  // No-op: SDK query() handles auth automatically via getDefaultOptions()
  debug('[summarize] resetSummarizationClient called (no-op with SDK query)');
}

/**
 * Estimate token count from text length (rough approximation: 4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Context for summarization - helps Haiku extract relevant information
 */
export interface SummarizationContext {
  /** Tool or API name */
  toolName: string;
  /** Optional endpoint/path for API calls */
  path?: string;
  /** Tool input parameters */
  input?: Record<string, unknown>;
  /** The model's stated intent/reasoning before calling the tool (most specific) */
  modelIntent?: string;
  /** The user's original request (fallback context) */
  userRequest?: string;
  /** Optional model override (use connection default when available) */
  modelOverride?: string;
}

/**
 * Summarize a large tool result to fit within context limits.
 * Uses Claude Haiku for fast, cheap summarization via Agent SDK query().
 *
 * Uses Agent SDK query() which properly handles OAuth tokens (Claude Max)
 * via getDefaultOptions() - same pattern as title-generator.ts.
 *
 * @param response - The large response text to summarize
 * @param context - Context about the tool/API call for better summarization
 * @returns Summarized response, or truncated fallback on error
 */
export async function summarizeLargeResult(
  response: string,
  context: SummarizationContext
): Promise<string> {
  // Build context from tool input (safely stringify to handle cyclic structures)
  let inputContext = 'No specific parameters provided.';
  if (context.input) {
    try {
      inputContext = `Request parameters: ${JSON.stringify(context.input)}`;
    } catch (e) {
      // Log the error with context to help debug where cyclic structures originate
      debug(`[summarize] CYCLIC STRUCTURE DETECTED in context.input for tool ${context.toolName}`);
      debug(`[summarize] Input keys: ${Object.keys(context.input).join(', ')}`);
      debug(`[summarize] Error: ${e}`);
      inputContext = 'Request parameters: [non-serializable input - contains cyclic references]';
    }
  }

  const endpointContext = context.path
    ? `Endpoint: ${context.path}`
    : '';

  // Build intent context - prefer model's stated intent, fall back to user request
  const intentContext = context.modelIntent
    ? `The AI assistant's goal: "${context.modelIntent.slice(-500)}"`
    : context.userRequest
      ? `User's original request: "${context.userRequest.slice(0, 300)}"`
      : '';

  // Truncate response to fit within Haiku's context safely
  const maxChars = MAX_SUMMARIZATION_INPUT * 4; // ~400KB
  const truncatedResponse = response.length > maxChars
    ? response.substring(0, maxChars) + '\n\n[... truncated for summarization ...]'
    : response;
  const wasTruncated = response.length > maxChars;

  // Build the summarization prompt
  const prompt = `You are summarizing a tool result that was too large to fit in context.

Tool: ${context.toolName}
${endpointContext}
${inputContext}
${intentContext ? `\n${intentContext}` : ''}
${wasTruncated ? '\nNote: The response was truncated before summarization due to extreme size.' : ''}

Your task:
1. Extract the MOST RELEVANT information based on the stated goal or request above
2. Preserve key data points, IDs, URLs, and actionable information that relate to the goal
3. Summarize long text content but keep essential details needed to complete the task
4. Format the output cleanly for the AI assistant to use

Tool result to summarize:
${truncatedResponse}

Provide a concise but comprehensive summary that captures the essential information needed to accomplish the stated goal.`;

  try {
    // Use Agent SDK query() which properly handles OAuth tokens
    const defaultOptions = getDefaultOptions();
    const options = {
      ...defaultOptions,
      model: context.modelOverride ?? getDefaultSummarizationModel(),
      maxTurns: 1,
    };

    let summary = '';

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            summary += block.text;
          }
        }
      }
    }

    return summary.trim() || 'Failed to summarize result';
  } catch (error) {
    // Log with console.error for visibility in logs
    console.error(`[summarize] Summarization failed for ${context.toolName}: ${error}`);
    // Fall back to truncation if summarization fails
    return response.substring(0, 40000) + '\n\n[Result truncated due to size]';
  }
}
