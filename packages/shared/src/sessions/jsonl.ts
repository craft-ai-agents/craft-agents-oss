/**
 * JSONL Session Storage
 *
 * Helpers for reading/writing sessions in JSONL format.
 * Format: Line 1 = SessionHeader, Lines 2+ = StoredMessage (one per line)
 */

import { openSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { open, readFile } from 'fs/promises';
import type { SessionHeader, StoredSession, StoredMessage, SessionTokenUsage } from './types.ts';
import { toPortablePath, expandPath } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';

/**
 * Read only the header (first line) from a session.jsonl file.
 * Uses low-level fs to read minimal bytes for fast list loading.
 */
export function readSessionHeader(sessionFile: string): SessionHeader | null {
  try {
    const fd = openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(8192); // 8KB is plenty for metadata header
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);
    closeSync(fd);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

    return JSON.parse(firstLine) as SessionHeader;
  } catch (error) {
    debug('[jsonl] Failed to read session header:', sessionFile, error);
    return null;
  }
}

/**
 * Read full session from JSONL file.
 * Parses header and all message lines.
 */
export function readSessionJsonl(sessionFile: string): StoredSession | null {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const firstLine = lines[0];
    if (!firstLine) return null;

    const header = JSON.parse(firstLine) as SessionHeader;
    // Parse messages resiliently: skip lines that fail to parse (e.g. truncated by crash)
    // rather than losing the entire session's messages
    const messages = parseMessagesResilient(lines.slice(1));

    // Migration: For sessions created before sdkCwd was added, use workingDirectory as fallback.
    // This is correct because the old code used workingDirectory for SDK's cwd parameter.
    const workingDir = header.workingDirectory ? expandPath(header.workingDirectory) : undefined;
    const sdkCwd = header.sdkCwd ? expandPath(header.sdkCwd) : workingDir;

    return {
      id: header.id,
      workspaceRootPath: expandPath(header.workspaceRootPath),
      createdAt: header.createdAt,
      lastUsedAt: header.lastUsedAt,
      name: header.name,
      sdkSessionId: header.sdkSessionId,
      isFlagged: header.isFlagged,
      todoState: header.todoState,
      labels: header.labels,
      permissionMode: header.permissionMode,
      lastReadMessageId: header.lastReadMessageId,
      hasUnread: header.hasUnread,  // Explicit unread flag for NEW badge state machine
      enabledSourceSlugs: header.enabledSourceSlugs,
      workingDirectory: workingDir,
      sdkCwd,
      sharedUrl: header.sharedUrl,
      sharedId: header.sharedId,
      model: header.model,
      thinkingLevel: header.thinkingLevel,
      pendingPlanExecution: header.pendingPlanExecution,
      messages,
      tokenUsage: header.tokenUsage,
      hidden: header.hidden,
    };
  } catch (error) {
    debug('[jsonl] Failed to read session:', sessionFile, error);
    return null;
  }
}

/**
 * Write session to JSONL format using atomic write (write-to-temp-then-rename).
 * Prevents file corruption if the process crashes mid-write: either the old
 * file remains intact or the new file is fully written. Never a partial file.
 *
 * Line 1: Header with pre-computed metadata
 * Lines 2+: Messages (one per line)
 */
export function writeSessionJsonl(sessionFile: string, session: StoredSession): void {
  const header = createSessionHeader(session);

  const lines = [
    JSON.stringify(header),
    ...session.messages.map(m => JSON.stringify(m)),
  ];

  const tmpFile = sessionFile + '.tmp';
  writeFileSync(tmpFile, lines.join('\n') + '\n');
  // On Windows, rename fails if target exists. Delete first for cross-platform compatibility.
  try { unlinkSync(sessionFile); } catch { /* ignore if doesn't exist */ }
  renameSync(tmpFile, sessionFile);
}

/**
 * Create a SessionHeader from a StoredSession.
 * Pre-computes messageCount, preview, and lastMessageRole for fast list loading.
 */
export function createSessionHeader(session: StoredSession): SessionHeader {
  return {
    id: session.id,
    workspaceRootPath: toPortablePath(session.workspaceRootPath),
    createdAt: session.createdAt,
    lastUsedAt: Date.now(),
    lastMessageAt: session.lastMessageAt,  // Actual message time, distinct from lastUsedAt (persist time)
    name: session.name,
    sdkSessionId: session.sdkSessionId,
    isFlagged: session.isFlagged,
    todoState: session.todoState,
    labels: session.labels,
    permissionMode: session.permissionMode,
    lastReadMessageId: session.lastReadMessageId,
    hasUnread: session.hasUnread,  // Explicit unread flag for NEW badge state machine
    enabledSourceSlugs: session.enabledSourceSlugs,
    workingDirectory: session.workingDirectory,
    sdkCwd: session.sdkCwd,
    sharedUrl: session.sharedUrl,
    sharedId: session.sharedId,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    pendingPlanExecution: session.pendingPlanExecution,
    // Pre-computed fields
    messageCount: session.messages.length,
    lastMessageRole: extractLastMessageRole(session.messages),
    preview: extractPreview(session.messages),
    tokenUsage: session.tokenUsage,
    lastFinalMessageId: extractLastFinalMessageId(session.messages),
    // Hidden flag for mini-agent sessions (not shown in session list)
    hidden: session.hidden,
  };
}

/**
 * Extract the role of the last message for badge display.
 * Only returns roles that are meaningful for UI display (user, assistant, plan, tool, error).
 */
function extractLastMessageRole(messages: StoredMessage[]): SessionHeader['lastMessageRole'] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return undefined;
  // Map message types to the subset we care about for display
  const role = lastMessage.type;
  if (role === 'user' || role === 'assistant' || role === 'plan' || role === 'tool' || role === 'error') {
    return role;
  }
  return undefined;
}

/**
 * Extract the ID of the last final (non-intermediate) assistant message.
 * Used for unread detection in session list without loading all messages.
 */
function extractLastFinalMessageId(messages: StoredMessage[]): string | undefined {
  // Walk backwards to find the last assistant message that isn't intermediate
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'assistant' && !msg.isIntermediate) {
      return msg.id;
    }
  }
  return undefined;
}

/**
 * Extract preview from first user message.
 * Sanitizes by stripping special blocks and normalizing whitespace.
 * Returns first 150 chars.
 */
function extractPreview(messages: StoredMessage[]): string | undefined {
  const firstUserMessage = messages.find(m => m.type === 'user');
  if (!firstUserMessage?.content) return undefined;

  // Sanitize: strip special blocks and tags, normalize whitespace
  const sanitized = firstUserMessage.content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')     // Strip remaining XML/HTML tags
    .replace(/\s+/g, ' ')        // Collapse whitespace (including newlines)
    .trim();

  return sanitized.substring(0, 150) || undefined;
}

/**
 * Async version of readSessionHeader for parallel I/O.
 * Uses fs/promises for non-blocking reads.
 */
export async function readSessionHeaderAsync(sessionFile: string): Promise<SessionHeader | null> {
  try {
    const handle = await open(sessionFile, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, 8192, 0);
      const content = buffer.toString('utf-8', 0, bytesRead);
      const firstNewline = content.indexOf('\n');
      const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;
      return JSON.parse(firstLine) as SessionHeader;
    } finally {
      await handle.close();
    }
  } catch (error) {
    debug('[jsonl] Failed to read session header async:', sessionFile, error);
    return null;
  }
}

/**
 * Read only messages from a JSONL file (skips header).
 * Used for lazy loading when session is selected.
 * Resilient to corrupted/truncated lines (skips them instead of failing entirely).
 */
export function readSessionMessages(sessionFile: string): StoredMessage[] {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    // Skip first line (header), parse rest as messages resiliently
    return parseMessagesResilient(lines.slice(1));
  } catch (error) {
    debug('[jsonl] Failed to read session messages:', sessionFile, error);
    return [];
  }
}

/**
 * Parse message lines resiliently: skip lines that fail JSON.parse
 * (e.g. truncated by a crash mid-write) rather than losing all messages.
 */
function parseMessagesResilient(lines: string[]): StoredMessage[] {
  const messages: StoredMessage[] = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line) as StoredMessage);
    } catch {
      // Corrupted/truncated line (likely from a crash during write).
      // Skip it and continue — losing one message is better than losing all.
      debug('[jsonl] Skipping corrupted message line (truncated?):', line.substring(0, 100));
    }
  }
  return messages;
}
