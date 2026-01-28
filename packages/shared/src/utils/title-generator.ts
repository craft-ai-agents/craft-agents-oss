/**
 * Session title generator utility.
 * Uses Claude Agent SDK query() for all auth types (API Key, Claude OAuth).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL } from '../config/models.ts';
import { resolveModelId, resolveUiLanguageFromConfig } from '../config/storage.ts';

const TITLE_LANGUAGE_MAP: Record<string, string> = {
  en: 'English',
  zh: 'Simplified Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  'pt-BR': 'Portuguese (Brazil)',
  ja: 'Japanese',
  ko: 'Korean',
};

function getTitleLanguageInstruction(): string | null {
  const resolvedLanguage = resolveUiLanguageFromConfig();
  const languageName = TITLE_LANGUAGE_MAP[resolvedLanguage];
  if (!languageName || languageName === 'English') return null;
  return `Write the title in ${languageName}.`;
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

    const languageInstruction = getTitleLanguageInstruction();
    const prompt = [
      'What is the user trying to do? Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      languageInstruction,
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'User: ' + userSnippet,
      '',
      'Task:',
    ].filter(Boolean).join('\n');

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
 * @param recentUserMessages - The last few user messages (most recent context)
 * @param lastAssistantResponse - The most recent assistant response
 * @returns Generated title reflecting current session focus, or null if generation fails
 */
export async function regenerateSessionTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string
): Promise<string | null> {
  try {
    // Combine recent user messages, taking up to 300 chars from each
    const userContext = recentUserMessages
      .map((msg) => msg.slice(0, 300))
      .join('\n\n');
    const assistantSnippet = lastAssistantResponse.slice(0, 500);

    const languageInstruction = getTitleLanguageInstruction();
    const prompt = [
      'Based on these recent messages, what is the current focus of this conversation?',
      'Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      languageInstruction,
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'Recent user messages:',
      userContext,
      '',
      'Latest assistant response:',
      assistantSnippet,
      '',
      'Current focus:',
    ].filter(Boolean).join('\n');

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
