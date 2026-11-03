/**
 * JSONL Session Storage
 *
 * Helpers for reading/writing sessions in JSONL format.
 * Format: Line 1 = SessionHeader, Lines 2+ = StoredMessage (one per line)
 */

import { openSync, readSync, closeSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import type { Stats } from 'fs';
import { open, stat, readFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionHeader, StoredSession, StoredMessage, SessionTokenUsage } from './types.ts';
import type { PermissionMode } from '../agent/mode-types.ts';
import { parsePermissionMode } from '../agent/mode-types.ts';
import { toPortablePath, expandPath, normalizePath } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { safeJsonParse } from '../utils/files.ts';
import { withTimeout } from '../utils/async.ts';
import { pickSessionFields } from './utils.ts';

/**
 * Per-file backstop timeout for an async session-header read. Resident 8 KiB
 * reads are sub-millisecond; this only fires for a pathologically slow read we
 * couldn't rule out from metadata (e.g. a non-macOS cloud file). Generous so a
 * healthy-but-slow disk is never dropped.
 */
export const SESSION_HEADER_READ_TIMEOUT_MS = 2000;

/**
 * Heuristic for a cloud-evicted (dataless / File-Provider-offloaded) file on
 * macOS: it reports a logical size but zero allocated blocks, so its content is
 * not resident. Opening/reading it would block on hydration (iCloud / File
 * Provider) — potentially the Electron main thread — so callers skip these
 * instead of reading them. `stat` itself is metadata-only and does NOT trigger
 * materialization, which is what makes this check safe.
 *
 * Guarded to darwin: `blocks` isn't a reliable residency signal for Windows
 * cloud reparse points, and session.jsonl is never sparse, so on macOS
 * `size > 0 && blocks === 0` reliably means "not resident".
 *
 * Exported for unit testing the heuristic; not re-exported from the package barrel.
 */
export function isLikelyEvicted(stats: Pick<Stats, 'size' | 'blocks'>): boolean {
  return process.platform === 'darwin' && stats.size > 0 && stats.blocks === 0;
}

// ============================================================
// Session Path Portability
// ============================================================

const SESSION_PATH_TOKEN = '{{SESSION_PATH}}';

/**
 * Replace absolute session directory paths with a portable token.
 * Applied after JSON.stringify so paths embedded anywhere in message content
 * (datatable src, planPath, attachment storedPath, etc.) are made portable.
 */
export function makeSessionPathPortable(jsonLine: string, sessionDir: string): string {
  if (!sessionDir) return jsonLine;
  const normalized = normalizePath(sessionDir);
  let result = jsonLine.replaceAll(normalized, SESSION_PATH_TOKEN);
  // On Windows, also replace JSON-escaped backslash paths
  // (JSON.stringify escapes \ to \\, so C:\foo becomes C:\\foo in JSON strings)
  if (sessionDir !== normalized) {
    const jsonEscaped = sessionDir.replaceAll('\\', '\\\\');
    result = result.replaceAll(jsonEscaped, SESSION_PATH_TOKEN);
  }
  return result;
}

/**
 * Expand the portable session path token back to an absolute path.
 * Applied before JSON.parse so all path references resolve correctly at runtime.
 */
export function expandSessionPath(jsonLine: string, sessionDir: string): string {
  if (!jsonLine.includes(SESSION_PATH_TOKEN)) return jsonLine;
  return jsonLine.replaceAll(SESSION_PATH_TOKEN, normalizePath(sessionDir));
}

function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  if (typeof value !== 'string') return undefined;
  return parsePermissionMode(value) ?? undefined;
}

function normalizeHeaderPermissionModes<T extends SessionHeader>(header: T): T {
  const permissionMode = normalizePermissionMode(header.permissionMode);
  const previousPermissionMode = normalizePermissionMode(header.previousPermissionMode);

  if (permissionMode) {
    header.permissionMode = permissionMode;
  } else {
    delete (header as Partial<SessionHeader>).permissionMode;
  }

  if (previousPermissionMode) {
    header.previousPermissionMode = previousPermissionMode;
  } else {
    delete (header as Partial<SessionHeader>).previousPermissionMode;
  }

  return header;
}

/**
 * Read only the header (first line) from a session.jsonl file.
 * Uses low-level fs to read minimal bytes for fast list loading.
 */
export function readSessionHeader(sessionFile: string): SessionHeader | null {
  let fd: number | undefined;
  try {
    // Skip cloud-evicted files: reading one would block this (often the Electron
    // main) thread on hydration. statSync is metadata-only and never materializes.
    if (isLikelyEvicted(statSync(sessionFile))) {
      debug('[jsonl] Skipping cloud-evicted session header (sync):', sessionFile);
      return null;
    }

    fd = openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(8192); // 8KB is plenty for metadata header
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

    const parsed = safeJsonParse(expandSessionPath(firstLine, dirname(sessionFile))) as SessionHeader;
    return normalizeHeaderPermissionModes(parsed);
  } catch (error) {
    debug('[jsonl] Failed to read session header:', sessionFile, error);
    return null;
  } finally {
    // Always release the descriptor — a throw between openSync and the old
    // closeSync (e.g. readSync EINTR on a dataless file) used to leak it.
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed / gone */ }
    }
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

    const sessionDir = dirname(sessionFile);
    const header = normalizeHeaderPermissionModes(
      safeJsonParse(expandSessionPath(firstLine, sessionDir)) as SessionHeader
    );
    // Parse messages resiliently: skip lines that fail to parse (e.g. truncated by crash)
    // rather than losing the entire session's messages.
    // Expand session path tokens before parsing so embedded paths resolve correctly.
    const expandedMessageLines = lines.slice(1).map(line => expandSessionPath(line, sessionDir));
    const messages = parseMessagesResilient(expandedMessageLines);

    // Migration: For sessions created before sdkCwd was added, use workingDirectory as fallback.
    // This is correct because the old code used workingDirectory for SDK's cwd parameter.
    const workingDir = header.workingDirectory ? expandPath(header.workingDirectory) : undefined;
    const sdkCwd = header.sdkCwd ? expandPath(header.sdkCwd) : workingDir;

    return {
      ...pickSessionFields(header),
      // Path expansion for portable paths
      workspaceRootPath: expandPath(header.workspaceRootPath),
      workingDirectory: workingDir,
      sdkCwd,
      // Runtime fields
      messages,
      tokenUsage: header.tokenUsage,
    } as StoredSession;
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
  const sessionDir = dirname(sessionFile);

  const lines = [
    makeSessionPathPortable(JSON.stringify(header), sessionDir),
    ...session.messages.map(m => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
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
 * Uses pickSessionFields() to ensure all persistent fields are included.
 */
export function createSessionHeader(session: StoredSession): SessionHeader {
  return {
    ...pickSessionFields(session),
    // Path conversion for portability
    workspaceRootPath: toPortablePath(session.workspaceRootPath),
    // Override lastUsedAt with current timestamp (save time, not original)
    lastUsedAt: Date.now(),
    // Pre-computed fields
    messageCount: session.messages.length,
    lastMessageRole: extractLastMessageRole(session.messages),
    preview: extractPreview(session.messages),
    tokenUsage: session.tokenUsage,
    lastFinalMessageId: extractLastFinalMessageId(session.messages),
  } as SessionHeader;
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

  // Sanitize: strip special blocks, tags, and bracket mentions, normalize whitespace
  const sanitized = firstUserMessage.content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')     // Strip remaining XML/HTML tags
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')   // Strip [skill:...] mentions
    .replace(/\[source:[\w-]+\]/g, '')              // Strip [source:...] mentions
    .replace(/\[file:[^\]]+\]/g, '')                // Strip [file:...] mentions
    .replace(/\[folder:[^\]]+\]/g, '')              // Strip [folder:...] mentions
    .replace(/\s+/g, ' ')        // Collapse whitespace (including newlines)
    .trim();

  return sanitized.substring(0, 150) || undefined;
}

/**
 * Async version of readSessionHeader for parallel I/O off the main thread.
 * Uses fs/promises so reads run on the libuv threadpool.
 *
 * Resilience (see #1113): a `stat` pre-check skips cloud-evicted files without
 * opening them, and the whole operation is wrapped in a per-file timeout
 * backstop. The inner read never rejects (errors resolve to `null`); if the
 * backstop fires, the abandoned read still settles and closes its own handle in
 * the background, so there is no descriptor leak and no unhandled rejection.
 */
export async function readSessionHeaderAsync(
  sessionFile: string,
  opts?: { timeoutMs?: number },
): Promise<SessionHeader | null> {
  const timeoutMs = opts?.timeoutMs ?? SESSION_HEADER_READ_TIMEOUT_MS;

  const read: Promise<SessionHeader | null> = (async () => {
    try {
      // Skip cloud-evicted files without opening them (see isLikelyEvicted).
      if (isLikelyEvicted(await stat(sessionFile))) {
        debug('[jsonl] Skipping cloud-evicted session header (async):', sessionFile);
        return null;
      }

      const handle = await open(sessionFile, 'r');
      try {
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await handle.read(buffer, 0, 8192, 0);
        const content = buffer.toString('utf-8', 0, bytesRead);
        const firstNewline = content.indexOf('\n');
        const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;
        const parsed = safeJsonParse(expandSessionPath(firstLine, dirname(sessionFile))) as SessionHeader;
        return normalizeHeaderPermissionModes(parsed);
      } finally {
        await handle.close().catch(() => { /* already closed / gone */ });
      }
    } catch (error) {
      debug('[jsonl] Failed to read session header async:', sessionFile, error);
      return null;
    }
  })();

  try {
    return await withTimeout(read, timeoutMs, `Session header read timed out after ${timeoutMs}ms: ${sessionFile}`);
  } catch (error) {
    // Backstop fired. `read` keeps running, resolves to null on its own, and
    // closes its handle — nothing to clean up here beyond logging.
    debug('[jsonl] Session header read timed out:', sessionFile, error);
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
    // Skip first line (header), expand session path tokens, parse rest as messages resiliently
    const sessionDir = dirname(sessionFile);
    const expandedLines = lines.slice(1).map(line => expandSessionPath(line, sessionDir));
    return parseMessagesResilient(expandedLines);
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
