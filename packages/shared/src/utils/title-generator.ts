/**
 * Session title generator utility.
 * Supports both Claude (via SDK query()) and OpenAI (via direct API call).
 * Uses the same provider as the session for title generation.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { getDefaultSummarizationModel } from '../config/models.ts';

import { debug } from './debug.ts';

/**
 * Provider type for title generation.
 */
export type TitleProvider = 'anthropic' | 'openai';

/**
 * Credentials for OpenAI title generation.
 */
export interface OpenAICredentials {
  /** API key for OpenAI Platform users */
  apiKey?: string;
  /** Access token for ChatGPT Plus OAuth users */
  accessToken?: string;
}

/**
 * Options for title generation.
 */
export interface TitleGeneratorOptions {
  /** Which provider to use (defaults to 'anthropic') */
  provider?: TitleProvider;
  /** Credentials for OpenAI (required when provider is 'openai') */
  credentials?: OpenAICredentials;
  /** Summarization/utility model for title generation */
  summarizationModel?: string;
}

/**
 * Generate a title using OpenAI's chat completions API.
 * Used for Codex sessions where Anthropic auth isn't available.
 *
 * @param prompt - The prompt to send to OpenAI
 * @param credentials - API key or access token for authentication
 * @param model - Model ID to use (resolved from connection's last model)
 * @returns Generated title or null if generation fails
 */
async function generateTitleWithOpenAI(
  prompt: string,
  credentials: OpenAICredentials,
  model: string,
): Promise<string | null> {
  const authToken = credentials.apiKey || credentials.accessToken;
  if (!authToken) {
    debug('[title-generator] No OpenAI credentials available');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 50,
        temperature: 0.3, // Low temperature for consistent titles
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debug(`[title-generator] OpenAI API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      const trimmed = content.trim();
      // Validate: reasonable length, not empty
      if (trimmed.length > 0 && trimmed.length < 100) {
        return trimmed;
      }
    }

    return null;
  } catch (error) {
    debug(`[title-generator] OpenAI request failed: ${error}`);
    return null;
  }
}

/**
 * Generate a task-focused title (2-5 words) from the user's first message.
 * Extracts what the user is trying to accomplish, framing conversations as tasks.
 *
 * Supports both Claude and OpenAI providers. When options.provider is 'openai',
 * uses direct OpenAI API call instead of Claude SDK.
 *
 * @param userMessage - The user's first message
 * @param options - Optional provider, credentials, and model override
 * @returns Generated task title, or null if generation fails
 */
export async function generateSessionTitle(
  userMessage: string,
  options?: TitleGeneratorOptions & { modelOverride?: string }
): Promise<string | null> {
  try {
    const userSnippet = userMessage.slice(0, 500);

    const prompt = [
      'What is the user trying to do? Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'User: ' + userSnippet,
      '',
      'Task:',
    ].join('\n');

    // Route to appropriate provider
    const provider = options?.provider ?? 'anthropic';

    if (provider === 'openai' && options?.credentials) {
      // Use OpenAI for Codex sessions — model from connection (last = mini/summarization)
      const openaiModel = options?.modelOverride ?? options?.summarizationModel ?? getDefaultSummarizationModel();
      debug(`[title-generator] Using OpenAI for title generation with model: ${openaiModel}`);
      return await generateTitleWithOpenAI(prompt, options.credentials, openaiModel);
    }

    // Default: Use Claude SDK (works with API key or OAuth)
    debug('[title-generator] Using Claude for title generation');
    const defaultOptions = getDefaultOptions();
    const queryOptions = {
      ...defaultOptions,
      model: options?.modelOverride ?? options?.summarizationModel ?? getDefaultSummarizationModel(),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options: queryOptions })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const trimmed = title.trim();

    // Validate: reasonable length, not empty
    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    console.error('[title-generator] Failed to generate title:', error);
    return null;
  }
}

/**
 * Regenerate a session title based on recent messages.
 * Uses the most recent user messages to capture what the session has evolved into,
 * rather than just the initial topic.
 *
 * Supports both Claude and OpenAI providers. When options.provider is 'openai',
 * uses direct OpenAI API call instead of Claude SDK.
 *
 * @param recentUserMessages - The last few user messages (most recent context)
 * @param lastAssistantResponse - The most recent assistant response
 * @param options - Optional provider and credentials (defaults to Claude/Anthropic)
 * @returns Generated title reflecting current session focus, or null if generation fails
 */
export async function regenerateSessionTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string,
  options?: TitleGeneratorOptions & { modelOverride?: string }
): Promise<string | null> {
  try {
    // Combine recent user messages, taking up to 300 chars from each
    const userContext = recentUserMessages
      .map((msg) => msg.slice(0, 300))
      .join('\n\n');
    const assistantSnippet = lastAssistantResponse.slice(0, 500);

    const prompt = [
      'Based on these recent messages, what is the current focus of this conversation?',
      'Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'Recent user messages:',
      userContext,
      '',
      'Latest assistant response:',
      assistantSnippet,
      '',
      'Current focus:',
    ].join('\n');

    // Route to appropriate provider
    const provider = options?.provider ?? 'anthropic';

    if (provider === 'openai' && options?.credentials) {
      // Use OpenAI for Codex sessions — model from connection (last = mini/summarization)
      const openaiModel = options?.modelOverride ?? options?.summarizationModel ?? getDefaultSummarizationModel();
      debug(`[title-generator] Using OpenAI for title regeneration with model: ${openaiModel}`);
      return await generateTitleWithOpenAI(prompt, options.credentials, openaiModel);
    }

    // Default: Use Claude SDK (works with API key or OAuth)
    debug('[title-generator] Using Claude for title regeneration');
    const defaultOptions = getDefaultOptions();
    const sdkOptions = {
      ...defaultOptions,
      model: options?.modelOverride ?? options?.summarizationModel ?? getDefaultSummarizationModel(),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options: sdkOptions })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const trimmed = title.trim();

    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    console.error('[title-generator] Failed to regenerate title:', error);
    return null;
  }
}
