/**
 * useAgent Hook - Stub Implementation for TUI
 *
 * The TUI agent functionality has been removed. This hook provides
 * stub implementations that allow the TUI to compile.
 * For full agent functionality, use the Electron app.
 */

import { useState, useCallback } from 'react';
import type { Message } from '../../components/Messages.tsx';
import type { TodoItem } from '../../components/TodoList.tsx';
import type { Question } from '../../components/AskUserQuestion.tsx';
import type { FileAttachment } from '@craft-agent/shared/utils';
import type { PermissionMode } from '@craft-agent/shared/agent';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface PermissionRequest {
  toolName: string;
  command: string;
}

// Stub config type - the real CraftAgentConfig has changed
export interface UseAgentConfig {
  workspace?: { rootPath: string };
  session?: { id: string; workspaceRootPath: string; sdkSessionId?: string };
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;
}

/**
 * useAgent Hook - Returns stub values for agent functionality.
 */
export function useAgent(_config: UseAgentConfig) {
  // Core state - stubbed
  const [messages] = useState<Message[]>([]);
  const [isProcessing] = useState(false);
  const [streamingText] = useState<string>('');
  const [status] = useState<string>('');
  const [processingStartTime] = useState<number | null>(null);
  const [connected] = useState(false);
  const [tokenUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  // Error state - stubbed
  const typedError = null;
  const dismissTypedError = useCallback(() => {}, []);

  // Permission state - stubbed
  const [pendingPermission] = useState<PermissionRequest | null>(null);
  const respondToPermission = useCallback((_allowed: boolean, _alwaysAllow: boolean) => {}, []);

  // Question state - stubbed
  const [pendingQuestion] = useState<{ questions: Question[] } | null>(null);
  const respondToQuestion = useCallback((_answers: Record<string, string>) => {}, []);

  // Tool execution state - stubbed
  const hasExecutingTool = false;

  // Permission mode state - stubbed
  const [permissionMode] = useState<PermissionMode>('ask');
  const cycleMode = useCallback(() => 'ask' as PermissionMode, []);
  const setSessionPermissionMode = useCallback((_mode: PermissionMode) => {}, []);

  // Plan state - stubbed
  const activePlan = null;
  const cancelPlan = useCallback(() => {}, []);
  const approvePlan = useCallback(() => {}, []);

  // Todos state - stubbed
  const [todos] = useState<TodoItem[]>([]);

  // Ultrathink state - stubbed
  const isUltrathink = false;

  // Actions - stubbed
  const sendMessage = useCallback(async (_text: string, _attachments?: FileAttachment[]) => {
    // Stub - TUI agent functionality not available
  }, []);
  const interrupt = useCallback(() => {}, []);
  const resetAgentInstance = useCallback(() => {}, []);

  // Agent stubs
  const availableAgents: string[] = [];
  const activeAgentName: string | null = null;
  const activeAgentDefinition = null;
  const activeAgentMcpServers: unknown[] = [];
  const activateAgent = useCallback(async (_name: string) => false, []);
  const deactivateAgent = useCallback(() => {}, []);
  const reloadAgent = useCallback(async () => {}, []);
  const resetAgent = useCallback(async () => {}, []);
  const refreshAgents = useCallback(async () => {}, []);
  const fetchTools = useCallback(async () => [] as { name: string; tools: { name: string; description?: string }[] }[], []);
  const agentsLoading = false;

  // MCP auth stubs
  const pendingMcpAuth = null;
  const completeMcpAuth = useCallback(() => {}, []);
  const cancelMcpAuth = useCallback(() => {}, []);
  const triggerMcpAuth = useCallback(() => {}, []);

  // API auth stubs
  const pendingApiAuth = null;
  const completeApiAuth = useCallback(() => {}, []);
  const cancelApiAuth = useCallback(() => {}, []);
  const triggerApiAuth = useCallback(() => {}, []);

  return {
    // Core state
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
    tokenUsage,
    typedError,
    dismissTypedError,

    // Permission handling
    pendingPermission,
    respondToPermission,

    // Question handling
    pendingQuestion,
    respondToQuestion,

    // Tool state
    hasExecutingTool,

    // Actions
    sendMessage,
    interrupt,

    // Agent stubs
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    resetAgentInstance,
    refreshAgents,
    fetchTools,
    agentsLoading,

    // MCP auth stubs
    pendingMcpAuth,
    completeMcpAuth,
    cancelMcpAuth,
    triggerMcpAuth,

    // API auth stubs
    pendingApiAuth,
    completeApiAuth,
    cancelApiAuth,
    triggerApiAuth,

    // Permission mode
    permissionMode,
    cycleMode,
    setSessionPermissionMode,

    // Plan stubs
    activePlan,
    cancelPlan,
    approvePlan,

    // Todos
    todos,

    // Ultrathink
    isUltrathink,
  };
}
