import { useState, useCallback, useRef, useEffect } from 'react';
import { CraftAgent, type CraftAgentConfig, type AgentEvent } from '../../agent/craft-agent.ts';
import type { Message } from '../components/Messages.tsx';
import type { FileAttachment } from '../utils/files.ts';

// Throttle streaming updates to reduce flickering
const STREAMING_THROTTLE_MS = 50;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UseAgentResult {
  messages: Message[];
  isProcessing: boolean;
  streamingText: string;
  status: string;
  connected: boolean;
  error: string | null;
  tokenUsage: TokenUsage;
  sendMessage: (input: string, attachments?: FileAttachment[]) => Promise<void>;
  clearMessages: () => void;
  interrupt: () => void;
  model: string;
  setModel: (model: string) => void;
  isWebSearchEnabled: () => boolean;
  setWebSearchEnabled: (enabled: boolean) => void;
  isWebFetchEnabled: () => boolean;
  setWebFetchEnabled: (enabled: boolean) => void;
  isCodeExecutionEnabled: () => boolean;
  setCodeExecutionEnabled: (enabled: boolean) => void;
}

export function useAgent(config: CraftAgentConfig): UseAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  const [model, setModelState] = useState(config.model || 'claude-sonnet-4-5-20250929');

  const agentRef = useRef<CraftAgent | null>(null);
  const toolStartTimeRef = useRef<Map<string, number>>(new Map());
  const streamingBufferRef = useRef<string>('');
  const lastStreamingUpdateRef = useRef<number>(0);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptedRef = useRef<boolean>(false);

  const getAgent = useCallback(() => {
    if (!agentRef.current) {
      agentRef.current = new CraftAgent(config);
    }
    return agentRef.current;
  }, [config]);

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

          case 'tool_start':
            toolStartTimeRef.current.set(event.toolUseId, Date.now());
            setStatus(`Calling ${event.toolName}...`);
            setMessages((prev) => [
              ...prev,
              {
                id: `tool-${event.toolUseId}`,
                type: 'tool',
                toolName: event.toolName,
                toolInput: event.input,
                toolStatus: 'executing',
                content: '',
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'tool_result': {
            const startTime = toolStartTimeRef.current.get(event.toolUseId);
            const duration = startTime ? Date.now() - startTime : undefined;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === `tool-${event.toolUseId}`
                  ? {
                      ...m,
                      toolStatus: event.isError ? 'error' : 'completed',
                      content: event.result,
                      isError: event.isError,
                      toolDuration: duration,
                      toolInput: event.input || m.toolInput,
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
      setIsProcessing(false);
      setStreamingText('');
      setStatus('');
    }
  }, [getAgent, isProcessing]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    if (agentRef.current) {
      agentRef.current.clearHistory();
    }
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
  }, []);

  const isWebSearchEnabled = useCallback(() => {
    if (agentRef.current) {
      return agentRef.current.isWebSearchEnabled();
    }
    return config.enableWebSearch ?? true;
  }, [config.enableWebSearch]);

  const setWebSearchEnabled = useCallback((enabled: boolean) => {
    if (agentRef.current) {
      agentRef.current.setWebSearchEnabled(enabled);
    }
  }, []);

  const isWebFetchEnabled = useCallback(() => {
    if (agentRef.current) {
      return agentRef.current.isWebFetchEnabled();
    }
    return config.enableWebFetch ?? true;
  }, [config.enableWebFetch]);

  const setWebFetchEnabled = useCallback((enabled: boolean) => {
    if (agentRef.current) {
      agentRef.current.setWebFetchEnabled(enabled);
    }
  }, []);

  const isCodeExecutionEnabled = useCallback(() => {
    if (agentRef.current) {
      return agentRef.current.isCodeExecutionEnabled();
    }
    return config.enableCodeExecution ?? true;
  }, [config.enableCodeExecution]);

  const setCodeExecutionEnabled = useCallback((enabled: boolean) => {
    if (agentRef.current) {
      agentRef.current.setCodeExecutionEnabled(enabled);
    }
  }, []);

  return {
    messages,
    isProcessing,
    streamingText,
    status,
    connected,
    error,
    tokenUsage,
    sendMessage,
    clearMessages,
    interrupt,
    model,
    setModel,
    isWebSearchEnabled,
    setWebSearchEnabled,
    isWebFetchEnabled,
    setWebFetchEnabled,
    isCodeExecutionEnabled,
    setCodeExecutionEnabled,
  };
}
