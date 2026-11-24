import type { RecoveryMessage } from './core/index.ts';

const MAX_MESSAGE_CHARS = 500;
const MAX_TRANSCRIPT_CHARS = 12_000;

export interface ConversationSummaryOptions {
  maxMessageChars?: number;
  maxTranscriptChars?: number;
}

export function buildConversationSummaryTranscript(
  messages: RecoveryMessage[],
  options?: ConversationSummaryOptions,
): string {
  const maxMessageChars = options?.maxMessageChars ?? MAX_MESSAGE_CHARS;
  const maxTranscriptChars = options?.maxTranscriptChars ?? MAX_TRANSCRIPT_CHARS;

  const transcript = messages
    .map((message) => `${message.type === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, maxMessageChars)}`)
    .join('\n\n');

  return transcript.slice(0, maxTranscriptChars);
}

export function buildConversationSummaryPrompt(messages: RecoveryMessage[]): string | null {
  if (messages.length === 0) return null;

  const transcript = buildConversationSummaryTranscript(messages);
  if (!transcript) return null;

  return (
    'Summarize this conversation concisely. Preserve: key decisions, ongoing tasks, ' +
    `technical context, and the user's current goal. Be specific, not generic.\n\n${transcript}`
  );
}

export async function generateConversationSummary(
  messages: RecoveryMessage[],
  runMiniCompletion: (prompt: string) => Promise<string | null>,
): Promise<string | null> {
  const prompt = buildConversationSummaryPrompt(messages);
  if (!prompt) return null;
  return runMiniCompletion(prompt);
}

export function buildTransferredSessionContext(summary: string): string {
  // One wording for every handoff: a remote workspace transfer, an imported session, and a session
  // continued in a new one (Coding mode switch)
  return `<session_transfer_summary>\nThis session continues an earlier conversation from another session or workspace, which was summarized for the handoff.\nUse the summary below as prior context for the next turn.\n\n${summary}\n</session_transfer_summary>`;
}
