/**
 * Session Types
 *
 * Types for workspace-scoped sessions.
 * Sessions are stored at {workspaceRootPath}/sessions/{id}/session.jsonl
 *
 * JSONL Format:
 * - Line 1: SessionHeader (metadata + pre-computed fields for fast list loading)
 * - Lines 2+: StoredMessage (one message per line)
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { StoredAttachment, MessageRole, ToolStatus, AuthRequestType, AuthStatus, CredentialInputMode, StoredMessage } from '@craft-agent/core/types';

/**
 * Todo state for sessions (user-controlled, never automatic)
 *
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 */
export type TodoState = string;

/**
 * Built-in status IDs (for TypeScript consumers)
 * These are the default statuses but users can add/remove custom ones
 */
export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled';

/**
 * Session token usage tracking
 */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Model's context window size in tokens (from SDK modelUsage) */
  contextWindow?: number;
}

/**
 * Stored message format (simplified for persistence)
 * Re-exported from @craft-agent/core for convenience
 */
export type { StoredMessage } from '@craft-agent/core/types';

/**
 * Session configuration (persisted metadata)
 */
export interface SessionConfig {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** Workspace root path this session belongs to */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message (user or final assistant). Used for date grouping in session list.
   *  Separate from lastUsedAt which tracks any session access (auto-save, open to read, etc.). */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode;
  /** User-controlled todo state - determines inbox vs completed */
  todoState?: TodoState;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes. Ensures SDK can find session transcripts regardless of workingDirectory changes. */
  sdkCwd?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
  };
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
}

/**
 * Stored session with conversation data
 */
export interface StoredSession extends SessionConfig {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
}

/**
 * Session header - line 1 of session.jsonl
 *
 * Contains all metadata needed for list views (pre-computed at save time).
 * This enables fast session listing without parsing message content.
 */
export interface SessionHeader {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** Workspace root path (stored as portable path, e.g., ~/.craft-agent/...) */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — persisted separately from lastUsedAt for stable date grouping across restarts. */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode;
  /** User-controlled todo state - determines inbox vs completed */
  todoState?: TodoState;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes */
  sdkCwd?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
  };
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
  // Pre-computed fields for fast list loading
  /** Number of messages in session */
  messageCount: number;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Preview of first user message (first 150 chars) */
  preview?: string;
  /** Token usage statistics */
  tokenUsage: SessionTokenUsage;
  /** ID of the last final (non-intermediate) assistant message - for unread detection without loading messages */
  lastFinalMessageId?: string;
}

/**
 * Session metadata (lightweight, for lists)
 */
export interface SessionMetadata {
  id: string;
  workspaceRootPath: string;
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — used for date grouping. Falls back to lastUsedAt for pre-fix sessions. */
  lastMessageAt?: number;
  messageCount: number;
  /** Preview of first user message */
  preview?: string;
  sdkSessionId?: string;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** User-controlled todo state */
  todoState?: TodoState;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** Permission mode for this session */
  permissionMode?: PermissionMode;
  /** Number of plan files for this session */
  planCount?: number;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Working directory for this session */
  workingDirectory?: string;
  /** SDK cwd for session storage - set once at creation, never changes */
  sdkCwd?: string;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /** ID of last message user has read - for unread detection */
  lastReadMessageId?: string;
  /** ID of the last final (non-intermediate) assistant message - for unread detection */
  lastFinalMessageId?: string;
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean;
  /** Token usage statistics (from JSONL header, available without loading messages) */
  tokenUsage?: SessionTokenUsage;
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean;
}
