import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CraftAgent,
  type CraftAgentConfig,
  type Question,
  setUpdateAgentInstructionsContextProvider,
  setUpdateAgentInstructionsResultCallback,
  setUpdateAgentInstructionsProgressCallback,
  setReloadAgentInstructionsCallback,
  setGlobalPermissionHandler,
  resolveGlobalPermission,
  clearGlobalPermissions,
  enterMode,
  exitMode,
  isModeActive,
  type Mode,
} from '@craft-agent/shared/agent';
import { parseSDKErrorText, isSDKErrorText, type AgentError } from '@craft-agent/shared/agent';
import type { UpdateInstructionsContext, UpdateInstructionsProgressEvent } from '@craft-agent/shared/agents';
import type { Message } from '../../components/Messages.tsx';
import type { TodoItem } from '../../components/TodoList.tsx';
import type { FileAttachment } from '@craft-agent/shared/utils';
import { setTerminalProgressIndeterminate, clearTerminalProgress } from '../../utils/terminalProgress.ts';
import {
  getWorkspaceAccessTokenAsync,
  isWorkspaceTokenExpiredAsync,
  updateWorkspaceOAuthTokensAsync,
  checkWorkspaceAuthStatus,
  loadStoredConfig,
  saveConfig,
  loadSession,
  saveSession,
  updateSessionSdkId,
  type Workspace,
  type Session,
  type StoredMessage,
  type StoredSession,
  saveWorkspacePlan,
  loadWorkspacePlan,
  clearWorkspacePlan,
} from '@craft-agent/shared/config';
import { DEFAULT_MODEL } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { CraftMcpClient } from '@craft-agent/shared/mcp';
import { SubAgentManager } from '@craft-agent/shared/agents';
import type { SubAgentDefinition, McpServerConfig, ApiConfig } from '@craft-agent/shared/agents';
import type { ExtractionProgressEvent } from '@craft-agent/shared/agents';
import type { Plan } from '@craft-agent/shared/agents';
import { invalidateDefinition, loadRegistry, clearAgentCredentialsAsync } from '@craft-agent/shared/agents';
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth';
import { debug } from '@craft-agent/shared/utils';
import { containsUltrathink, stripUltrathink } from '../../utils/gradient.ts';
import { useAgentState } from './useAgentState.ts';
import { useSafeMode } from './useModeState.ts';

// MCP auth request for sub-agent servers
export interface PendingMcpAuthRequest {
  servers: McpServerConfig[];
  agentId: string;
  agentName: string;
  definition: SubAgentDefinition;
}

// API auth request for REST API integrations
export interface PendingApiAuthRequest {
  apis: ApiConfig[];
  agentId: string;
  agentName: string;
  definition: SubAgentDefinition;
}

// Helper to convert Message to StoredMessage for persistence
function messageToStoredMessage(msg: Message): StoredMessage {
  return {
    id: msg.id,
    type: msg.type,
    content: msg.content,
    timestamp: msg.timestamp,
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    toolStatus: msg.toolStatus,
    toolDuration: msg.toolDuration,
    isError: msg.isError,
  };
}

/**
 * Detect if a message looks like an SDK error emitted as text output.
 * These shouldn't be persisted as they're session-specific error feedback.
 */
function isSDKErrorMessage(msg: Message): boolean {
  if (msg.type !== 'assistant') return false;
  return isSDKErrorText(msg.content);
}

// Helper to convert StoredMessage back to Message
function storedMessageToMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    type: stored.type,
    content: stored.content,
    timestamp: stored.timestamp,
    toolName: stored.toolName,
    toolInput: stored.toolInput,
    toolStatus: stored.toolStatus,
    toolDuration: stored.toolDuration,
    isError: stored.isError,
  };
}

// Throttle streaming updates to reduce flickering
const STREAMING_THROTTLE_MS = 50;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;  // Current context size (last request's input tokens)
  costUsd: number;
  // Cache stats (for debugging cost issues)
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  command: string;
  description: string;
  type?: 'bash' | 'safe_mode';  // Type of permission request
}

export interface AskUserQuestionRequest {
  requestId: string;
  questions: Question[];
}


export interface UseAgentResult {
  messages: Message[];
  isProcessing: boolean;
  streamingText: string;
  status: string;
  processingStartTime: number | null;
  connected: boolean;
  error: string | null;
  typedError: AgentError | null;
  dismissTypedError: () => void;
  tokenUsage: TokenUsage;
  pendingPermission: PermissionRequest | null;
  pendingQuestion: AskUserQuestionRequest | null;
  hasExecutingTool: boolean;
  sendMessage: (input: string, attachments?: FileAttachment[]) => Promise<void>;
  clearMessages: () => void;
  interrupt: () => void;
  respondToPermission: (allowed: boolean, alwaysAllow?: boolean) => void;
  respondToQuestion: (answers: Record<string, string>) => void;
  // NOTE: model, setModel, workspace, setWorkspace are now in GlobalContext
  // SessionContainer gets them from useGlobalContext() instead
  // Sub-agent related
  availableAgents: string[];
  activeAgentName: string | null;
  activeAgentDefinition: SubAgentDefinition | null;
  activeAgentMcpServers: McpServerConfig[];
  activateAgent: (name: string) => Promise<boolean | 'pending_auth'>;
  deactivateAgent: () => void;
  reloadAgent: () => Promise<boolean>;
  resetAgent: () => Promise<boolean>;
  refreshAgents: () => Promise<string[] | { error: string }>;
  fetchTools: () => Promise<{ name: string; tools: { name: string; description?: string }[] }[]>;
  agentsLoading: boolean;
  // MCP auth for sub-agent servers
  pendingMcpAuth: PendingMcpAuthRequest | null;
  completeMcpAuth: (success: boolean) => Promise<void>;
  cancelMcpAuth: () => void;
  triggerMcpAuth: () => void;  // For /auth command
  // API auth for REST API integrations
  pendingApiAuth: PendingApiAuthRequest | null;
  completeApiAuth: (success: boolean) => Promise<void>;
  cancelApiAuth: () => void;
  triggerApiAuth: () => void;  // For reauth command
  // Plan/Safe mode
  activePlan: Plan | null;
  safeMode: boolean;
  cancelPlan: () => void;
  approvePlan: () => void;
  shouldSuggestPlanning: (message: string) => boolean;
  // Generic mode toggle API
  setMode: (mode: Mode, enabled: boolean) => void;
  // Legacy mode toggle aliases (deprecated - use setMode instead)
  startSafeMode: () => void;
  exitSafeModeAction: () => void;
  // Todos (from TodoWrite tool)
  todos: TodoItem[];
  // Ultrathink mode (extended thinking)
  isUltrathink: boolean;
}

export function useAgent(config: CraftAgentConfig): UseAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState('');
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  // NOTE: model, workspace, and session state removed - now managed by GlobalContext
  // useAgent receives these via config prop, no internal state needed
  // When session changes, SessionContainer remounts (key={session.id})
  // which automatically resets all useState/useRef in this hook
  const workspace = config.workspace;
  const session = config.session;
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [hasExecutingTool, setHasExecutingTool] = useState(false);
  const [typedError, setTypedError] = useState<AgentError | null>(null);

  // Sub-agent state - discovery only (activation state delegated to useAgentState)
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  // SubAgentManager as state (not ref) so useAgentState can react to it
  const [subAgentManager, setSubAgentManager] = useState<SubAgentManager | null>(null);

  // Delegate agent activation state to useAgentState hook
  // This manages pendingMcpAuth, pendingApiAuth internally
  const agentState = useAgentState(workspace.id, subAgentManager);

  // Ultrathink mode (extended thinking)
  const [isUltrathink, setIsUltrathink] = useState(false);

  // Safe mode state - uses useSyncExternalStore for direct Mode Manager integration
  // No more React state duplication - Mode Manager is the single source of truth
  const safeMode = useSafeMode(session?.id);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  // Todos (from TodoWrite tool)
  const [todos, setTodos] = useState<TodoItem[]>([]);


  const agentRef = useRef<CraftAgent | null>(null);
  // Keep ref for backward compatibility with existing code that uses agentManagerRef.current
  const agentManagerRef = useRef<SubAgentManager | null>(null);
  const mcpClientRef = useRef<CraftMcpClient | null>(null);
  const toolStartTimeRef = useRef<Map<string, number>>(new Map());
  const streamingBufferRef = useRef<string>('');
  const lastStreamingUpdateRef = useRef<number>(0);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptedRef = useRef<boolean>(false);
  const reloadAgentRef = useRef<(() => Promise<boolean>) | null>(null);
  const sendMessageRef = useRef<((input: string, attachments?: FileAttachment[], options?: { hideUserMessage?: boolean }) => Promise<void>) | null>(null);
  const activeAgentContextRef = useRef<UpdateInstructionsContext | null>(null);
  // Track the message ID for update_agent_instructions tool (for progress updates)
  const updateInstructionsToolMsgIdRef = useRef<string | null>(null);
  // Track SDK text error for this request (to handle React batching)
  // When SDK emits error as text AND throws, we want to keep the text error (more specific)
  const sdkTextErrorRef = useRef<AgentError | null>(null);
  // Debounce timer for session auto-save (prevents excessive disk I/O during streaming)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track pending save data for flush on unmount
  const pendingSaveRef = useRef<StoredSession | null>(null);

  // Load saved conversation on initial mount (only if edited within last 5 minutes)
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    // Load conversation from session storage (primary scope)
    if (!session) return;

    const savedSession = loadSession(session.id);
    if (savedSession && savedSession.messages && savedSession.messages.length > 0) {
      // Only restore if conversation was edited within the last 5 minutes
      const fiveMinutesMs = 5 * 60 * 1000;
      const isRecent = savedSession.lastUsedAt && (Date.now() - savedSession.lastUsedAt) < fiveMinutesMs;

      if (isRecent) {
        const restoredMessages = savedSession.messages.map(storedMessageToMessage);
        setMessages(restoredMessages);
        // Provide defaults for cache fields that may not exist in old saved sessions
        setTokenUsage({
          ...savedSession.tokenUsage,
          cacheReadTokens: savedSession.tokenUsage.cacheReadTokens ?? 0,
          cacheCreationTokens: savedSession.tokenUsage.cacheCreationTokens ?? 0,
        });
      }
      // Note: Unlike workspace model, we don't clear stale sessions - they're historical records
    }
  }, []);  // Empty deps - only run on mount

  // Auto-save conversation when messages change and we're not processing
  // Uses debouncing (500ms) to prevent excessive disk I/O during streaming
  const SAVE_DEBOUNCE_MS = 500;

  useEffect(() => {
    // Skip during initial load or if no session
    if (!initialLoadDoneRef.current) return;
    if (!session) return;
    // Only save if we have messages and we're not currently processing
    if (messages.length > 0 && !isProcessing) {
      // Filter out transient messages that shouldn't persist across sessions:
      // - error: Session-specific feedback, not meaningful after restart
      // - status: Temporary processing status messages
      // - system: Internal system notifications (e.g., "Interrupted")
      // - SDK error messages emitted as assistant text (e.g., "Invalid API key · Fix external API key")
      const persistableMessages = messages.filter(
        m => m.type !== 'error' && m.type !== 'status' && m.type !== 'system' && !isSDKErrorMessage(m)
      );
      const storedMessages = persistableMessages.map(messageToStoredMessage);

      // Prepare session data for save
      const updatedSession: StoredSession = {
        id: session.id,
        sdkSessionId: agentRef.current?.getSessionId() ?? session.sdkSessionId,
        workspaceId: session.workspaceId,
        name: session.name,
        createdAt: session.createdAt,
        lastUsedAt: Date.now(),
        messages: storedMessages,
        tokenUsage,
      };

      // Store pending save data for potential flush on unmount
      pendingSaveRef.current = updatedSession;

      // Cancel any pending save
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }

      // Debounced save - prevents excessive disk I/O during streaming
      saveDebounceRef.current = setTimeout(() => {
        if (pendingSaveRef.current) {
          saveSession(pendingSaveRef.current);
          pendingSaveRef.current = null;
        }
        saveDebounceRef.current = null;

        // Also update SDK session ID if it changed (for resuming conversations)
        const sdkSessionId = agentRef.current?.getSessionId();
        debug('[useAgent] SDK session check:', sdkSessionId, 'current:', session.sdkSessionId, 'hasCallback:', !!config.onSdkSessionIdUpdate);
        if (sdkSessionId && sdkSessionId !== session.sdkSessionId) {
          debug('[useAgent] Updating SDK session ID:', sdkSessionId);
          updateSessionSdkId(session.id, sdkSessionId);
          // Propagate to React state so UI stays in sync
          config.onSdkSessionIdUpdate?.(sdkSessionId);
        }
      }, SAVE_DEBOUNCE_MS);
    }
  }, [messages, isProcessing, session, tokenUsage, config]);

  // Cleanup: flush pending save on unmount to prevent data loss
  useEffect(() => {
    return () => {
      // Cancel any pending debounced save
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      // Flush pending save immediately on unmount
      if (pendingSaveRef.current) {
        saveSession(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    };
  }, []);

  // Helper to get MCP token for current workspace
  const getMcpToken = useCallback(async (): Promise<string | null> => {
    // Get token from credential store (handles bearer token, OAuth, and legacy config fallback)
    const { authType, token } = await getWorkspaceAccessTokenAsync(workspace.id);
    if (!token) {
      if (authType !== 'public') {
        throw new Error('No authentication credentials found for workspace. Please re-add the workspace.');
      }
      return null;
    }

    // Check if token is expired and refresh if needed (only for OAuth tokens)
    const isExpired = authType === 'workspace_oauth' ? await isWorkspaceTokenExpiredAsync(workspace.id) : false;
    if (isExpired) {
      // Get full OAuth credentials from credential store for refresh
      const manager = getCredentialManager();
      const oauthCreds = await manager.getWorkspaceOAuth(workspace.id);

      if (oauthCreds?.refreshToken && oauthCreds?.clientId) {
        try {
          const oauth = new CraftOAuth(
            { mcpBaseUrl: getMcpBaseUrl(workspace.mcpUrl) },
            { onStatus: () => {}, onError: () => {} }
          );

          const newTokens = await oauth.refreshAccessToken(
            oauthCreds.refreshToken,
            oauthCreds.clientId
          );

          // Save refreshed tokens to credential store
          await updateWorkspaceOAuthTokensAsync(
            workspace.id,
            newTokens.accessToken,
            newTokens.refreshToken,
            newTokens.expiresAt,
            oauthCreds.clientId,
            newTokens.tokenType
          );

          return newTokens.accessToken;
        } catch {
          // Refresh failed, return existing token (may still work)
          return token;
        }
      }
    }

    return token;
  }, [workspace.id, workspace.isPublic, workspace.mcpUrl]);

  // Initialize MCP client and agent manager for current workspace
  // Only re-run when workspace ID changes (not on every workspace state update)
  useEffect(() => {
    let cancelled = false;

    // Load cached agents immediately (before async discovery)
    const cachedRegistry = loadRegistry(workspace.id);
    if (cachedRegistry && cachedRegistry.agents.length > 0) {
      const cachedNames = cachedRegistry.agents.map(a => a.name);
      debug('[useAgent] Loaded cached agents:', cachedNames);
      setAvailableAgents(cachedNames);
    }

    const initializeAgentManager = async () => {
      setAgentsLoading(true);
      try {
        // Check MCP auth status before attempting connection
        const authStatus = await checkWorkspaceAuthStatus(workspace.id);
        if (authStatus.needsAuth) {
          // MCP authentication is required but missing - log and skip initialization
          // This will cause connection to fail with a clear error when user tries to use agent
          debug('[useAgent] MCP auth needed:', authStatus.message);
          setError(`MCP authentication required. ${authStatus.message || 'Please re-authenticate.'}`);
          setConnected(false);
          setAgentsLoading(false);
          return;
        }

        // Build MCP URL
        let mcpUrl = workspace.mcpUrl;
        mcpUrl = mcpUrl.replace(/\/+$/, '');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
          if (!mcpUrl.endsWith('/mcp')) {
            mcpUrl = mcpUrl + '/mcp';
          }
        }

        // Get token from credential store
        const token = await getMcpToken();

        // Create MCP client
        const client = new CraftMcpClient({
          url: mcpUrl,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        // Connect
        await client.connect();

        if (cancelled) {
          await client.close();
          return;
        }

        mcpClientRef.current = client;

        // Create agent manager with MCP config for agentic extraction
        const manager = new SubAgentManager(workspace.id, client, {
          model: config.model || DEFAULT_MODEL,
          mcpUrl,
          mcpToken: token || undefined,
        });
        agentManagerRef.current = manager;
        // Also set state so useAgentState can react to it
        if (!cancelled) {
          setSubAgentManager(manager);
        }

        // Discover agents
        const agents = await manager.discoverAgents();
        if (!cancelled) {
          setAvailableAgents(agents.map(a => a.name));
        }
      } catch (err) {
        // Log to debug file - viewable with `craft --debug`
        debug('Failed to initialize agent manager:', err);
      } finally {
        if (!cancelled) {
          setAgentsLoading(false);
        }
      }
    };

    initializeAgentManager();

    return () => {
      cancelled = true;
      // Clean up MCP client on unmount or workspace change
      if (mcpClientRef.current) {
        mcpClientRef.current.close().catch(() => {});
        mcpClientRef.current = null;
      }
      agentManagerRef.current = null;
      setSubAgentManager(null);
      // Clear agent instructions callbacks
      setUpdateAgentInstructionsContextProvider(null);
      setUpdateAgentInstructionsResultCallback(null);
      setUpdateAgentInstructionsProgressCallback(null);
      setGlobalPermissionHandler(null);
      activeAgentContextRef.current = null;
      updateInstructionsToolMsgIdRef.current = null;
      // Agent state is managed by useAgentState - it will reset when subAgentManager becomes null
      // Don't clear availableAgents here - it causes race condition with token refresh
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.mcpUrl, workspace.isPublic, getMcpToken]);

  // Subscribe to agentState extraction progress for UI messages
  // Track extraction message ID and start time for progress updates
  const extractionMsgIdRef = useRef<string | null>(null);
  const extractionStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!agentState.manager) return;

    const unsubProgress = agentState.manager.on('progress', (event) => {
      // Create or update extraction message for progress events
      if (event.type === 'extraction_progress') {
        if (!extractionMsgIdRef.current) {
          // Create initial extraction message
          extractionMsgIdRef.current = `extraction-${Date.now()}`;
          extractionStartTimeRef.current = Date.now();
          setMessages(prev => [...prev, {
            id: extractionMsgIdRef.current!,
            type: 'tool',
            content: event.message || '',
            timestamp: Date.now(),
            toolName: 'Loading Agent',
            toolInput: { agent: agentState.agentName || 'unknown' },
            toolStatus: 'executing',
          }]);
        } else {
          // Update existing extraction message with progress
          setMessages(prev => prev.map(m =>
            m.id === extractionMsgIdRef.current
              ? { ...m, content: event.message || '' }
              : m
          ));
        }
      }
    });

    const unsubStatus = agentState.manager.on('status', (status) => {
      // Update extraction message when extraction completes (transitions out of 'extracting')
      if (extractionMsgIdRef.current && status.status !== 'extracting') {
        const duration = extractionStartTimeRef.current
          ? Date.now() - extractionStartTimeRef.current
          : undefined;
        const definition = 'definition' in status ? status.definition : null;

        setMessages(prev => prev.map(m =>
          m.id === extractionMsgIdRef.current
            ? {
                ...m,
                toolStatus: status.status === 'error' ? 'error' as const : 'completed' as const,
                toolResult: status.status === 'error'
                  ? 'Failed to load agent'
                  : `Loaded ${definition?.instructions?.length || 0} chars of instructions`,
                toolDuration: duration,
                isError: status.status === 'error',
              }
            : m
        ));

        // Clear the refs for next extraction
        extractionMsgIdRef.current = null;
        extractionStartTimeRef.current = null;
      }
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, [agentState.manager, agentState.agentName]);

  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      agentRef.current = new CraftAgent(config);
      // Set up permission request callback (for bash commands from agent)
      agentRef.current.onPermissionRequest = (request) => {
        setPendingPermission(request);
      };
      // Set up AskUserQuestion callback
      agentRef.current.onAskUserQuestion = (request) => {
        setPendingQuestion(request);
      };
      // Set up debug callback for SDK message logging
      agentRef.current.onDebug = (message) => {
        debug('[SDK]', message);
      };
      // Note: onSafeModeChange callback removed - useSafeMode hook subscribes directly to Mode Manager
      // Set up plan submitted callback - injects plan as a message
      agentRef.current.onPlanSubmitted = (planPath) => {
        debug('[SDK] Plan submitted:', planPath);
        // Add plan message to the conversation
        setMessages((prev) => [
          ...prev,
          {
            id: `plan-${Date.now()}`,
            type: 'plan',
            content: planPath,  // The path to the plan file
            timestamp: Date.now(),
          },
        ]);
      };
      // Sync current model to the newly created agent
      agentRef.current.setModel(config.model || DEFAULT_MODEL);
      // Restore SDK session ID from session if available (for conversation continuity)
      if (session?.sdkSessionId) {
        agentRef.current.setSessionId(session.sdkSessionId);
      }
    }

    // Always set up global callbacks (may have been cleared by workspace change)
    // These are module-level callbacks, not per-agent, so must be re-set each time
    setGlobalPermissionHandler((request) => {
      setPendingPermission(request);
    });

    // Progress callback - updates tool message content during execution
    setUpdateAgentInstructionsProgressCallback((event: UpdateInstructionsProgressEvent) => {
      if (event.type !== 'tool_start') return;

      const toolMsgId = updateInstructionsToolMsgIdRef.current;
      if (!toolMsgId) {
        debug('[useAgent] Progress event but no toolMsgId - ref not set yet');
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === toolMsgId
            ? { ...m, content: event.message }
            : m
        )
      );
    });

    return agentRef.current;
  }, [config, session]);

  const respondToPermission = useCallback((allowed: boolean, alwaysAllow: boolean = false) => {
    if (pendingPermission) {
      // Try to resolve via agent first (for bash commands)
      if (agentRef.current) {
        agentRef.current.respondToPermission(pendingPermission.requestId, allowed, alwaysAllow);
      }
      // Also try to resolve via global system (for MCP tools like update_agent_instructions)
      resolveGlobalPermission(pendingPermission.requestId, allowed);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  const respondToQuestion = useCallback((answers: Record<string, string>) => {
    if (pendingQuestion && agentRef.current) {
      agentRef.current.respondToQuestion(pendingQuestion.requestId, answers);
      setPendingQuestion(null);
    }
  }, [pendingQuestion]);

  // Generic mode toggle API - works with any mode type
  const setMode = useCallback((mode: Mode, enabled: boolean) => {
    if (!session?.id) {
      debug(`[setMode] No session ID, cannot ${enabled ? 'enter' : 'exit'} ${mode} mode`);
      return;
    }
    debug(`[setMode] ${enabled ? 'Entering' : 'Exiting'} ${mode} mode for session:`, session.id);
    if (enabled) {
      enterMode(session.id, mode);
    } else {
      exitMode(session.id, mode);
    }
  }, [session?.id]);

  // Legacy aliases for backward compatibility (use setMode instead)
  const startSafeMode = useCallback(() => setMode('safe', true), [setMode]);
  const exitSafeModeAction = useCallback(() => setMode('safe', false), [setMode]);

  const dismissTypedError = useCallback(() => {
    setTypedError(null);
  }, []);

  const sendMessage = useCallback(async (
    input: string,
    attachments?: FileAttachment[],
    options?: { hideUserMessage?: boolean }
  ) => {
    if (isProcessing) return;

    // Clear SDK text error ref for this new request
    sdkTextErrorRef.current = null;

    // Detect ultrathink mode and strip keyword from message
    const ultrathinkDetected = containsUltrathink(input);
    const cleanInput = ultrathinkDetected ? stripUltrathink(input) : input;
    setIsUltrathink(ultrathinkDetected);

    const agent = getAgent();

    // Configure ultrathink mode on agent
    agent.setUltrathinkMode(ultrathinkDetected);

    // Add user message (include attachment names in display) - unless hidden
    // Show original input (with ultrathink) in the UI
    if (!options?.hideUserMessage) {
      const attachmentInfo = attachments && attachments.length > 0
        ? `\n[Attached: ${attachments.map(a => a.name).join(', ')}]`
        : '';

      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          type: 'user',
          content: input + attachmentInfo,
          timestamp: Date.now(),
        },
      ]);
    }

    // Log safe mode status
    const agentSafeMode = agent.isInSafeMode();
    debug('[sendMessage] safeMode:', agentSafeMode);

    setIsProcessing(true);
    setProcessingStartTime(Date.now());
    setTerminalProgressIndeterminate();
    setStreamingText('');
    setStatus('');
    setError(null);
    setTypedError(null);  // Clear any typed errors from previous request
    // Clear completed todos from UI on new message
    setTodos(prev => prev.filter(t => t.status !== 'completed'));
    toolStartTimeRef.current.clear();
    streamingBufferRef.current = '';
    lastStreamingUpdateRef.current = 0;
    interruptedRef.current = false;
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }

    let assistantText = '';

    // Throttled streaming update function
    const updateStreamingText = (text: string) => {
      streamingBufferRef.current = text;
      const now = Date.now();
      const timeSinceLastUpdate = now - lastStreamingUpdateRef.current;

      if (timeSinceLastUpdate >= STREAMING_THROTTLE_MS) {
        // Enough time has passed, update immediately
        lastStreamingUpdateRef.current = now;
        setStreamingText(text);
      } else {
        // Schedule update for later
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current);
        }
        streamingTimeoutRef.current = setTimeout(() => {
          lastStreamingUpdateRef.current = Date.now();
          setStreamingText(streamingBufferRef.current);
          streamingTimeoutRef.current = null;
        }, STREAMING_THROTTLE_MS - timeSinceLastUpdate);
      }
    };

    try {
      for await (const event of agent.chat(cleanInput, attachments)) {
        // Check if interrupted
        if (interruptedRef.current) {
          break;
        }

        switch (event.type) {
          case 'status':
            setStatus(event.message);
            break;

          case 'text_delta':
            assistantText += event.text;
            updateStreamingText(assistantText);
            setStatus('');
            // Mark any executing tools as completed when text arrives
            // (Built-in SDK tools like WebFetch don't emit tool_result events)
            // But DON'T clear toolStartTimeRef - let tool_result handle that so it can update content
            if (toolStartTimeRef.current.size > 0) {
              setHasExecutingTool(false);
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.type === 'tool' && m.toolStatus === 'executing') {
                    const toolUseId = m.id.replace('tool-', '');
                    const startTime = toolStartTimeRef.current.get(toolUseId);
                    const duration = startTime ? Date.now() - startTime : undefined;
                    // Don't delete from ref here - tool_result needs to find and update content
                    return {
                      ...m,
                      toolStatus: 'completed' as const,
                      toolDuration: duration,
                    };
                  }
                  return m;
                })
              );
            }
            break;

          case 'text_complete':
            assistantText = event.text;
            setStreamingText('');

            // Check if this is an SDK error emitted as text
            // If so, parse it and trigger typed error directly
            const sdkError = parseSDKErrorText(assistantText);
            if (sdkError) {
              // Store in ref so typed_error handler knows we already have a specific error
              // (React batching means state might not be updated yet when typed_error arrives)
              sdkTextErrorRef.current = sdkError;
              setTypedError(sdkError);
              assistantText = '';
              break;
            }

            // Plan mode: Claude writes plan to file and calls SubmitPlan, which triggers onPlanSubmitted callback
            // The plan is rendered as a special message type in the conversation

            // Normal assistant message
            if (assistantText.trim()) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  type: 'assistant',
                  content: assistantText,
                  timestamp: Date.now(),
                },
              ]);
            }
            assistantText = '';
            break;

          case 'tool_start': {
            const now = Date.now();
            const toolMessageId = `tool-${event.toolUseId}`;

            // Mark any previously executing tools as completed
            // (New tool starting means previous tools must have finished)
            if (toolStartTimeRef.current.size > 0) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.type === 'tool' && m.toolStatus === 'executing' && m.id !== toolMessageId) {
                    const existingToolUseId = m.id.replace('tool-', '');
                    const startTime = toolStartTimeRef.current.get(existingToolUseId);
                    const duration = startTime ? now - startTime : undefined;
                    toolStartTimeRef.current.delete(existingToolUseId);
                    return {
                      ...m,
                      toolStatus: 'completed' as const,
                      toolDuration: duration,
                    };
                  }
                  return m;
                })
              );
            }

            toolStartTimeRef.current.set(event.toolUseId, now);
            // Clear status and mark that we have an executing tool
            setStatus('');
            setHasExecutingTool(true);
            // Track update_agent_instructions tool for progress updates
            // Check for exact match or MCP-prefixed version (mcp__preferences__update_agent_instructions)
            if (event.toolName === 'update_agent_instructions' || event.toolName?.includes('update_agent_instructions')) {
              updateInstructionsToolMsgIdRef.current = toolMessageId;
            }

            // Capture TodoWrite tool calls to update todo list UI
            if (event.toolName === 'TodoWrite' && event.input?.todos) {
              const newTodos = event.input.todos as TodoItem[];
              setTodos(newTodos);
            }

            setMessages((prev) => {
              // Check if a tool message with this ID already exists
              const existingIndex = prev.findIndex((m) => m.id === toolMessageId);
              if (existingIndex >= 0) {
                // Update existing message with better input data or intent if available
                const existing = prev[existingIndex]!;
                const hasNewInput = event.input && Object.keys(event.input).length > 0;
                const existingHasInput = existing.toolInput && Object.keys(existing.toolInput).length > 0;
                const hasNewIntent = event.intent && !existing.toolIntent;
                if ((hasNewInput && !existingHasInput) || hasNewIntent) {
                  const updated = [...prev];
                  updated[existingIndex] = {
                    ...existing,
                    toolInput: (hasNewInput && !existingHasInput) ? event.input : existing.toolInput,
                    toolIntent: event.intent || existing.toolIntent,
                  };
                  return updated;
                }
                return prev;
              }
              return [
                ...prev,
                {
                  id: toolMessageId,
                  type: 'tool',
                  toolName: event.toolName,
                  toolInput: event.input,
                  toolIntent: event.intent,
                  toolStatus: 'executing',
                  content: '',
                  timestamp: now,
                },
              ];
            });
            break;
          }

          case 'tool_result': {
            const startTime = toolStartTimeRef.current.get(event.toolUseId);
            const duration = startTime ? Date.now() - startTime : undefined;
            toolStartTimeRef.current.delete(event.toolUseId);

            // Clear update_agent_instructions tracking if this was that tool
            const toolMessageId = `tool-${event.toolUseId}`;
            if (updateInstructionsToolMsgIdRef.current === toolMessageId) {
              updateInstructionsToolMsgIdRef.current = null;
            }

            // Clear executing tool flag if no more tools are running
            if (toolStartTimeRef.current.size === 0) {
              setHasExecutingTool(false);
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === `tool-${event.toolUseId}`
                  ? {
                      ...m,
                      toolStatus: event.isError ? 'error' : 'completed',
                      content: event.result,
                      isError: event.isError,
                      // Preserve existing duration if we don't have a new one
                      toolDuration: duration ?? m.toolDuration,
                      // Only use event.input if it has keys, otherwise preserve existing
                      toolInput: (event.input && Object.keys(event.input).length > 0) ? event.input : m.toolInput,
                    }
                  : m
              )
            );
            setStatus('');
            break;
          }

          case 'error':
            setError(event.message);
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                type: 'error',
                content: event.message,
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'typed_error':
            // Set typed error for ErrorBanner display
            // Don't add to messages - the banner already shows the error with recovery actions
            // If we already detected SDK error in text_complete, it's already set - skip
            // Otherwise use the error from craft-agent.ts
            if (!sdkTextErrorRef.current) {
              setTypedError(event.error);
            }
            // If ref is set, error was already set in text_complete handler
            break;

          case 'complete':
            if (event.usage) {
              setTokenUsage((prev) => ({
                inputTokens: prev.inputTokens + event.usage!.inputTokens,
                outputTokens: prev.outputTokens + event.usage!.outputTokens,
                totalTokens:
                  prev.totalTokens +
                  event.usage!.inputTokens +
                  event.usage!.outputTokens,
                contextTokens: event.usage!.inputTokens,  // Current context size
                costUsd: prev.costUsd + (event.usage!.costUsd ?? 0),
                cacheReadTokens: prev.cacheReadTokens + (event.usage!.cacheReadTokens ?? 0),
                cacheCreationTokens: prev.cacheCreationTokens + (event.usage!.cacheCreationTokens ?? 0),
              }));
            }
            break;
        }
      }

      setConnected(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);

      if (
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('fetch failed')
      ) {
        setConnected(false);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          type: 'error',
          content: errorMessage,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      // Clean up any pending streaming timeout
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
        streamingTimeoutRef.current = null;
      }

      // Mark any still-executing tools as completed
      // This handles cases where the SDK doesn't emit a tool_result event
      // (e.g., MCP tools, internal tools, or tools that complete silently)
      const pendingToolIds = Array.from(toolStartTimeRef.current.keys());
      if (pendingToolIds.length > 0) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.type === 'tool' && m.toolStatus === 'executing') {
              const toolUseId = m.id.replace('tool-', '');
              const startTime = toolStartTimeRef.current.get(toolUseId);
              const duration = startTime ? Date.now() - startTime : undefined;
              return {
                ...m,
                toolStatus: 'completed' as const,
                toolDuration: duration,
              };
            }
            return m;
          })
        );
      }

      clearTerminalProgress();
      setIsProcessing(false);
      setProcessingStartTime(null);
      setStreamingText('');
      setStatus('');
      setHasExecutingTool(false);
    }
  }, [getAgent, isProcessing, safeMode, activePlan, workspace.id]);

  // Keep sendMessageRef updated
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    if (agentRef.current) {
      agentRef.current.clearHistory();
    }
    // Note: With session-based scoping, /clear creates a NEW session via startNewSession()
    // which triggers component remount with fresh state. This function just clears local state.
    // The session file is preserved as historical record.
  }, []);

  const interrupt = useCallback(() => {
    // Set interrupted flag first to break out of the event loop
    interruptedRef.current = true;

    if (agentRef.current) {
      agentRef.current.interrupt();
    }
    setIsProcessing(false);
    setStreamingText('');
    setStatus('');

    // Clear safe mode state to avoid being stuck
    if (session?.id) {
      exitMode(session.id, 'safe');
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        type: 'system',
        content: 'Interrupted',
        timestamp: Date.now(),
      },
    ]);
  }, []);

  // Sync model changes to CraftAgent (GlobalContext is source of truth)
  // When model changes in GlobalContext → config.model updates → update agent
  useEffect(() => {
    if (config.model && agentRef.current) {
      agentRef.current.setModel(config.model);
    }
  }, [config.model]);

  // NOTE: setWorkspace callback REMOVED - no longer needed!
  // With key-based session isolation (SessionContainer key={session.id}):
  // 1. When session changes in GlobalContext (workspace switch, /clear, --new)
  // 2. SessionContainer unmounts (cleanup runs below)
  // 3. New SessionContainer mounts with fresh state
  // 4. useAgent runs fresh, initialLoadDoneRef resets, conversation loads
  // All the manual state cleanup that was here is now automatic!

  // Save conversation on unmount (when switching sessions)
  // Use refs to capture current values since cleanup runs after render
  const messagesRef = useRef(messages);
  const tokenUsageRef = useRef(tokenUsage);
  const sessionRef = useRef(session);
  messagesRef.current = messages;
  tokenUsageRef.current = tokenUsage;
  sessionRef.current = session;

  useEffect(() => {
    return () => {
      // Save conversation when component unmounts (session switch)
      const currentMessages = messagesRef.current;
      const currentSession = sessionRef.current;
      const sdkSessionId = agentRef.current?.getSessionId() ?? null;

      if (currentSession && currentMessages.length > 0) {
        const persistableMessages = currentMessages.filter(
          m => m.type !== 'error' && m.type !== 'status' && m.type !== 'system' && !isSDKErrorMessage(m)
        );
        const storedMessages = persistableMessages.map(messageToStoredMessage);

        // Save to session storage
        const updatedSession: StoredSession = {
          id: currentSession.id,
          sdkSessionId: sdkSessionId ?? currentSession.sdkSessionId,
          workspaceId: currentSession.workspaceId,
          name: currentSession.name,
          createdAt: currentSession.createdAt,
          lastUsedAt: Date.now(),
          messages: storedMessages,
          tokenUsage: tokenUsageRef.current,
        };
        saveSession(updatedSession);
      }

      // Dispose the agent instance (clears all instance state)
      if (agentRef.current) {
        agentRef.current.dispose();
        agentRef.current = null;
      }

      // Clear global callbacks to prevent stale references
      clearGlobalPermissions();
      setReloadAgentInstructionsCallback(null);

      // Clear streaming timeout
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
    };
  }, [session?.id]);

  // Complete agent activation - called when ENTIRE setup (extraction + all auth) is done
  // isFirstTimeSetup: true when extraction happened (show info), false when switching to cached agent
  const activationComplete = useCallback((
    definition: SubAgentDefinition,
    mcpServers: Awaited<ReturnType<SubAgentManager['buildMcpServerConfig']>>,
    apiServers: Awaited<ReturnType<SubAgentManager['buildApiServers']>>,
    agentName: string,
    isFirstTimeSetup: boolean,
    agentId: string,
  ) => {
    const agent = getAgent();
    agent.setActiveAgentDefinition(definition, mcpServers, apiServers);

    // Get the document ID from the registry
    const registry = loadRegistry(workspace.id);
    const agentMeta = registry?.agents.find(a => a.id === agentId);
    const documentId = agentMeta?.documentId || '';

    // Build MCP URL for the context
    let mcpUrl = workspace.mcpUrl;
    mcpUrl = mcpUrl.replace(/\/+$/, '');
    if (!mcpUrl.endsWith('/mcp')) {
      mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl + '/mcp';
      }
    }

    // Store context for update instructions callbacks
    activeAgentContextRef.current = {
      documentId,
      instructionsBlockId: definition.instructionsBlockId,
      currentInstructions: definition.instructions,
      agentName: definition.name,
      mcpUrl,
      workspaceId: workspace.id,
      model: config.model || DEFAULT_MODEL,
    };

    // Set context provider callback - returns the current context
    setUpdateAgentInstructionsContextProvider(() => {
      return activeAgentContextRef.current;
    });

    // Set result callback - invalidates cache on success
    setUpdateAgentInstructionsResultCallback(async (success: boolean) => {
      if (success && agentManagerRef.current) {
        // Invalidate cache so next reload gets fresh content
        invalidateDefinition(workspace.id, agentId);
        debug('[activationComplete] Cache invalidated after instructions update');
      }
    });

    // Set reload callback for agent tools
    setReloadAgentInstructionsCallback(async () => {
      if (reloadAgentRef.current) {
        return reloadAgentRef.current();
      }
      return false;
    });

    // Build activation message - include info only on first-time setup
    let content = `Now chatting with @${agentName}`;
    if (isFirstTimeSetup && definition.info && definition.info.length > 0) {
      content += '\n' + definition.info.map(msg => `• ${msg}`).join('\n');
    }

    // Show capabilities if available
    if (isFirstTimeSetup && definition.capabilities && definition.capabilities.length > 0) {
      content += '\n\nCapabilities:\n' + definition.capabilities.map(c => `• ${c}`).join('\n');
    }

    setMessages(prev => [...prev, {
      id: `activation-${Date.now()}`,
      type: 'info',
      content,
      timestamp: Date.now(),
    }]);
  }, [getAgent]);

  // Sub-agent functions - now delegating state management to useAgentState
  const activateAgent = useCallback(async (name: string): Promise<boolean | 'pending_auth'> => {
    debug('[useAgent.activateAgent] Activating:', name, 'manager exists:', !!agentManagerRef.current);
    if (!agentManagerRef.current) {
      debug('[useAgent.activateAgent] No agent manager available');
      return false;
    }

    // Get the agent ID from the name
    const agents = await agentManagerRef.current.getAvailableAgents();
    const agentMeta = agents.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!agentMeta) {
      debug('[useAgent.activateAgent] Agent not found:', name);
      return false;
    }
    const agentId = agentMeta.id;

    // Delegate to agentState - handles extraction, review, and auth checks
    const resultStatus = await agentState.activate(agentId);
    debug('[useAgent.activateAgent] agentState.activate returned:', resultStatus.status);

    // Handle result status
    switch (resultStatus.status) {
      case 'ready': {
        // All checks passed - complete activation
        const definition = resultStatus.definition;
        const mcpServers = await agentState.buildMcpServerConfig();
        const apiServers = await agentState.buildApiServers();
        const isFirstTimeSetup = true; // agentState tracks this internally
        debug('[useAgent.activateAgent] Completing activation');
        activationComplete(definition, mcpServers, apiServers, name, isFirstTimeSetup, agentId);
        agentState.markActive();
        return true;
      }
      case 'needs_mcp_auth':
      case 'needs_api_auth':
        // Waiting for user input - return pending
        debug('[useAgent.activateAgent] Needs user input:', resultStatus.status);
        return 'pending_auth';
      case 'error':
        debug('[useAgent.activateAgent] Activation error:', resultStatus.error);
        return false;
      default:
        return false;
    }
  }, [agentState, activationComplete]);

  const deactivateAgent = useCallback(() => {
    // Delegate to agentState - handles SubAgentManager cleanup
    agentState.deactivate();
    // Clear the CraftAgent's active agent definition, MCP servers, and API servers
    if (agentRef.current) {
      agentRef.current.setActiveAgentDefinition(null, {}, {});
    }
    // Clear callbacks for agent tools
    setUpdateAgentInstructionsContextProvider(null);
    setUpdateAgentInstructionsResultCallback(null);
    activeAgentContextRef.current = null;
    setReloadAgentInstructionsCallback(null);
  }, [agentState]);

  // Reload current agent instructions (preserves auth credentials)
  const reloadAgent = useCallback(async (): Promise<boolean> => {
    if (!agentState.activeDefinition) {
      return false;
    }

    const agentName = agentState.agentName;
    debug('[useAgent.reloadAgent] Reloading agent:', agentName);

    // Delegate to agentState - handles cache invalidation and re-extraction
    const resultStatus = await agentState.reload();
    debug('[useAgent.reloadAgent] agentState.reload returned:', resultStatus.status);

    // Handle result status
    if (resultStatus.status === 'ready') {
      // Complete activation with CraftAgent
      const definition = resultStatus.definition;
      const mcpServers = await agentState.buildMcpServerConfig();
      const apiServers = await agentState.buildApiServers();
      const agentId = agentState.agentId!;
      activationComplete(definition, mcpServers, apiServers, agentName!, true, agentId);
      agentState.markActive();
      return true;
    }

    // 'pending_auth' states mean reload is proceeding but waiting for user input
    if (resultStatus.status === 'needs_mcp_auth' ||
        resultStatus.status === 'needs_api_auth') {
      return true; // Proceeding with auth flow
    }

    return false;
  }, [agentState, activationComplete]);

  // Keep ref updated so the callback can access the latest version
  reloadAgentRef.current = reloadAgent;

  // Reset current agent (invalidate cache AND clear auth credentials, then exit to main)
  const resetAgent = useCallback(async (): Promise<boolean> => {
    if (!agentState.activeDefinition) {
      return false;
    }

    debug('[useAgent.resetAgent] Resetting agent:', agentState.agentName);

    // Delegate to agentState - handles cache invalidation and credential clearing
    await agentState.reset();
    debug('[useAgent.resetAgent] agentState.reset completed');

    // Clear the CraftAgent's active agent definition
    if (agentRef.current) {
      agentRef.current.setActiveAgentDefinition(null, {}, {});
    }
    // Clear callbacks for agent tools
    setUpdateAgentInstructionsContextProvider(null);
    setUpdateAgentInstructionsResultCallback(null);
    activeAgentContextRef.current = null;
    setReloadAgentInstructionsCallback(null);

    debug('[useAgent.resetAgent] Agent deactivated, user can re-select to restart setup');
    return true;
  }, [agentState]);

  // Complete MCP auth flow - called when auth finishes (success or failure)
  const completeMcpAuth = useCallback(async (success: boolean) => {
    if (!agentState.isNeedsMcpAuth) {
      return;
    }

    debug('[completeMcpAuth] Continuing after MCP auth, success:', success);

    // Delegate to agentState - checks for API auth, transitions to ready or needs_api_auth
    const resultStatus = await agentState.continueAfterMcpAuth();
    debug('[completeMcpAuth] agentState.continueAfterMcpAuth returned:', resultStatus.status);

    // Handle result status
    if (resultStatus.status === 'ready') {
      // All auth done - complete activation
      const definition = resultStatus.definition;
      const mcpServers = await agentState.buildMcpServerConfig();
      const apiServers = await agentState.buildApiServers();
      const agentId = agentState.agentId!;
      const agentName = agentState.agentName!;
      activationComplete(definition, mcpServers, apiServers, agentName, true, agentId);
      agentState.markActive();
    }

    if (!success) {
      // Warn user that some MCP servers may not work
      setMessages(prev => [...prev, {
        id: `auth-warning-${Date.now()}`,
        type: 'system',
        content: 'Some MCP servers may not work (authentication was not completed).',
        timestamp: Date.now(),
      }]);
    }
    // If status is needs_api_auth, the UI will automatically show API auth
  }, [agentState, activationComplete]);

  // Cancel MCP auth flow - returns to main agent
  const cancelMcpAuth = useCallback(() => {
    debug('[cancelMcpAuth] User cancelled MCP auth, deactivating agent');
    deactivateAgent();
    setMessages(prev => [...prev, {
      id: `auth-cancelled-${Date.now()}`,
      type: 'system',
      content: 'Authentication cancelled. Returned to main agent.',
      timestamp: Date.now(),
    }]);
  }, [deactivateAgent]);

  // Trigger auth flow manually (for /auth command)
  // Note: This manually triggers MCP auth check on the active agent
  const triggerMcpAuth = useCallback(async () => {
    if (!agentManagerRef.current || !agentState.activeDefinition) {
      setMessages(prev => [...prev, {
        id: `auth-error-${Date.now()}`,
        type: 'system',
        content: 'No active agent or no MCP servers configured.',
        timestamp: Date.now(),
      }]);
      return;
    }

    const serversNeedingAuth = await agentManagerRef.current.getMcpServersNeedingAuth(agentState.activeDefinition);
    if (serversNeedingAuth.length === 0) {
      setMessages(prev => [...prev, {
        id: `auth-ok-${Date.now()}`,
        type: 'system',
        content: 'All MCP servers are already authenticated.',
        timestamp: Date.now(),
      }]);
      return;
    }

    // Re-trigger activation to go through auth flow
    // This will transition to needs_mcp_auth state
    const agentId = agentState.agentId;
    if (agentId) {
      await agentState.activate(agentId);
    }
  }, [agentState]);

  // Trigger API auth flow manually (for reauth command)
  const triggerApiAuth = useCallback(async () => {
    if (!agentManagerRef.current || !agentState.activeDefinition) {
      setMessages(prev => [...prev, {
        id: `api-auth-error-${Date.now()}`,
        type: 'system',
        content: 'No active agent or no APIs configured.',
        timestamp: Date.now(),
      }]);
      return;
    }

    const apisNeedingAuth = await agentManagerRef.current.getApisNeedingAuth(agentState.activeDefinition);
    if (apisNeedingAuth.length === 0) {
      setMessages(prev => [...prev, {
        id: `api-auth-ok-${Date.now()}`,
        type: 'system',
        content: 'All APIs are already authenticated.',
        timestamp: Date.now(),
      }]);
      return;
    }

    // Re-trigger activation to go through auth flow
    const agentId = agentState.agentId;
    if (agentId) {
      await agentState.activate(agentId);
    }
  }, [agentState]);

  // Complete API auth flow - called when API key entry finishes (success or failure)
  const completeApiAuth = useCallback(async (success: boolean) => {
    if (!agentState.isNeedsApiAuth) {
      return;
    }

    debug('[completeApiAuth] Continuing after API auth, success:', success);

    // Delegate to agentState - transitions to ready
    const resultStatus = await agentState.continueAfterApiAuth();
    debug('[completeApiAuth] agentState.continueAfterApiAuth returned:', resultStatus.status);

    // Handle result status
    if (resultStatus.status === 'ready') {
      // All auth done - complete activation
      const definition = resultStatus.definition;
      const mcpServers = await agentState.buildMcpServerConfig();
      const apiServers = await agentState.buildApiServers();
      const agentId = agentState.agentId!;
      const agentName = agentState.agentName!;
      activationComplete(definition, mcpServers, apiServers, agentName, true, agentId);
      agentState.markActive();
    }

    if (!success) {
      // Warn user that some APIs may not work
      setMessages(prev => [...prev, {
        id: `auth-warning-${Date.now()}`,
        type: 'system',
        content: 'Some APIs may not work (authentication skipped).',
        timestamp: Date.now(),
      }]);
    }
  }, [agentState, activationComplete]);

  // Cancel API auth flow - returns to main agent
  const cancelApiAuth = useCallback(() => {
    debug('[cancelApiAuth] User cancelled API auth, deactivating agent');
    deactivateAgent();
    setMessages(prev => [...prev, {
      id: `auth-cancelled-${Date.now()}`,
      type: 'system',
      content: 'Authentication cancelled. Returned to main agent.',
      timestamp: Date.now(),
    }]);
  }, [deactivateAgent]);

  const refreshAgents = useCallback(async (): Promise<string[] | { error: string }> => {
    try {
      // Build MCP URL
      let mcpUrl = workspace.mcpUrl;
      mcpUrl = mcpUrl.replace(/\/+$/, '');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl + '/mcp';
        }
      }

      // ALWAYS get fresh token (with automatic refresh if expired)
      const token = await getMcpToken();

      // Close existing client if any
      if (mcpClientRef.current) {
        await mcpClientRef.current.close().catch(() => {});
      }

      // Create NEW MCP client with fresh token
      const client = new CraftMcpClient({
        url: mcpUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      await client.connect();
      mcpClientRef.current = client;

      // Create NEW agent manager with MCP config for agentic extraction
      const manager = new SubAgentManager(workspace.id, client, {
        model: config.model || DEFAULT_MODEL,
        mcpUrl,
        mcpToken: token || undefined,
      });
      agentManagerRef.current = manager;
      setSubAgentManager(manager);

      // Discover agents
      const agents = await manager.refreshAgents();
      const names = agents.map(a => a.name);
      setAvailableAgents(names);
      debug('[refreshAgents] Found agents:', names);
      return names;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      debug('[refreshAgents] ERROR:', message);
      return { error: `Failed to refresh agents: ${message}` };
    }
  }, [workspace, getMcpToken]);

  // Fetch all available tools (SDK + Craft MCP + active agent's MCP servers + APIs)
  const fetchTools = useCallback(async (): Promise<{ name: string; tools: { name: string; description?: string }[] }[]> => {
    const result: { name: string; tools: { name: string; description?: string }[] }[] = [];

    // 1. Claude SDK tools (captured from init message after first conversation)
    // Filter out MCP tools (prefixed with mcp__) as they're shown separately
    const agent = agentRef.current;
    if (agent) {
      const sdkTools = agent.getSdkTools().filter(name => !name.startsWith('mcp__'));
      if (sdkTools.length > 0) {
        result.push({
          name: 'Claude',
          tools: sdkTools.map(name => ({ name })),
        });
      }
    }

    // 2. Craft MCP tools
    if (mcpClientRef.current) {
      try {
        const craftTools = await mcpClientRef.current.listTools();
        result.push({
          name: 'Craft',
          tools: craftTools.map(t => ({ name: t.name, description: t.description })),
        });
      } catch (err) {
        debug('[fetchTools] Failed to fetch Craft tools:', err);
      }
    }

    // 3. Active agent's MCP server tools
    if (activeAgentDefinition && agentManagerRef.current) {
      const agentServers = await agentManagerRef.current.fetchMcpServerTools(activeAgentDefinition);
      for (const server of agentServers) {
        if (server.tools && server.tools.length > 0) {
          result.push({
            name: server.name,
            tools: server.tools.map(name => ({ name })),
          });
        }
      }

      // 4. Active agent's API tools (prefixed with api_ to avoid collisions)
      if (activeAgentDefinition.apis) {
        for (const api of activeAgentDefinition.apis) {
          // Each API has one flexible tool prefixed with api_
          result.push({
            name: api.name,
            tools: [{
              name: `api_${api.name}`,
              description: `Flexible API tool for ${api.name} (${api.baseUrl})`,
            }],
          });
        }
      }
    }

    return result;
  }, [agentState.activeDefinition]);

  // Derive active agent properties from useAgentState (backward compatible)
  const activeAgentDefinition = agentState.activeDefinition;
  const activeAgentName = agentState.agentName;
  const activeAgentMcpServers = agentState.activeDefinition?.mcpServers ?? [];

  // Derive pending auth states from useAgentState for backward compatibility
  // These match the legacy PendingMcpAuthRequest, PendingApiAuthRequest interfaces
  // Use status discriminator for proper type narrowing instead of type assertions
  const agentStatus = agentState.status;

  const pendingMcpAuth: PendingMcpAuthRequest | null =
    agentStatus.status === 'needs_mcp_auth'
      ? {
          servers: agentStatus.servers,
          agentId: agentStatus.agentId,
          agentName: agentStatus.agentName,
          definition: agentStatus.definition,
        }
      : null;

  const pendingApiAuth: PendingApiAuthRequest | null =
    agentStatus.status === 'needs_api_auth'
      ? {
          apis: agentStatus.apis,
          agentId: agentStatus.agentId,
          agentName: agentStatus.agentName,
          definition: agentStatus.definition,
        }
      : null;

  // ============================================
  // Plan Functions (SubmitPlan workflow)
  // ============================================

  /**
   * Cancel the current plan
   */
  const cancelPlan = useCallback(() => {
    setActivePlan(null);

    // Exit safe mode via mode manager
    if (session?.id) {
      exitMode(session.id, 'safe');
    }

    // Clear from storage
    clearWorkspacePlan(workspace.id);

    debug('[cancelPlan] Plan cancelled');
  }, [workspace.id, session?.id]);

  /**
   * Approve the current plan and exit safe mode
   * This allows Claude to execute the planned actions
   */
  const approvePlan = useCallback(() => {
    if (session?.id) {
      exitMode(session.id, 'safe');
    }

    debug('[approvePlan] Plan approved, exiting safe mode');
  }, [session?.id]);

  /**
   * Check if a message should trigger planning suggestion
   */
  const shouldSuggestPlanning = useCallback((message: string): boolean => {
    const agent = agentRef.current;
    if (!agent) return false;
    return agent.shouldSuggestPlanning(message);
  }, []);

  return {
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
    error,
    typedError,
    dismissTypedError,
    tokenUsage,
    pendingPermission,
    pendingQuestion,
    hasExecutingTool,
    sendMessage,
    clearMessages,
    interrupt,
    respondToPermission,
    respondToQuestion,
    // NOTE: model, setModel, workspace, setWorkspace moved to GlobalContext
    // Sub-agent related (derived from useAgentState for backward compatibility)
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    agentsLoading,
    // MCP auth for sub-agent servers (derived from useAgentState)
    pendingMcpAuth,
    completeMcpAuth,
    cancelMcpAuth,
    triggerMcpAuth,
    // API auth for REST API integrations (derived from useAgentState)
    pendingApiAuth,
    completeApiAuth,
    cancelApiAuth,
    triggerApiAuth,
    // Safe mode (read-only exploration)
    activePlan,
    safeMode,
    cancelPlan,
    approvePlan,
    shouldSuggestPlanning,
    // Generic mode toggle API
    setMode,
    // Legacy mode toggle aliases (deprecated - use setMode instead)
    startSafeMode,
    exitSafeModeAction,
    // Todos (from TodoWrite tool)
    todos,
    // Ultrathink mode (extended thinking)
    isUltrathink,
  };
}
