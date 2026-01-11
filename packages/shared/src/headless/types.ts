import type { Workspace } from '../config/storage.ts';

/**
 * Configuration for headless (non-interactive) execution.
 */
export interface HeadlessConfig {
  // Required
  prompt: string;
  workspace: Workspace;

  // Optional overrides
  model?: string;               // -m flag
  outputFormat?: 'text' | 'json' | 'stream-json';

  // Permission handling for bash commands
  permissionPolicy?: 'deny-all' | 'allow-safe' | 'allow-all';

  // Session control
  // Default: fresh session each run (predictable for automation)
  // --session-resume: resume the last session
  // --session <id>: use explicit session (for external workflow management)
  sessionId?: string;           // Explicit session ID (--session)
  sessionResume?: boolean;      // Resume the last session (--session-resume)
}

/**
 * Result of a headless execution.
 */
export interface HeadlessResult {
  success: boolean;

  // On success
  response?: string;
  toolCalls?: ToolCallRecord[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    costUsd: number;
  };
  sessionId?: string;

  // On failure
  error?: HeadlessError;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  result: string;
  isError: boolean;
}

export interface HeadlessError {
  code: 'auth_required' | 'config_missing' | 'execution_error';
  message: string;
  details?: unknown;
}

/**
 * Streaming events emitted during headless execution.
 */
export type HeadlessEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; result: string; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'complete'; result: HeadlessResult };
