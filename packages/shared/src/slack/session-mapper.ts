/**
 * Slack Session Mapper
 *
 * Maps Slack messages to Vesper session identifiers.
 */

import type { SlackSessionKey, SlackInboundMessage } from './types';

/**
 * Build a session key from Slack message context
 *
 * Session key format: slack:{accountId}:{teamId}:{channelId}:{threadTs}
 *
 * This ensures:
 * - Different workspaces have different sessions
 * - Different channels have different sessions
 * - Different threads have different sessions
 * - Non-threaded messages in same channel share a session
 */
export function buildSessionKey(message: SlackInboundMessage): SlackSessionKey {
  return {
    accountId: message.accountId,
    teamId: message.teamId,
    channelId: message.channel,
    threadTs: message.threadTs,
  };
}

/**
 * Convert session key to string identifier
 */
export function sessionKeyToString(key: SlackSessionKey): string {
  const threadPart = key.threadTs ?? 'main';
  return `slack:${key.accountId}:${key.teamId}:${key.channelId}:${threadPart}`;
}

/**
 * Parse session key from string identifier
 */
export function parseSessionKey(keyString: string): SlackSessionKey | null {
  const parts = keyString.split(':');
  if (parts.length !== 5 || parts[0] !== 'slack') {
    return null;
  }

  return {
    accountId: parts[1] ?? '',
    teamId: parts[2] ?? '',
    channelId: parts[3] ?? '',
    threadTs: parts[4] === 'main' ? undefined : parts[4],
  };
}

/**
 * Check if two session keys represent the same session
 */
export function sessionKeysEqual(a: SlackSessionKey, b: SlackSessionKey): boolean {
  return (
    a.accountId === b.accountId &&
    a.teamId === b.teamId &&
    a.channelId === b.channelId &&
    a.threadTs === b.threadTs
  );
}
