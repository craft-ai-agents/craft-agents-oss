import { useState, useCallback, useRef, useEffect } from 'react';
import { CraftAgent, type CraftAgentConfig, type AgentEvent, type Question, setUpdateAgentInstructionsCallback, setReloadAgentInstructionsCallback } from '../../agent/craft-agent.ts';
import type { Message } from '../components/Messages.tsx';
import type { FileAttachment } from '../utils/files.ts';
import { setTerminalProgressIndeterminate, clearTerminalProgress } from '../utils/terminalProgress.ts';
import {
  updateWorkspaceSessionId,
  saveWorkspaceConversation,
  loadWorkspaceConversation,
  clearWorkspaceConversation,
  isWorkspaceTokenExpired,
  updateWorkspaceOAuthTokens,
  loadStoredConfig,
  saveConfig,
  type Workspace,
  type StoredMessage,
} from '../../config/storage.ts';
import { CraftMcpClient } from '../../mcp/client.ts';
import { SubAgentManager } from '../../agents/manager.ts';
import type { SubAgentDefinition, McpServerConfig, ApiConfig } from '../../agents/types.ts';
import { invalidateDefinition, clearMcpCredentials, loadRegistry } from '../../agents/cache.ts';
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

  const agentRef = useRef<CraftAgent | null>(null);
  const agentManagerRef = useRef<SubAgentManager | null>(null);
  const mcpClientRef = useRef<CraftMcpClient | null>(null);
  const toolStartTimeRef = useRef<Map<string, number>>(new Map());
  const streamingBufferRef = useRef<string>('');
  const lastStreamingUpdateRef = useRef<number>(0);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptedRef = useRef<boolean>(false);
  const reloadAgentRef = useRef<(() => Promise<boolean>) | null>(null);

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

      // Also save session ID if available
      const sessionId = agentRef.current?.getSessionId();
      if (sessionId) {
        updateWorkspaceSessionId(workspace.id, sessionId);
      }
    }
  }, [messages, isProcessing, workspace.id, tokenUsage]);

  // Helper to get MCP token for current workspace
  const getMcpToken = useCallback(async (): Promise<string | null> => {
    if (workspace.isPublic) {
      return null;
    }

    if (!workspace.oauth) {
      return null;
    }

    // Check if token is expired and refresh if needed
    if (isWorkspaceTokenExpired(workspace) && workspace.oauth.refreshToken) {
      try {
        const oauth = new CraftOAuth(
          { mcpBaseUrl: getMcpBaseUrl(workspace.mcpUrl) },
          { onStatus: () => {}, onError: () => {} }
        );

        const newTokens = await oauth.refreshAccessToken(
          workspace.oauth.refreshToken,
          workspace.oauth.clientId
        );

        updateWorkspaceOAuthTokens(
          workspace.id,
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );

        return newTokens.accessToken;
      } catch {
        return workspace.oauth.accessToken;
      }
    }

    return workspace.oauth.accessToken;
  }, [workspace]);

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

        // Get token (inline to avoid dependency issues)
        let token: string | null = null;
        if (!workspace.isPublic && workspace.oauth) {
          token = workspace.oauth.accessToken;
        }

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
      // Clear agent instructions callback
      setUpdateAgentInstructionsCallback(null);
      setActiveAgentDefinition(null);
      // Don't clear availableAgents here - it causes race condition with token refresh
    };
    // Note: Don't include workspace.oauth?.accessToken - token refresh is handled in refreshAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.mcpUrl, workspace.isPublic]);

  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      agentRef.current = new CraftAgent(config);
      // Set up permission request callback
      agentRef.current.onPermissionRequest = (request) => {
        setPendingPermission(request);
      };
      // Set up AskUserQuestion callback
      agentRef.current.onAskUserQuestion = (request) => {
        setPendingQuestion(request);
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
    return agentRef.current;
  }, [config, model, webSearchEnabled, webFetchEnabled, codeExecutionEnabled, workspace]);

  const respondToPermission = useCallback((allowed: boolean, alwaysAllow: boolean = false) => {
    if (pendingPermission && agentRef.current) {
      agentRef.current.respondToPermission(pendingPermission.requestId, allowed, alwaysAllow);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  const respondToQuestion = useCallback((answers: Record<string, string>) => {
    if (pendingQuestion && agentRef.current) {
      agentRef.current.respondToQuestion(pendingQuestion.requestId, answers);
      setPendingQuestion(null);
    }
  }, [pendingQuestion]);

  const sendMessage = useCallback(async (input: string, attachments?: FileAttachment[]) => {
    if (isProcessing) return;

    const agent = getAgent();

    // Add user message (include attachment names in display)
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

    const definition = await agentManagerRef.current.activateAgent(name);

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

      // Show info messages from extraction
      if (definition.info && definition.info.length > 0) {
        setMessages(prev => [
          ...prev,
          ...definition.info!.map((msg, idx) => ({
            id: `info-${Date.now()}-${idx}`,
            type: 'system' as const,
            content: msg,
            timestamp: Date.now(),
          })),
        ]);
      }

      // Check if any MCP servers need authentication
      const serversNeedingAuth = agentManagerRef.current.getMcpServersNeedingAuth(definition);
      if (serversNeedingAuth.length > 0) {
        debug('[useAgent.activateAgent] Servers needing auth:', serversNeedingAuth.map(s => s.name));
        // Trigger auth flow - don't complete activation until auth is done
        setPendingMcpAuth({
          servers: serversNeedingAuth,
          agentId,
          agentName: name,
          definition,
        });
        return 'pending_auth';
      }

      // Check if any APIs need authentication
      const apisNeedingAuth = agentManagerRef.current.getApisNeedingAuth(definition);
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
      const apiServers = agentManagerRef.current.buildApiServers(definition);
      debug('[useAgent.activateAgent] Built MCP servers:', Object.keys(mcpServers));
      debug('[useAgent.activateAgent] Built API servers:', Object.keys(apiServers));
      debug('[useAgent.activateAgent] definition loaded:', definition.name);
      debug('[useAgent.activateAgent] instructions length:', definition.instructions?.length || 0);
      // Ensure CraftAgent exists before setting definition (getAgent creates it if needed)
      const agent = getAgent();
      debug('[useAgent.activateAgent] agent created/retrieved via getAgent()');
      agent.setActiveAgentDefinition(definition, mcpServers, apiServers);
      debug('[useAgent.activateAgent] setActiveAgentDefinition called on CraftAgent');
      // Set callback for update_agent_instructions tool
      setUpdateAgentInstructionsCallback(async (content: string) => {
        if (agentManagerRef.current) {
          return agentManagerRef.current.updateInstructions(content);
        }
        return false;
      });
      // Set callback for reload_agent_instructions tool (uses ref since reloadAgent is defined later)
      setReloadAgentInstructionsCallback(async () => {
        if (reloadAgentRef.current) {
          return reloadAgentRef.current();
        }
        return false;
      });
      return true;
    }
    return false;
  }, [getAgent]);

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
    setUpdateAgentInstructionsCallback(null);
    setReloadAgentInstructionsCallback(null);
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

    return result === true;
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

    // Clear file cache and auth credentials
    invalidateDefinition(workspace.id, agentMeta.id);
    clearMcpCredentials(workspace.id, agentMeta.id);
    debug('[useAgent.resetAgent] Caches cleared for agent:', agentMeta.id);

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
    const apisNeedingAuth = agentManagerRef.current.getApisNeedingAuth(pendingMcpAuth.definition);
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

    if (success) {
      // Auth succeeded - complete agent activation with new credentials
      const mcpServers = await agentManagerRef.current.buildMcpServerConfig(pendingMcpAuth.definition);
      const apiServers = agentManagerRef.current.buildApiServers(pendingMcpAuth.definition);
      debug('[completeMcpAuth] Auth succeeded, built MCP servers:', Object.keys(mcpServers));
      debug('[completeMcpAuth] Built API servers:', Object.keys(apiServers));

      const agent = getAgent();
      agent.setActiveAgentDefinition(pendingMcpAuth.definition, mcpServers, apiServers);

      // Set callbacks for agent tools
      setUpdateAgentInstructionsCallback(async (content: string) => {
        if (agentManagerRef.current) {
          return agentManagerRef.current.updateInstructions(content);
        }
        return false;
      });
      setReloadAgentInstructionsCallback(async () => {
        if (reloadAgentRef.current) {
          return reloadAgentRef.current();
        }
        return false;
      });

      setMessages(prev => [...prev, {
        id: `auth-success-${Date.now()}`,
        type: 'system',
        content: `Agent "${pendingMcpAuth.agentName}" activated with authenticated MCP servers.`,
        timestamp: Date.now(),
      }]);
    } else {
      // Auth failed or cancelled - warn user but keep agent active (without those servers)
      const mcpServers = await agentManagerRef.current.buildMcpServerConfig(pendingMcpAuth.definition);
      const apiServers = agentManagerRef.current.buildApiServers(pendingMcpAuth.definition);
      const agent = getAgent();
      agent.setActiveAgentDefinition(pendingMcpAuth.definition, mcpServers, apiServers);

      setMessages(prev => [...prev, {
        id: `auth-failed-${Date.now()}`,
        type: 'system',
        content: `Agent "${pendingMcpAuth.agentName}" activated. Some MCP servers may not work (authentication was not completed).`,
        timestamp: Date.now(),
      }]);
    }

    setPendingMcpAuth(null);
  }, [pendingMcpAuth, getAgent]);

  // Cancel MCP auth flow
  const cancelMcpAuth = useCallback(() => {
    completeMcpAuth(false);
  }, [completeMcpAuth]);

  // Trigger auth flow manually (for /auth command)
  const triggerMcpAuth = useCallback(() => {
    if (!agentManagerRef.current || !activeAgentDefinition) {
      setMessages(prev => [...prev, {
        id: `auth-error-${Date.now()}`,
        type: 'system',
        content: 'No active agent or no MCP servers configured.',
        timestamp: Date.now(),
      }]);
      return;
    }

    const serversNeedingAuth = agentManagerRef.current.getMcpServersNeedingAuth(activeAgentDefinition);
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

    // Build both MCP servers and API servers
    const mcpServers = await agentManagerRef.current.buildMcpServerConfig(pendingApiAuth.definition);
    const apiServers = agentManagerRef.current.buildApiServers(pendingApiAuth.definition);

    const agent = getAgent();
    agent.setActiveAgentDefinition(pendingApiAuth.definition, mcpServers, apiServers);

    // Set callbacks for agent tools
    setUpdateAgentInstructionsCallback(async (content: string) => {
      if (agentManagerRef.current) {
        return agentManagerRef.current.updateInstructions(content);
      }
      return false;
    });
    setReloadAgentInstructionsCallback(async () => {
      if (reloadAgentRef.current) {
        return reloadAgentRef.current();
      }
      return false;
    });

    const apiCount = Object.keys(apiServers).length;
    if (success) {
      setMessages(prev => [...prev, {
        id: `api-auth-success-${Date.now()}`,
        type: 'system',
        content: `Agent "${pendingApiAuth.agentName}" activated with ${apiCount} API(s).`,
        timestamp: Date.now(),
      }]);
    } else {
      setMessages(prev => [...prev, {
        id: `api-auth-failed-${Date.now()}`,
        type: 'system',
        content: `Agent "${pendingApiAuth.agentName}" activated. Some APIs may not work (authentication skipped).`,
        timestamp: Date.now(),
      }]);
    }

    setPendingApiAuth(null);
  }, [pendingApiAuth, getAgent]);

  // Cancel API auth flow
  const cancelApiAuth = useCallback(() => {
    completeApiAuth(false);
  }, [completeApiAuth]);

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
  };
}
