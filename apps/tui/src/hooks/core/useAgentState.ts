/**
 * useAgentState - React hook for agent activation state management
 *
 * Wraps AgentStateManager to provide a reactive interface for TUI components.
 * Handles the agent activation flow including extraction, review, and authentication.
 *
 * Usage:
 * ```tsx
 * const agentState = useAgentState(workspace.id, subAgentManager);
 *
 * // Check status
 * if (agentState.isNeedsMcpAuth) {
 *   return <McpAuth servers={agentState.pendingMcpServers} ... />;
 * }
 *
 * // Trigger activation
 * await agentState.activate(agentId);
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentStateManager, FolderAgentManager } from '@craft-agent/shared/agents';
import type {
  AgentStatus,
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  AgentActivateOptions,
} from '@craft-agent/shared/agents';
import { createApiServer } from '@craft-agent/shared/agents';
import { debug } from '@craft-agent/shared/utils';

export interface UseAgentStateResult {
  // Current status (discriminated union)
  status: AgentStatus;

  // Convenience booleans for status checking
  isIdle: boolean;
  isExtracting: boolean;
  isNeedsMcpAuth: boolean;
  isNeedsApiAuth: boolean;
  isReady: boolean;
  isActive: boolean;
  isError: boolean;

  // Current data (derived from status, type-safe)
  activeDefinition: SubAgentDefinition | null;
  agentId: string | null;
  agentName: string | null;
  extractionMessage: string | null;
  errorMessage: string | null;

  // Pending auth data (derived from status)
  pendingMcpServers: McpServerConfig[] | null;
  pendingApis: ApiConfig[] | null;

  // Actions
  activate: (agentId: string, options?: AgentActivateOptions) => Promise<AgentStatus>;
  continueAfterMcpAuth: () => Promise<AgentStatus>;
  continueAfterApiAuth: () => Promise<AgentStatus>;
  deactivate: () => Promise<void>;
  reload: () => Promise<AgentStatus>;
  reset: () => Promise<void>;
  markActive: () => Promise<void>;

  // Loading state for async operations
  isLoading: boolean;

  // For CraftAgent integration
  buildMcpServerConfig: () => Promise<
    Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  >;
  buildApiServers: () => Promise<Record<string, ReturnType<typeof createApiServer>>>;

  // Access to underlying manager (for advanced use cases)
  manager: AgentStateManager | null;
}

export function useAgentState(
  workspaceId: string,
  folderAgentManager: FolderAgentManager | null
): UseAgentStateResult {
  const [status, setStatus] = useState<AgentStatus>({ status: 'idle' });
  const [isLoading, setIsLoading] = useState(false);
  const managerRef = useRef<AgentStateManager | null>(null);

  // Create/update manager when workspace or folderAgentManager changes
  useEffect(() => {
    if (!folderAgentManager) {
      managerRef.current = null;
      setStatus({ status: 'idle' });
      return;
    }

    debug('[useAgentState] Creating AgentStateManager for workspace:', workspaceId);
    const manager = new AgentStateManager(workspaceId, folderAgentManager);
    managerRef.current = manager;

    // Subscribe to status changes
    const unsubscribe = manager.on('status', (newStatus) => {
      debug('[useAgentState] Status changed:', newStatus.status);
      setStatus(newStatus);
    });

    // Set initial status
    setStatus(manager.getStatus());

    return () => {
      debug('[useAgentState] Cleaning up AgentStateManager');
      unsubscribe();
      managerRef.current = null;
    };
  }, [workspaceId, folderAgentManager]);

  // Derive convenience booleans from status
  const isIdle = status.status === 'idle';
  const isExtracting = status.status === 'extracting';
  const isNeedsMcpAuth = status.status === 'needs_mcp_auth';
  const isNeedsApiAuth = status.status === 'needs_api_auth';
  const isReady = status.status === 'ready';
  const isActive = status.status === 'active';
  const isError = status.status === 'error';

  // Derive data from status (type-safe based on discriminated union)
  const activeDefinition =
    status.status === 'ready' || status.status === 'active' ? status.definition : null;

  const agentId = 'agentId' in status ? status.agentId : null;
  const agentName = 'agentName' in status ? status.agentName : null;

  const extractionMessage = status.status === 'extracting' ? status.message : null;
  const errorMessage = status.status === 'error' ? status.error : null;

  const pendingMcpServers = status.status === 'needs_mcp_auth' ? status.servers : null;
  const pendingApis = status.status === 'needs_api_auth' ? status.apis : null;

  // Actions
  const activate = useCallback(
    async (agentId: string, options?: AgentActivateOptions): Promise<AgentStatus> => {
      if (!managerRef.current) {
        debug('[useAgentState.activate] No manager available');
        return { status: 'idle' };
      }
      setIsLoading(true);
      try {
        return await managerRef.current.activate(agentId, options);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const continueAfterMcpAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!managerRef.current) {
      debug('[useAgentState.continueAfterMcpAuth] No manager available');
      return status;
    }
    setIsLoading(true);
    try {
      return await managerRef.current.continueAfterMcpAuth();
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  const continueAfterApiAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!managerRef.current) {
      debug('[useAgentState.continueAfterApiAuth] No manager available');
      return status;
    }
    setIsLoading(true);
    try {
      return await managerRef.current.continueAfterApiAuth();
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  const deactivate = useCallback(async (): Promise<void> => {
    if (!managerRef.current) {
      debug('[useAgentState.deactivate] No manager available');
      return;
    }
    managerRef.current.deactivate();
  }, []);

  const reload = useCallback(async (): Promise<AgentStatus> => {
    if (!managerRef.current) {
      debug('[useAgentState.reload] No manager available');
      return status;
    }
    setIsLoading(true);
    try {
      return await managerRef.current.reload();
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  const reset = useCallback(async (): Promise<void> => {
    if (!managerRef.current) {
      debug('[useAgentState.reset] No manager available');
      return;
    }
    setIsLoading(true);
    try {
      await managerRef.current.reset();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markActive = useCallback(async (): Promise<void> => {
    if (!managerRef.current) {
      debug('[useAgentState.markActive] No manager available');
      return;
    }
    managerRef.current.markActive();
  }, []);

  // CraftAgent integration
  const buildMcpServerConfig = useCallback(async () => {
    if (!managerRef.current) {
      debug('[useAgentState.buildMcpServerConfig] No manager available');
      return {};
    }
    return managerRef.current.buildMcpServerConfig();
  }, []);

  const buildApiServers = useCallback(async () => {
    if (!managerRef.current) {
      debug('[useAgentState.buildApiServers] No manager available');
      return {};
    }
    return managerRef.current.buildApiServers();
  }, []);

  return {
    status,
    isIdle,
    isExtracting,
    isNeedsMcpAuth,
    isNeedsApiAuth,
    isReady,
    isActive,
    isError,
    activeDefinition,
    agentId,
    agentName,
    extractionMessage,
    errorMessage,
    pendingMcpServers,
    pendingApis,
    activate,
    continueAfterMcpAuth,
    continueAfterApiAuth,
    deactivate,
    reload,
    reset,
    markActive,
    isLoading,
    buildMcpServerConfig,
    buildApiServers,
    manager: managerRef.current,
  };
}
