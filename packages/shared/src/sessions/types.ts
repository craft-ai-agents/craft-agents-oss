/**
 * Session Types
 *
 * Types for workspace-scoped sessions.
 * Sessions are stored at {workspaceRootPath}/sessions/{id}/session.json
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { StoredAttachment } from '@craft-agent/core/types';

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
}

/**
 * Stored message format (simplified for persistence)
 */
export interface StoredMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system' | 'info' | 'warning' | 'plan';
  content: string;
  timestamp?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolStatus?: 'pending' | 'executing' | 'completed' | 'error' | 'backgrounded';
  toolDuration?: number;
  /** Tool intent description (from MCP _intent field) */
  toolIntent?: string;
  isError?: boolean;
  /** Stored attachments for user messages (persisted to disk) */
  attachments?: StoredAttachment[];
  /** Tool use ID for deduplication (SDK sends duplicate tool_start events) */
  toolUseId?: string;
  /** Tool result content (for tool messages) */
  toolResult?: string;
  /** Parent tool use ID for nested tool calls (e.g., child tools inside Task subagent) */
  parentToolUseId?: string;
  /** Whether this is an intermediate assistant message (commentary between tool calls) */
  isIntermediate?: boolean;
  /** Turn ID for grouping messages in TurnCard after reload */
  turnId?: string;
  /** Error display fields for typed errors */
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  /** Whether this user message was sent with ultrathink (extended thinking) enabled */
  ultrathink?: boolean;
  /** Background task fields */
  taskId?: string;
  shellId?: string;
  elapsedSeconds?: number;
  isBackground?: boolean;
}

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
  /** Assigned agent slug (for filtering) */
  agentSlug?: string;
  /** Cached agent name for display */
  agentName?: string;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode;
  /** User-controlled todo state - determines inbox vs completed */
  todoState?: TodoState;
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands) */
  workingDirectory?: string;
}

/**
 * Stored session with conversation data
 */
export interface StoredSession extends SessionConfig {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
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
  messageCount: number;
  /** Preview of first user message */
  preview?: string;
  sdkSessionId?: string;
  /** Assigned agent slug (for filtering) */
  agentSlug?: string;
  /** Cached agent name for display */
  agentName?: string;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** User-controlled todo state */
  todoState?: TodoState;
  /** Distinct agent names used in this session */
  agents?: string[];
  /** Number of plan files for this session */
  planCount?: number;
}
