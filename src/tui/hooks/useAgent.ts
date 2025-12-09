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
} from '../../agent/craft-agent.ts';
import type { UpdateInstructionsContext, UpdateInstructionsProgressEvent } from '../../agents/instruction-updater.ts';
import type { Message } from '../components/Messages.tsx';
import type { FileAttachment } from '../utils/files.ts';
import { setTerminalProgressIndeterminate, clearTerminalProgress } from '../utils/terminalProgress.ts';
import {
  updateWorkspaceSessionId,
  saveWorkspaceConversation,
  loadWorkspaceConversation,
  clearWorkspaceConversation,
  getWorkspaceAccessTokenAsync,
  isWorkspaceTokenExpiredAsync,
  updateWorkspaceOAuthTokensAsync,
  loadStoredConfig,
  saveConfig,
  type Workspace,
  type StoredMessage,
} from '../../config/storage.ts';
import { getCredentialManager } from '../../credentials/index.ts';
import { CraftMcpClient } from '../../mcp/client.ts';
import { SubAgentManager } from '../../agents/manager.ts';
import type { SubAgentDefinition, McpServerConfig, ApiConfig, Concern } from '../../agents/types.ts';
import type { ExtractionProgressEvent } from '../../agents/extractor.ts';
import { invalidateDefinition, loadRegistry, clearAgentCredentialsAsync } from '../../agents/cache.ts';
import { CraftOAuth, getMcpBaseUrl } from '../../auth/oauth.ts';
import { debug } from '../utils/debug.ts';

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

// Pending clarifications (for saving to Craft document)
export interface PendingClarifications {
  agentName: string;
  agentId: string;
  definition: SubAgentDefinition;
  answers: Record<string, string>;
  refinementRound: number;
}

// Pending review request (concerns from extraction that need user input)
export interface PendingReviewRequest {
  agentId: string;
  agentName: string;
  definition: SubAgentDefinition;
  concerns: Concern[];
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
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  command: string;
  description: string;
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
  tokenUsage: TokenUsage;
  pendingPermission: PermissionRequest | null;
  pendingQuestion: AskUserQuestionRequest | null;
  hasExecutingTool: boolean;
  sendMessage: (input: string, attachments?: FileAttachment[]) => Promise<void>;
  clearMessages: () => void;
  interrupt: () => void;
  respondToPermission: (allowed: boolean, alwaysAllow?: boolean) => void;
  respondToQuestion: (answers: Record<string, string>) => void;
  model: string;
  setModel: (model: string) => void;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  isWebSearchEnabled: () => boolean;
  setWebSearchEnabled: (enabled: boolean) => void;
  isWebFetchEnabled: () => boolean;
  setWebFetchEnabled: (enabled: boolean) => void;
  isCodeExecutionEnabled: () => boolean;
  setCodeExecutionEnabled: (enabled: boolean) => void;
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
  fetchAgentTools: () => Promise<McpServerConfig[]>;
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
  // Review mode (concerns from extraction that need user input)
  pendingReview: PendingReviewRequest | null;
  completeReview: (answers: Record<string, string>) => Promise<void>;
  skipReview: () => Promise<void>;
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
  });
  const [model, setModelState] = useState(config.model || 'claude-sonnet-4-5-20250929');
  const [workspace, setWorkspaceState] = useState<Workspace>(config.workspace);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [hasExecutingTool, setHasExecutingTool] = useState(false);

  // Track tool settings in state so they persist even before agent is created
  const [webSearchEnabled, setWebSearchEnabledState] = useState(config.enableWebSearch ?? true);
  const [webFetchEnabled, setWebFetchEnabledState] = useState(config.enableWebFetch ?? true);
  const [codeExecutionEnabled, setCodeExecutionEnabledState] = useState(config.enableCodeExecution ?? true);

  // Sub-agent state
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [activeAgentDefinition, setActiveAgentDefinition] = useState<SubAgentDefinition | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [pendingMcpAuth, setPendingMcpAuth] = useState<PendingMcpAuthRequest | null>(null);
  const [pendingApiAuth, setPendingApiAuth] = useState<PendingApiAuthRequest | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReviewRequest | null>(null);

  const agentRef = useRef<CraftAgent | null>(null);
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

  // Load saved conversation on initial mount (only if edited within last 5 minutes)
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    const savedConversation = loadWorkspaceConversation(workspace.id);
    if (savedConversation && savedConversation.messages && savedConversation.messages.length > 0) {
      // Only restore if conversation was edited within the last 5 minutes
      const fiveMinutesMs = 5 * 60 * 1000;
      const isRecent = savedConversation.savedAt && (Date.now() - savedConversation.savedAt) < fiveMinutesMs;

      if (isRecent) {
        const restoredMessages = savedConversation.messages.map(storedMessageToMessage);
        setMessages(restoredMessages);
        setTokenUsage(savedConversation.tokenUsage);
      } else {
        // Conversation is stale - clear it to start fresh
        clearWorkspaceConversation(workspace.id);
      }
    }
  }, []);  // Empty deps - only run on mount

  // Auto-save conversation when messages change and we're not processing
  useEffect(() => {
    // Skip during initial load
    if (!initialLoadDoneRef.current) return;
    // Only save if we have messages and we're not currently processing
    if (messages.length > 0 && !isProcessing) {
      const storedMessages = messages.map(messageToStoredMessage);
      saveWorkspaceConversation(workspace.id, storedMessages, tokenUsage);

      // Also save session ID if available and update React state
      const sessionId = agentRef.current?.getSessionId();
      if (sessionId && sessionId !== workspace.sessionId) {
        updateWorkspaceSessionId(workspace.id, sessionId);
        setWorkspaceState(prev => ({ ...prev, sessionId }));
      }
    }
  }, [messages, isProcessing, workspace.id, tokenUsage]);

  // Helper to get MCP token for current workspace
  const getMcpToken = useCallback(async (): Promise<string | null> => {
    if (workspace.isPublic) {
      return null;
    }

    // Get token from keychain (handles bearer token, OAuth, and legacy config fallback)
    const token = await getWorkspaceAccessTokenAsync(workspace.id);
    if (!token) {
      return null;
    }

    // Check if token is expired and refresh if needed
    const isExpired = await isWorkspaceTokenExpiredAsync(workspace.id);
    if (isExpired) {
      // Get full OAuth credentials from keychain for refresh
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

          // Save refreshed tokens to keychain
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
        // Build MCP URL
        let mcpUrl = workspace.mcpUrl;
        mcpUrl = mcpUrl.replace(/\/+$/, '');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
          if (!mcpUrl.endsWith('/mcp')) {
            mcpUrl = mcpUrl + '/mcp';
          }
        }

        // Get token from keychain
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
          model,
          mcpUrl,
          mcpToken: token || undefined,
        });
        agentManagerRef.current = manager;

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
      // Clear agent instructions callbacks
      setUpdateAgentInstructionsContextProvider(null);
      setUpdateAgentInstructionsResultCallback(null);
      setUpdateAgentInstructionsProgressCallback(null);
      setGlobalPermissionHandler(null);
      activeAgentContextRef.current = null;
      updateInstructionsToolMsgIdRef.current = null;
      setActiveAgentDefinition(null);
      // Don't clear availableAgents here - it causes race condition with token refresh
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.mcpUrl, workspace.isPublic, getMcpToken]);

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
      // Sync current state to the newly created agent
      agentRef.current.setModel(model);
      agentRef.current.setWebSearchEnabled(webSearchEnabled);
      agentRef.current.setWebFetchEnabled(webFetchEnabled);
      agentRef.current.setCodeExecutionEnabled(codeExecutionEnabled);
      // Restore session ID from workspace if available (for conversation continuity)
      if (workspace.sessionId) {
        agentRef.current.setSessionId(workspace.sessionId);
      }
    }

    // Always set up global callbacks (may have been cleared by workspace change)
    // These are module-level callbacks, not per-agent, so must be re-set each time
    setGlobalPermissionHandler((request) => {
      setPendingPermission(request);
    });
    setUpdateAgentInstructionsProgressCallback((event: UpdateInstructionsProgressEvent) => {
      const toolMsgId = updateInstructionsToolMsgIdRef.current;
      if (toolMsgId && event.type === 'tool_start') {
        debug('[useAgent] Update instructions progress:', event.message, 'toolMsgId:', toolMsgId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId
              ? { ...m, content: event.message }
              : m
          )
        );
      }
    });

    return agentRef.current;
  }, [config, model, webSearchEnabled, webFetchEnabled, codeExecutionEnabled, workspace]);

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

  const sendMessage = useCallback(async (
    input: string,
    attachments?: FileAttachment[],
    options?: { hideUserMessage?: boolean }
  ) => {
    if (isProcessing) return;

    const agent = getAgent();

    // Add user message (include attachment names in display) - unless hidden
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

    setIsProcessing(true);
    setProcessingStartTime(Date.now());
    setTerminalProgressIndeterminate();
    setStreamingText('');
    setStatus('');
    setError(null);
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
      for await (const event of agent.chat(input, attachments)) {
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
            if (event.toolName === 'update_agent_instructions') {
              updateInstructionsToolMsgIdRef.current = toolMessageId;
            }

            setMessages((prev) => {
              // Check if a tool message with this ID already exists
              const existingIndex = prev.findIndex((m) => m.id === toolMessageId);
              if (existingIndex >= 0) {
                // Update existing message with better input data if available
                const existing = prev[existingIndex]!;
                const hasNewInput = event.input && Object.keys(event.input).length > 0;
                const existingHasInput = existing.toolInput && Object.keys(existing.toolInput).length > 0;
                if (hasNewInput && !existingHasInput) {
                  const updated = [...prev];
                  updated[existingIndex] = { ...existing, toolInput: event.input };
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
  }, [getAgent, isProcessing]);

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
    });
    if (agentRef.current) {
      agentRef.current.clearHistory();
    }
    // Also clear the persisted conversation for this workspace
    clearWorkspaceConversation(workspace.id);
    // Update local workspace state to remove session ID
    setWorkspaceState(prev => ({
      ...prev,
      sessionId: undefined,
    }));
  }, [workspace.id]);

  const interrupt = useCallback(() => {
    // Set interrupted flag first to break out of the event loop
    interruptedRef.current = true;

    if (agentRef.current) {
      agentRef.current.interrupt();
    }
    setIsProcessing(false);
    setStreamingText('');
    setStatus('');

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

  const setModel = useCallback((newModel: string) => {
    setModelState(newModel);
    if (agentRef.current) {
      agentRef.current.setModel(newModel);
    }
    // Persist model selection to config
    const config = loadStoredConfig();
    if (config) {
      config.model = newModel;
      saveConfig(config);
    }
  }, []);

  const setWorkspace = useCallback((newWorkspace: Workspace) => {
    // Save current workspace's conversation before switching
    const currentMessages = messages;
    const currentSessionId = agentRef.current?.getSessionId() ?? null;

    if (currentMessages.length > 0) {
      // Save messages and token usage to storage
      const storedMessages = currentMessages.map(messageToStoredMessage);
      saveWorkspaceConversation(workspace.id, storedMessages, tokenUsage);

      // Save session ID for conversation continuity
      if (currentSessionId) {
        updateWorkspaceSessionId(workspace.id, currentSessionId);
      }
    }

    // Load target workspace's conversation
    const savedConversation = loadWorkspaceConversation(newWorkspace.id);

    if (savedConversation && savedConversation.messages && savedConversation.messages.length > 0) {
      // Restore saved messages and token usage
      const restoredMessages = savedConversation.messages.map(storedMessageToMessage);
      setMessages(restoredMessages);
      setTokenUsage(savedConversation.tokenUsage);
      setError(null);

      // Update agent with restored session ID
      if (agentRef.current) {
        agentRef.current.setWorkspace(newWorkspace, true);  // true = restore session
      }
    } else {
      // No saved conversation - start fresh
      setMessages([]);
      setError(null);
      setTokenUsage({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      });

      if (agentRef.current) {
        agentRef.current.setWorkspace(newWorkspace, false);  // false = fresh start
      }
    }

    // Clear review state from previous workspace
    setPendingReview(null);

    // Update workspace state (triggers useEffect to reinitialize MCP proxy)
    setWorkspaceState(newWorkspace);
  }, [messages, workspace, tokenUsage]);

  const isWebSearchEnabled = useCallback(() => {
    return webSearchEnabled;
  }, [webSearchEnabled]);

  const setWebSearchEnabled = useCallback((enabled: boolean) => {
    setWebSearchEnabledState(enabled);
    if (agentRef.current) {
      agentRef.current.setWebSearchEnabled(enabled);
    }
  }, []);

  const isWebFetchEnabled = useCallback(() => {
    return webFetchEnabled;
  }, [webFetchEnabled]);

  const setWebFetchEnabled = useCallback((enabled: boolean) => {
    setWebFetchEnabledState(enabled);
    if (agentRef.current) {
      agentRef.current.setWebFetchEnabled(enabled);
    }
  }, []);

  const isCodeExecutionEnabled = useCallback(() => {
    return codeExecutionEnabled;
  }, [codeExecutionEnabled]);

  const setCodeExecutionEnabled = useCallback((enabled: boolean) => {
    setCodeExecutionEnabledState(enabled);
    if (agentRef.current) {
      agentRef.current.setCodeExecutionEnabled(enabled);
    }
  }, []);

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
      model: model,
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

  // Sub-agent functions
  const activateAgent = useCallback(async (name: string): Promise<boolean | 'pending_auth'> => {
    debug('[useAgent.activateAgent] Activating:', name, 'manager exists:', !!agentManagerRef.current);
    if (!agentManagerRef.current) {
      debug('[useAgent.activateAgent] No agent manager available');
      return false;
    }

    // Check if fresh extraction is needed (cache miss)
    const needsExtraction = await agentManagerRef.current.needsFreshExtractionByName(name);
    debug('[useAgent.activateAgent] needsExtraction:', needsExtraction);

    // Show extraction progress message if needed
    let extractionMsgId: string | null = null;
    const extractionStartTime = Date.now();
    if (needsExtraction) {
      extractionMsgId = `extraction-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: extractionMsgId!,
        type: 'tool',
        content: '',
        timestamp: Date.now(),
        toolName: 'Loading Agent',
        toolInput: { agent: name },
        toolStatus: 'executing',
      }]);
    }

    const definition = await agentManagerRef.current.activateAgent(name, (event: ExtractionProgressEvent) => {
      debug('[useAgent.activateAgent] Progress event:', event.type, event.message);
      // Update extraction message with progress
      if (extractionMsgId && event.type === 'tool_start') {
        debug('[useAgent.activateAgent] Updating extraction message with:', event.message);
        setMessages(prev => prev.map(m =>
          m.id === extractionMsgId
            ? { ...m, content: event.message }
            : m
        ));
      }
    });

    // Update extraction message on completion
    if (extractionMsgId) {
      const duration = Date.now() - extractionStartTime;
      if (definition) {
        setMessages(prev => prev.map(m =>
          m.id === extractionMsgId
            ? {
                ...m,
                toolStatus: 'completed' as const,
                toolResult: `Loaded ${definition.instructions?.length || 0} chars of instructions`,
                toolDuration: duration,
              }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === extractionMsgId
            ? {
                ...m,
                toolStatus: 'error' as const,
                toolResult: 'Failed to load agent',
                toolDuration: duration,
                isError: true,
              }
            : m
        ));
      }
    }

    if (definition) {
      // Get the agent ID from the registry
      const agents = await agentManagerRef.current.getAvailableAgents();
      const agentMeta = agents.find(a => a.name.toLowerCase() === name.toLowerCase());
      const agentId = agentMeta?.id || name;

      setActiveAgentDefinition(definition);

      // Check if definition has concerns that need user input (only on fresh extraction)
      if (needsExtraction && definition.concerns && definition.concerns.length > 0) {
        debug('[useAgent.activateAgent] Concerns found:', definition.concerns.length);
        setPendingReview({
          agentId,
          agentName: name,
          definition,
          concerns: definition.concerns,
        });
        return 'pending_auth';  // Reuse 'pending_auth' to indicate async flow
      }

      // Check if any MCP servers need authentication OR validation
      const serversNeedingAuth = await agentManagerRef.current.getMcpServersNeedingAuth(definition);
      const noAuthServers = agentManagerRef.current.getNoAuthMcpServers(definition);
      const allServersToValidate = [...serversNeedingAuth, ...noAuthServers];

      if (allServersToValidate.length > 0) {
        debug('[useAgent.activateAgent] Servers needing auth/validation:', allServersToValidate.map(s => s.name));
        // Trigger auth/validation flow - don't complete activation until done
        setPendingMcpAuth({
          servers: allServersToValidate,
          agentId,
          agentName: name,
          definition,
        });
        return 'pending_auth';
      }

      // Check if any APIs need authentication
      const apisNeedingAuth = await agentManagerRef.current.getApisNeedingAuth(definition);
      if (apisNeedingAuth.length > 0) {
        debug('[useAgent.activateAgent] APIs needing auth:', apisNeedingAuth.map(a => a.name));
        // Trigger API auth flow
        setPendingApiAuth({
          apis: apisNeedingAuth,
          agentId,
          agentName: name,
          definition,
        });
        return 'pending_auth';
      }

      // No auth needed - complete activation immediately
      const mcpServers = await agentManagerRef.current.buildMcpServerConfig(definition);
      const apiServers = await agentManagerRef.current.buildApiServers(definition);
      debug('[useAgent.activateAgent] No auth needed, completing activation');
      activationComplete(definition, mcpServers, apiServers, name, needsExtraction, agentId);
      return true;
    }
    return false;
  }, [getAgent, activationComplete]);

  const deactivateAgent = useCallback(() => {
    if (agentManagerRef.current) {
      agentManagerRef.current.deactivateAgent();
      agentManagerRef.current.clearApiServerCache();
    }
    setActiveAgentDefinition(null);
    // Clear the CraftAgent's active agent definition, MCP servers, and API servers
    if (agentRef.current) {
      agentRef.current.setActiveAgentDefinition(null, {}, {});
    }
    // Clear callbacks for agent tools
    setUpdateAgentInstructionsContextProvider(null);
    setUpdateAgentInstructionsResultCallback(null);
    activeAgentContextRef.current = null;
    setReloadAgentInstructionsCallback(null);
    // Clear review state to prevent stale UI
    setPendingReview(null);
  }, []);

  // Reload current agent instructions (preserves auth credentials)
  const reloadAgent = useCallback(async (): Promise<boolean> => {
    if (!activeAgentDefinition || !agentManagerRef.current) {
      return false;
    }

    const agentName = activeAgentDefinition.name;

    // Get agent metadata to find the ID
    const agents = await agentManagerRef.current.getAvailableAgents();
    const agentMeta = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agentMeta) {
      return false;
    }

    // Invalidate file cache (not auth)
    invalidateDefinition(workspace.id, agentMeta.id);
    debug('[useAgent.reloadAgent] Definition cache invalidated for agent:', agentMeta.id);

    // Deactivate first
    deactivateAgent();

    // Re-activate (will trigger fresh extraction)
    const result = await activateAgent(agentName);
    debug('[useAgent.reloadAgent] Re-activation result:', result);

    // 'pending_auth' means reload is proceeding but waiting for user input (review/auth)
    return result === true || result === 'pending_auth';
  }, [activeAgentDefinition, workspace.id, deactivateAgent, activateAgent]);

  // Keep ref updated so the callback can access the latest version
  reloadAgentRef.current = reloadAgent;

  // Reset current agent (invalidate cache AND clear auth credentials, then exit to main)
  const resetAgent = useCallback(async (): Promise<boolean> => {
    if (!activeAgentDefinition || !agentManagerRef.current) {
      return false;
    }

    const agentName = activeAgentDefinition.name;

    // Get agent metadata to find the ID
    const agents = await agentManagerRef.current.getAvailableAgents();
    const agentMeta = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agentMeta) {
      return false;
    }

    // Clear definition cache
    invalidateDefinition(workspace.id, agentMeta.id);
    debug('[useAgent.resetAgent] Definition cache cleared for agent:', agentMeta.id);

    // Clear all credentials for this agent from keychain
    await clearAgentCredentialsAsync(workspace.id, agentMeta.id);
    debug('[useAgent.resetAgent] Credentials cleared from keychain');

    // Deactivate and return to main (don't re-activate - user can re-select to restart setup)
    deactivateAgent();
    debug('[useAgent.resetAgent] Agent deactivated, user can re-select to restart setup');

    return true;
  }, [activeAgentDefinition, workspace.id, deactivateAgent]);

  // Complete MCP auth flow - called when auth finishes (success or failure)
  const completeMcpAuth = useCallback(async (success: boolean) => {
    if (!pendingMcpAuth || !agentManagerRef.current) {
      setPendingMcpAuth(null);
      return;
    }

    // Check if APIs need auth after MCP auth completes
    const apisNeedingAuth = await agentManagerRef.current.getApisNeedingAuth(pendingMcpAuth.definition);
    if (apisNeedingAuth.length > 0) {
      debug('[completeMcpAuth] APIs needing auth:', apisNeedingAuth.map(a => a.name));
      // Clear MCP auth and trigger API auth
      setPendingMcpAuth(null);
      setPendingApiAuth({
        apis: apisNeedingAuth,
        agentId: pendingMcpAuth.agentId,
        agentName: pendingMcpAuth.agentName,
        definition: pendingMcpAuth.definition,
      });
      return;
    }

    // MCP auth done (no API auth needed) - complete activation
    // Auth flow only happens on first-time setup, so always show info
    const mcpServers = await agentManagerRef.current.buildMcpServerConfig(pendingMcpAuth.definition);
    const apiServers = await agentManagerRef.current.buildApiServers(pendingMcpAuth.definition);
    debug('[completeMcpAuth] Completing activation, success:', success);
    activationComplete(pendingMcpAuth.definition, mcpServers, apiServers, pendingMcpAuth.agentName, true, pendingMcpAuth.agentId);

    if (!success) {
      // Warn user that some MCP servers may not work
      setMessages(prev => [...prev, {
        id: `auth-warning-${Date.now()}`,
        type: 'system',
        content: 'Some MCP servers may not work (authentication was not completed).',
        timestamp: Date.now(),
      }]);
    }

    setPendingMcpAuth(null);
  }, [pendingMcpAuth, getAgent, activationComplete]);

  // Cancel MCP auth flow - returns to main agent
  const cancelMcpAuth = useCallback(() => {
    debug('[cancelMcpAuth] User cancelled MCP auth, deactivating agent');
    setPendingMcpAuth(null);
    deactivateAgent();
    setMessages(prev => [...prev, {
      id: `auth-cancelled-${Date.now()}`,
      type: 'system',
      content: 'Authentication cancelled. Returned to main agent.',
      timestamp: Date.now(),
    }]);
  }, [deactivateAgent]);

  // Trigger auth flow manually (for /auth command)
  const triggerMcpAuth = useCallback(async () => {
    if (!agentManagerRef.current || !activeAgentDefinition) {
      setMessages(prev => [...prev, {
        id: `auth-error-${Date.now()}`,
        type: 'system',
        content: 'No active agent or no MCP servers configured.',
        timestamp: Date.now(),
      }]);
      return;
    }

    const serversNeedingAuth = await agentManagerRef.current.getMcpServersNeedingAuth(activeAgentDefinition);
    if (serversNeedingAuth.length === 0) {
      setMessages(prev => [...prev, {
        id: `auth-ok-${Date.now()}`,
        type: 'system',
        content: 'All MCP servers are already authenticated.',
        timestamp: Date.now(),
      }]);
      return;
    }

    // Get agent ID
    const agentId = agentManagerRef.current.getActiveAgent()?.agentId || 'unknown';

    setPendingMcpAuth({
      servers: serversNeedingAuth,
      agentId,
      agentName: activeAgentDefinition.name,
      definition: activeAgentDefinition,
    });
  }, [activeAgentDefinition]);

  // Complete API auth flow - called when API key entry finishes (success or failure)
  const completeApiAuth = useCallback(async (success: boolean) => {
    if (!pendingApiAuth || !agentManagerRef.current) {
      setPendingApiAuth(null);
      return;
    }

    // All auth done - complete activation
    // Auth flow only happens on first-time setup, so always show info
    const mcpServers = await agentManagerRef.current.buildMcpServerConfig(pendingApiAuth.definition);
    const apiServers = await agentManagerRef.current.buildApiServers(pendingApiAuth.definition);
    debug('[completeApiAuth] Completing activation, success:', success);
    activationComplete(pendingApiAuth.definition, mcpServers, apiServers, pendingApiAuth.agentName, true, pendingApiAuth.agentId);

    if (!success) {
      // Warn user that some APIs may not work
      setMessages(prev => [...prev, {
        id: `auth-warning-${Date.now()}`,
        type: 'system',
        content: 'Some APIs may not work (authentication skipped).',
        timestamp: Date.now(),
      }]);
    }

    setPendingApiAuth(null);
  }, [pendingApiAuth, getAgent, activationComplete]);

  // Cancel API auth flow - returns to main agent
  const cancelApiAuth = useCallback(() => {
    debug('[cancelApiAuth] User cancelled API auth, deactivating agent');
    setPendingApiAuth(null);
    deactivateAgent();
    setMessages(prev => [...prev, {
      id: `auth-cancelled-${Date.now()}`,
      type: 'system',
      content: 'Authentication cancelled. Returned to main agent.',
      timestamp: Date.now(),
    }]);
  }, [deactivateAgent]);

  // Save clarifications to Craft document - sends HIDDEN message to agent
  // Accepts clarifications directly to avoid React state timing issues
  const saveClarificationsWithData = useCallback(async (clarifications: PendingClarifications) => {
    debug('[saveClarifications] Sending hidden save request to agent');

    // Clear temporary clarifications - they'll be saved permanently
    const agent = getAgent();
    agent.setTemporaryClarifications(null);

    // Build clarifications text
    const clarificationsText = Object.entries(clarifications.answers)
      .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
      .join('\n\n');

    // Get document ID from the registry
    const registry = loadRegistry(workspace.id);
    const agentMeta = registry?.agents.find(a => a.id === clarifications.agentId);
    const documentId = agentMeta?.documentId;
    const blockId = clarifications.definition.instructionsBlockId;

    // Build save prompt (NOT shown in UI due to hideUserMessage option)
    const savePrompt = `Update your Instructions document in Craft with these clarifications. This is important:

1. First, use blocks_get to read the current instructions content
2. Find any open questions or concerns in the instructions that these clarifications answer
3. REPLACE those questions/concerns with the actual answers - don't just append
4. Use blocks_update to save the complete updated instructions

Document ID: ${documentId || 'unknown'}
Instructions Block ID: ${blockId || 'unknown'}

Clarifications (answers to questions in your instructions):
${clarificationsText}

The goal is to have clean, actionable instructions without unanswered questions. Remove the questions and integrate the answers naturally into the relevant sections.`;

    try {
      // Use sendMessage with hideUserMessage - reuses all event handling logic
      await sendMessageRef.current?.(savePrompt, undefined, { hideUserMessage: true });

      // After save completes, reload the agent to use updated instructions
      if (reloadAgentRef.current) {
        await reloadAgentRef.current();
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `save-error-${Date.now()}`,
        type: 'error',
        content: `Failed to save clarifications: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      }]);
    }
  }, [getAgent, workspace.id]);

  // Complete review - user answered the concerns, save and finish activation
  const completeReview = useCallback(async (answers: Record<string, string>) => {
    if (!pendingReview) return;

    debug('[completeReview] User answered concerns, saving to document');

    // Build clarifications object
    const clarifications: PendingClarifications = {
      agentName: pendingReview.agentName,
      agentId: pendingReview.agentId,
      definition: pendingReview.definition,
      answers,
      refinementRound: 0,
    };

    // Clear the review request
    setPendingReview(null);

    // Go DIRECTLY to save - pass clarifications explicitly
    // (Can't use state because React hasn't re-rendered yet)
    await saveClarificationsWithData(clarifications);
  }, [pendingReview, saveClarificationsWithData]);

  // Skip review - user wants to skip clarifications and continue with activation
  const skipReview = useCallback(async () => {
    if (!pendingReview) return;

    debug('[skipReview] User skipped clarifications');

    const { definition, agentId, agentName } = pendingReview;
    setPendingReview(null);

    // Continue with activation flow - check for MCP auth, API auth, then complete
    if (agentManagerRef.current) {
      // Check if MCP servers need authentication
      const serversNeedingAuth = await agentManagerRef.current.getMcpServersNeedingAuth(definition);
      if (serversNeedingAuth.length > 0) {
        setPendingMcpAuth({
          servers: serversNeedingAuth,
          agentId,
          agentName,
          definition,
        });
        return;
      }

      // Check if APIs need authentication
      const apisNeedingAuth = await agentManagerRef.current.getApisNeedingAuth(definition);
      if (apisNeedingAuth.length > 0) {
        setPendingApiAuth({
          apis: apisNeedingAuth,
          agentId,
          agentName,
          definition,
        });
        return;
      }

      // No auth needed - complete activation immediately
      const mcpServers = await agentManagerRef.current.buildMcpServerConfig(definition);
      const apiServers = await agentManagerRef.current.buildApiServers(definition);
      activationComplete(definition, mcpServers, apiServers, agentName, true, agentId);
    }
  }, [pendingReview, activationComplete]);

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
        model,
        mcpUrl,
        mcpToken: token || undefined,
      });
      agentManagerRef.current = manager;

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

  // Fetch tools from active agent's MCP servers
  const fetchAgentTools = useCallback(async (): Promise<McpServerConfig[]> => {
    if (!activeAgentDefinition || !agentManagerRef.current) {
      return [];
    }
    return agentManagerRef.current.fetchMcpServerTools(activeAgentDefinition);
  }, [activeAgentDefinition]);

  // Derive active agent name from definition
  const activeAgentName = activeAgentDefinition?.name ?? null;
  // Derive active agent MCP servers from definition
  const activeAgentMcpServers = activeAgentDefinition?.mcpServers ?? [];

  return {
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
    error,
    tokenUsage,
    pendingPermission,
    pendingQuestion,
    hasExecutingTool,
    sendMessage,
    clearMessages,
    interrupt,
    respondToPermission,
    respondToQuestion,
    model,
    setModel,
    workspace,
    setWorkspace,
    isWebSearchEnabled,
    setWebSearchEnabled,
    isWebFetchEnabled,
    setWebFetchEnabled,
    isCodeExecutionEnabled,
    setCodeExecutionEnabled,
    // Sub-agent related
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchAgentTools,
    agentsLoading,
    // MCP auth for sub-agent servers
    pendingMcpAuth,
    completeMcpAuth,
    cancelMcpAuth,
    triggerMcpAuth,
    // API auth for REST API integrations
    pendingApiAuth,
    completeApiAuth,
    cancelApiAuth,
    // Review mode (concerns from extraction that need user input)
    pendingReview,
    completeReview,
    skipReview,
  };
}
