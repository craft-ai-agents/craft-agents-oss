/**
 * Session title generation utilities.
 *
 * Shared helpers for building title prompts and validating results.
 * Actual title generation is handled by agent classes using their respective SDKs:
 * - ClaudeAgent: Uses Claude SDK query()
 * - CodexAgent: Uses OpenAI SDK
 */

/**
 * Build a language instruction for title prompts.
 * Explicit preference takes priority; otherwise auto-detect from message content.
 */
function buildLanguageInstruction(language?: string): string {
  if (language) {
    return `Reply in ${language}.`;
  }
  return 'Reply in the same language as the user\'s messages.';
}

/**
 * Build a prompt for generating a session title from a user message.
 *
 * @param message - The user's message to generate a title from
 * @param options.language - Preferred language for the title
 * @returns Formatted prompt string
 */
export function buildTitlePrompt(message: string, options?: { language?: string }): string {
  const snippet = message.slice(0, 500);
  return [
    'What topic or area is the user exploring? Reply with ONLY a short topic label (2-5 words).',
    'Use a noun phrase — NOT a verb/action. Use plain text only - no markdown.',
    'If the user has a clear specific task, name the area it belongs to, not the action.',
    buildLanguageInstruction(options?.language),
    'Examples: "Auto Title Generation", "Dark Mode Support", "API Authentication", "Database Schema Design", "React Performance"',
    '',
    'User: ' + snippet,
    '',
    'Topic:',
  ].join('\n');
}

/**
 * Select a spread of user messages that captures the session's purpose:
 * first (original intent), middle (evolution), and last (current state).
 * Falls back gracefully for short conversations.
 */
export function selectSpreadMessages(allUserMessages: string[]): string[] {
  const count = allUserMessages.length;
  if (count === 0) return [];
  if (count === 1) return [allUserMessages[0]!];
  if (count === 2) return [allUserMessages[0]!, allUserMessages[1]!];

  const midIndex = Math.floor(count / 2);
  return [allUserMessages[0]!, allUserMessages[midIndex]!, allUserMessages[count - 1]!];
}

/**
 * Build a prompt for regenerating a session title from recent messages.
 *
 * @param recentUserMessages - Spread of user messages (first, middle, last)
 * @param lastAssistantResponse - The most recent assistant response
 * @param options.currentTitle - The current session title for refinement context
 * @param options.language - Preferred language for the title
 * @returns Formatted prompt string
 */
export function buildRegenerateTitlePrompt(
  recentUserMessages: string[],
  lastAssistantResponse: string,
  options?: { currentTitle?: string; language?: string }
): string {
  const userContext = recentUserMessages
    .map((msg) => msg.slice(0, 500))
    .join('\n\n');
  const assistantSnippet = lastAssistantResponse.slice(0, 500);

  const lines: string[] = [
    'Based on these messages, what is this conversation about?',
    'Reply with ONLY a short topic label (2-5 words).',
    'Use a noun phrase — NOT a verb/action. Use plain text only - no markdown.',
    buildLanguageInstruction(options?.language),
    'Examples: "Auto Title Generation", "Dark Mode Support", "API Authentication", "Database Schema Design"',
  ];

  if (options?.currentTitle) {
    lines.push('', `Current title: "${options.currentTitle}"`);
  }

  lines.push(
    '',
    'User messages (first, middle, last):',
    userContext,
    '',
    'Latest assistant response:',
    assistantSnippet,
    '',
    'Topic:',
  );

  return lines.join('\n');
}

/**
 * Validate and clean a generated title.
 *
 * @param title - The raw title from the model
 * @returns Cleaned title, or null if invalid
 */
export function validateTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
    return trimmed;
  }
  return null;
}
