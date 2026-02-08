/**
 * Session title generator utility.
 * Uses Claude Agent SDK query() for all auth types (API Key, Claude OAuth).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL } from '../config/models.ts';
import { resolveModelId } from '../config/storage.ts';

function cleanTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["']+|["']+$/g, '');
  t = t.replace(/[.!?]+$/, '');
  return t.trim();
}

/**
 * Generate a task-focused title (2-5 words) from the user's first message.
 * Extracts what the user is trying to accomplish, framing conversations as tasks.
 * Uses SDK query() which handles all auth types via getDefaultOptions().
 *
 * @param userMessage - The user's first message
 * @returns Generated task title, or null if generation fails
 */
export async function generateSessionTitle(
  userMessage: string
): Promise<string | null> {
  try {
    const userSnippet = userMessage.slice(0, 500);

    const prompt = [
      'What is the user trying to do? Reply with ONLY a short task title (2-5 words, max 50 characters).',
      'Start with a verb. Use plain text only - no markdown, no quotes, no punctuation at the end.',
      'Do NOT write a sentence or explanation. Do NOT repeat the user message.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Create cheatsheet"',
      '',
      'User: ' + userSnippet,
      '',
      'Task:',
    ].join('\n');

    const defaultOptions = getDefaultOptions();
    const options = {
      ...defaultOptions,
      model: resolveModelId(SUMMARIZATION_MODEL),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const cleaned = cleanTitle(title);

    if (cleaned && cleaned.length > 0 && cleaned.length <= 50) {
      return cleaned;
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
 * @param recentUserMessages - The last few user messages (most recent context)
 * @param lastAssistantResponse - The most recent assistant response
 * @returns Generated title reflecting current session focus, or null if generation fails
 */
export async function regenerateSessionTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string,
  toolSummary?: string
): Promise<string | null> {
  try {
    // Combine recent user messages, taking up to 300 chars from each
    const userContext = recentUserMessages
      .map((msg) => msg.slice(0, 300))
      .join('\n\n');
    const assistantSnippet = lastAssistantResponse.slice(0, 500);

    const parts = [
      'Based on these recent messages, what is the current focus of this conversation?',
      'Reply with ONLY a short task title (2-5 words, max 50 characters).',
      'Start with a verb. Use plain text only - no markdown, no quotes, no punctuation at the end.',
      'Do NOT write a sentence or explanation. Do NOT repeat any message content.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Create cheatsheet"',
      '',
      'Recent user messages:',
      userContext,
      '',
      'Latest assistant response:',
      assistantSnippet,
    ];

    if (toolSummary) {
      parts.push('', 'Tools used by assistant:', toolSummary);
    }

    parts.push('', 'Current focus:');
    const prompt = parts.join('\n');

    const defaultOptions = getDefaultOptions();
    const options = {
      ...defaultOptions,
      model: resolveModelId(SUMMARIZATION_MODEL),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const cleaned = cleanTitle(title);

    if (cleaned && cleaned.length > 0 && cleaned.length <= 50) {
      return cleaned;
    }

    return null;
  } catch (error) {
    console.error('[title-generator] Failed to regenerate title:', error);
    return null;
  }
}
