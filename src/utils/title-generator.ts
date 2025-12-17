/**
 * Session title generator utility.
 * Uses Claude Agent SDK query() for all auth types (API Key, Craft Credits, Claude OAuth).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL } from '../config/models.ts';
import { debug } from './debug.ts';

/**
 * Generate a short title (3-6 words) for a conversation based on the first exchange.
 * Uses SDK query() which handles all auth types via getDefaultOptions().
 *
 * @param userMessage - The user's first message
 * @param assistantResponse - The assistant's first response
 * @returns Generated title, or null if generation fails
 */
export async function generateSessionTitle(
  userMessage: string,
  assistantResponse: string
): Promise<string | null> {
  try {
    const userSnippet = userMessage.slice(0, 500);
    const assistantSnippet = assistantResponse.slice(0, 500);

    const prompt = [
      'Generate a short title (3-6 words) for this conversation.',
      'Reply with ONLY the title text, no quotes, no punctuation at the end.',
      '',
      'User: ' + userSnippet,
      '',
      'Assistant: ' + assistantSnippet,
      '',
      'Title:',
    ].join('\n');

    const options = {
      ...getDefaultOptions(),
      model: SUMMARIZATION_MODEL,
      maxTurns: 1,
    };

    let title = '';

    // Use SDK query() - handles all auth types via env vars
    for await (const message of query({ prompt, options })) {
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
      debug('[title-generator] Generated title: "' + trimmed + '"');
      return trimmed;
    }

    debug('[title-generator] Invalid title generated');
    return null;
  } catch (error) {
    debug('[title-generator] Failed to generate title: ' + error);
    return null;
  }
}
