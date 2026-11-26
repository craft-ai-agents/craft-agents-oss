/**
 * JSONL Session Storage
 *
 * Helpers for reading/writing sessions in JSONL format.
 * Format: Line 1 = SessionHeader, Lines 2+ = StoredMessage (one per line)
 */

import { openSync, readSync, closeSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, createWriteStream } from 'fs';
import type { Stats } from 'fs';
import { open, stat, readFile, writeFile, rename, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { pipeline } from 'stream/promises';
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

/** A stored header line as the header readers return it: session paths expanded, permission modes normalized. */
function parseHeaderLine(line: string, sessionFile: string): SessionHeader {
  return normalizeHeaderPermissionModes(safeJsonParse(expandSessionPath(line, dirname(sessionFile))) as SessionHeader);
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

    return parseHeaderLine(firstLine, sessionFile);
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

/** Errors with which Windows refuses to rename over a file another process holds open, or a read-only one. */
const REPLACE_REFUSED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST']);

/**
 * Move a finished temp file over `target` in one step, so a reader finds the old file or the new
 * one, never none: a chat whose messages load while its file is missing loads empty, and its next
 * save drops the transcript. Node and Bun replace an existing file on every platform. Windows can
 * refuse while another process holds the file open, or when it's read-only; only then is the file
 * deleted first.
 */
async function replaceFile(tmpFile: string, target: string): Promise<void> {
  try {
    await rename(tmpFile, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !code || !REPLACE_REFUSED_CODES.has(code)) throw error;
    await unlink(target).catch(() => { /* missing, or locked: the rename reports it */ });
    await rename(tmpFile, target);
  }
}

/**
 * Change fields of a session.jsonl header (line 1) and copy the message lines over byte for byte,
 * streamed: a metadata change on a session whose messages aren't loaded then neither parses nor
 * holds its transcript. A key set to `undefined` is removed. The header is patched as stored
 * (portable paths stay as they are), so patch only fields that hold no paths. Atomic: the new file is
 * written to a temp file, which then replaces it (`replaceFile`); `beforeReplace` gets the new header,
 * as the header readers will return it, just before that. Returns false when the file or its header
 * can't be read; throws when writing fails.
 *
 * Callers inside the app go through `sessionPersistenceQueue.patchHeader`, which orders this after
 * the session's queued writes.
 */
export async function rewriteSessionHeader(
  sessionFile: string,
  patch: Partial<Record<keyof SessionHeader, unknown>>,
  beforeReplace?: (header: SessionHeader) => void,
): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(sessionFile, 'r');
  } catch (error) {
    debug('[jsonl] Failed to open session file for header rewrite:', sessionFile, error);
    return false;
  }

  const tmpFile = sessionFile + '.header.tmp';
  let headerLine: string;
  try {
    const stored = await readStoredHeader(handle, sessionFile);
    if (!stored) return false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete stored.header[key];
      else stored.header[key] = value;
    }
    headerLine = JSON.stringify(stored.header);
    await writeFile(tmpFile, headerLine + '\n', 'utf-8');
    if (stored.messagesStart !== -1) {
      // From the handle the header was read from, so the lines belong to that header even if the
      // file is replaced meanwhile
      await pipeline(
        handle.createReadStream({ start: stored.messagesStart, autoClose: false }),
        createWriteStream(tmpFile, { flags: 'a' }),
      );
    }
  } catch (error) {
    await unlink(tmpFile).catch(() => { /* never written */ });
    throw error;
  } finally {
    await handle.close().catch(() => { /* already closed */ });
  }

  try {
    beforeReplace?.(parseHeaderLine(headerLine, sessionFile));
    await replaceFile(tmpFile, sessionFile);
  } catch (error) {
    // When Windows deleted the file before a rename that still failed, the temp is the only copy left
    if (existsSync(sessionFile)) await unlink(tmpFile).catch(() => { /* already gone */ });
    throw error;
  }
  return true;
}

/** The header of an open session file, as stored, and the offset of its first message line (-1: none). */
async function readStoredHeader(
  handle: FileHandle,
  sessionFile: string,
): Promise<{ header: Record<string, unknown>; messagesStart: number } | null> {
  const chunks: Buffer[] = [];
  let messagesStart = -1;
  try {
    for (let position = 0; ;) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      const newline = chunk.subarray(0, bytesRead).indexOf(0x0a);
      if (newline !== -1) {
        chunks.push(chunk.subarray(0, newline));
        messagesStart = position + newline + 1;
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } catch (error) {
    debug('[jsonl] Failed to read session header for rewrite:', sessionFile, error);
    return null;
  }

  let header: unknown;
  try {
    header = safeJsonParse(Buffer.concat(chunks).toString('utf-8'));
  } catch (error) {
    debug('[jsonl] Unreadable session header, not rewritten:', sessionFile, error);
    return null;
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  return { header: header as Record<string, unknown>, messagesStart };
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
        return parseHeaderLine(firstLine, sessionFile);
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
