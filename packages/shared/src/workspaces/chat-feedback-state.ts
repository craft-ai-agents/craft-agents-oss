import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';

export const CHAT_FEEDBACK_STATE_FILE = 'chat_feedback_state.json';
const CHAT_FEEDBACK_STATE_DIR = 'sessions';

export interface ChatFeedbackStateEntry {
  session_id: string;
  message_id: string;
  isLike: boolean;
}

export interface ChatFeedbackStateFile {
  version: 1;
  items: Record<string, ChatFeedbackStateEntry>;
}

function getChatFeedbackStatePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, CHAT_FEEDBACK_STATE_DIR, CHAT_FEEDBACK_STATE_FILE);
}

function getFeedbackKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

function normalizeChatFeedbackState(raw: Partial<ChatFeedbackStateFile> | null | undefined): ChatFeedbackStateFile {
  const items: Record<string, ChatFeedbackStateEntry> = {};

  if (raw?.items && typeof raw.items === 'object') {
    for (const entry of Object.values(raw.items)) {
      if (
        entry &&
        typeof entry.session_id === 'string' &&
        typeof entry.message_id === 'string' &&
        typeof entry.isLike === 'boolean'
      ) {
        items[getFeedbackKey(entry.session_id, entry.message_id)] = {
          session_id: entry.session_id,
          message_id: entry.message_id,
          isLike: entry.isLike,
        };
      }
    }
  }

  return { version: 1, items };
}

export function loadChatFeedbackState(workspaceRootPath: string): ChatFeedbackStateFile {
  const statePath = getChatFeedbackStatePath(workspaceRootPath);
  if (!existsSync(statePath)) {
    return { version: 1, items: {} };
  }

  try {
    return normalizeChatFeedbackState(readJsonFileSync<Partial<ChatFeedbackStateFile>>(statePath));
  } catch {
    return { version: 1, items: {} };
  }
}

function saveChatFeedbackState(workspaceRootPath: string, state: ChatFeedbackStateFile): void {
  const stateDir = join(workspaceRootPath, CHAT_FEEDBACK_STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  atomicWriteFileSync(
    getChatFeedbackStatePath(workspaceRootPath),
    `${JSON.stringify(normalizeChatFeedbackState(state), null, 2)}\n`
  );
}

export function listChatFeedbackState(workspaceRootPath: string): ChatFeedbackStateEntry[] {
  return Object.values(loadChatFeedbackState(workspaceRootPath).items);
}

export function getChatFeedbackState(
  workspaceRootPath: string,
  sessionId: string,
  messageId: string
): ChatFeedbackStateEntry | null {
  return loadChatFeedbackState(workspaceRootPath).items[getFeedbackKey(sessionId, messageId)] ?? null;
}

export function setChatFeedbackState(
  workspaceRootPath: string,
  entry: ChatFeedbackStateEntry
): ChatFeedbackStateFile {
  const state = loadChatFeedbackState(workspaceRootPath);
  state.items[getFeedbackKey(entry.session_id, entry.message_id)] = {
    session_id: entry.session_id,
    message_id: entry.message_id,
    isLike: entry.isLike,
  };
  saveChatFeedbackState(workspaceRootPath, state);
  return loadChatFeedbackState(workspaceRootPath);
}

export function deleteChatFeedbackState(
  workspaceRootPath: string,
  sessionId: string,
  messageId: string
): ChatFeedbackStateFile {
  const state = loadChatFeedbackState(workspaceRootPath);
  delete state.items[getFeedbackKey(sessionId, messageId)];
  saveChatFeedbackState(workspaceRootPath, state);
  return loadChatFeedbackState(workspaceRootPath);
}
