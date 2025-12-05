import React, { useCallback, useState, useMemo } from 'react';
import { Box, useApp, useInput, Text } from 'ink';
import { Header, WelcomeBanner } from './components/Header.tsx';
import { Messages, type Message } from './components/Messages.tsx';
import { Input, InputHint } from './components/Input.tsx';
import { ModelSelector, type Model } from './components/ModelSelector.tsx';
import { useAgent } from './hooks/useAgent.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useResize } from './hooks/useResize.ts';
import { formatToolsHelp } from '../mcp/tools.ts';
import { getConfigPath } from '../config/storage.ts';
import { formatPreferencesDisplay, getPreferencesPath } from '../config/preferences.ts';
import { formatTokens, estimateCost } from './utils/markdown.ts';
import { processInputWithFiles, readClipboard, type FileAttachment } from './utils/files.ts';
import type { CraftAgentConfig } from '../agent/craft-agent.ts';

export interface AppProps {
  config: CraftAgentConfig;
  onRequestSetup?: () => void;
}

const HELP_TEXT = `
**Craft Document Assistant** - Commands

**Chat**
  Just type your message and press Enter to chat with Claude.

**Commands**
  /help      Show this help message
  /clear     Clear conversation history
  /paste     Paste files/images from clipboard
  /tools     List available Craft MCP tools
  /config    Show current configuration
  /prefs     Show user preferences
  /setup     Reconfigure API keys and MCP settings
  /compact   Toggle compact/expanded tool output
  /cost      Show token usage and estimated cost
  /model     Show or change model (e.g., /model opus)
  /web       Toggle web search capability
  /fetch     Toggle web fetch capability
  /code      Toggle code execution capability
  /exit      Exit the application (or Ctrl+C)

**Keyboard Shortcuts**
  Enter      Send message
  ↑/↓        Navigate command history
  Backspace  Remove last attached file (when input is empty)
  Ctrl+C     Interrupt / Exit
  Ctrl+U     Clear input line
  Esc        Interrupt current operation

**Attaching Files**
  Drag & drop   Drag file into terminal window
  /paste        Paste from clipboard (Cmd+C a file first)
  Type path     Include /path/to/file in your message

**Ghostty Users**
  By default Ghostty uses Ctrl+Shift+V for paste.
  Add to ~/.config/ghostty/config:
    keybind = performable:ctrl+v=paste_from_clipboard

**Examples**
  "Show me today's daily note"
  "Search for meeting notes about project X"
  "What's the weather in NYC?" (uses web search)
  "Fetch and summarize https://example.com" (uses web fetch)
  "Calculate the sum of 1 to 100" (uses code execution)
`.trim();

export const App: React.FC<AppProps> = ({ config, onRequestSetup }) => {
  const { exit } = useApp();

  // Handle terminal resize - clears screen to prevent artifacts
  const { columns } = useResize();

  const {
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
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
  } = useAgent(config);

  const { history, addToHistory } = useHistory();
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [compactMode, setCompactMode] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);

  // Models list
  const models: Model[] = [
    { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', desc: 'Most capable' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', desc: 'Balanced' },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Fast & efficient' },
  ];

  const addLocalMessage = useCallback((content: string, type: Message['type'] = 'status') => {
    setLocalMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, type, content, timestamp: Date.now() },
    ]);
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setShowModelSelector(false);
    setModel(modelId);
  }, [setModel]);

  const handleModelCancel = useCallback(() => {
    setShowModelSelector(false);
  }, []);

  const handlePaste = useCallback(() => {
    try {
      const clipboardItems = readClipboard();

      if (clipboardItems.length > 0) {
        setPendingAttachments(prev => [...prev, ...clipboardItems]);
      } else {
        addLocalMessage('No files or images in clipboard. Copy a file (Cmd+C) or take a screenshot first.', 'error');
      }
    } catch (err) {
      addLocalMessage(`Clipboard error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [addLocalMessage]);

  // Remove last attachment when backspace pressed with empty input
  const handleRemoveAttachment = useCallback(() => {
    setPendingAttachments(prev => {
      if (prev.length > 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  // Clear all attachments (Escape key)
  const handleClearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  // Handle pasted text (e.g., dragged file paths from terminal)
  const handlePastedText = useCallback((text: string) => {
    // Check if the pasted text contains file paths
    const { attachments, errors } = processInputWithFiles(text);

    if (attachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...attachments]);
    }

    for (const error of errors) {
      addLocalMessage(error, 'error');
    }
  }, [addLocalMessage]);

  // Generate attachment label for display
  const attachmentLabel = useMemo(() => {
    if (pendingAttachments.length === 0) return '';
    if (pendingAttachments.length === 1) {
      const att = pendingAttachments[0];
      if (!att) return '1 file';
      const icon = att.type === 'image' ? '🖼' : att.type === 'pdf' ? '📄' : '📝';
      return `${icon} ${att.name}`;
    }
    const imageCount = pendingAttachments.filter(a => a.type === 'image').length;
    const fileCount = pendingAttachments.length - imageCount;
    const parts: string[] = [];
    if (imageCount > 0) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
    if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
    return parts.join(', ');
  }, [pendingAttachments]);

  const handleSubmit = useCallback(
    async (input: string) => {
      // Hide welcome on first interaction
      if (showWelcome) {
        setShowWelcome(false);
      }

      // Handle slash commands
      if (input.startsWith('/')) {
        const parts = input.toLowerCase().trim().split(/\s+/);
        let command = parts[0] ?? '';

        // Primary commands for partial matching (order matters for priority)
        const primaryCommands = [
          '/help', '/clear', '/paste', '/tools', '/config', '/prefs',
          '/setup', '/compact', '/cost', '/model', '/web', '/fetch',
          '/code', '/exit'
        ];

        // If not an exact match, try partial matching
        const aliases = ['/?', '/q', '/quit', '/image', '/preferences', '/websearch', '/webfetch', '/codeexec', '/execute'];
        if (!primaryCommands.includes(command) && !aliases.includes(command)) {
          const matches = primaryCommands.filter(cmd => cmd.startsWith(command));
          if (matches.length === 1 && matches[0]) {
            command = matches[0];
          }
        }

        switch (command) {
          case '/exit':
          case '/quit':
          case '/q':
            exit();
            return;

          case '/clear':
            // Clear state first
            clearMessages();
            setLocalMessages([]);
            setPendingAttachments([]);
            setShowWelcome(true);
            // Clear screen and scrollback only - let Ink handle cursor
            process.stdout.write('\x1b[2J\x1b[3J');
            return;

          case '/paste':
          case '/image': {
            const clipboardItems = readClipboard();
            if (clipboardItems.length > 0) {
              setPendingAttachments(prev => [...prev, ...clipboardItems]);
            } else {
              addLocalMessage('No files or images in clipboard. Copy a file (Cmd+C) or take a screenshot first.', 'error');
            }
            return;
          }

          case '/help':
          case '/?':
            addLocalMessage(HELP_TEXT, 'assistant');
            return;

          case '/tools':
            addLocalMessage(formatToolsHelp(), 'assistant');
            return;

          case '/setup':
            if (onRequestSetup) {
              onRequestSetup();
            } else {
              addLocalMessage('Setup not available. Run with --setup flag to reconfigure.', 'status');
            }
            return;

          case '/config':
            addLocalMessage(
              `**Configuration**

- Config file: \`${getConfigPath()}\`
- MCP URL: \`${config.mcpUrl}\`
- Model: \`${model}\`
- Compact mode: ${compactMode ? 'On' : 'Off'}
- Web search: ${isWebSearchEnabled() ? 'On' : 'Off'}
- Web fetch: ${isWebFetchEnabled() ? 'On' : 'Off'}
- Code execution: ${isCodeExecutionEnabled() ? 'On' : 'Off'}`,
              'assistant'
            );
            return;

          case '/prefs':
          case '/preferences':
            addLocalMessage(formatPreferencesDisplay(), 'assistant');
            return;

          case '/compact':
            setCompactMode(!compactMode);
            addLocalMessage(
              `Compact mode: ${!compactMode ? 'On' : 'Off'}`,
              'system'
            );
            return;

          case '/cost':
            const cost = estimateCost(tokenUsage.inputTokens, tokenUsage.outputTokens);
            addLocalMessage(
              `**Token Usage (this session)**

- Input tokens: ${formatTokens(tokenUsage.inputTokens)}
- Output tokens: ${formatTokens(tokenUsage.outputTokens)}
- Total tokens: ${formatTokens(tokenUsage.totalTokens)}
- Estimated cost: ${cost}`,
              'assistant'
            );
            return;

          case '/model': {
            const modelArg = parts[1];

            if (modelArg) {
              // Parse number selection
              const num = parseInt(modelArg, 10);
              if (num >= 1 && num <= models.length) {
                const selected = models[num - 1];
                if (selected) {
                  setModel(selected.id);
                }
                return;
              }

              // Find matching model (partial match)
              const matchedModel = models.find(m =>
                m.id.toLowerCase().includes(modelArg.toLowerCase()) ||
                m.name.toLowerCase().includes(modelArg.toLowerCase())
              );

              if (matchedModel) {
                setModel(matchedModel.id);
              } else {
                addLocalMessage(`Unknown model: ${modelArg}`, 'error');
              }
            } else {
              // Show interactive selector
              setShowModelSelector(true);
            }
            return;
          }

          case '/web':
          case '/websearch': {
            const newState = !isWebSearchEnabled();
            setWebSearchEnabled(newState);
            addLocalMessage(
              `Web search: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          case '/fetch':
          case '/webfetch': {
            const newState = !isWebFetchEnabled();
            setWebFetchEnabled(newState);
            addLocalMessage(
              `Web fetch: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          case '/code':
          case '/codeexec':
          case '/execute': {
            const newState = !isCodeExecutionEnabled();
            setCodeExecutionEnabled(newState);
            addLocalMessage(
              `Code execution: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          default:
            addLocalMessage(`Unknown command: ${command}. Type /help for available commands.`, 'error');
            return;
        }
      }

      // Clear local messages when sending a real message
      setLocalMessages([]);

      // Process input for file attachments
      const { text, attachments: fileAttachments, errors } = processInputWithFiles(input);

      // Combine file attachments with pending clipboard attachments
      const allAttachments = [...pendingAttachments, ...fileAttachments];

      // Clear pending attachments
      setPendingAttachments([]);

      // Show any file processing errors
      for (const error of errors) {
        addLocalMessage(error, 'error');
      }

      // Regular message - add to history and send with attachments
      addToHistory(input);
      await sendMessage(text || input, allAttachments.length > 0 ? allAttachments : undefined);
    },
    [
      exit,
      clearMessages,
      sendMessage,
      addToHistory,
      addLocalMessage,
      onRequestSetup,
      config,
      compactMode,
      tokenUsage,
      showWelcome,
      model,
      setModel,
      isWebSearchEnabled,
      setWebSearchEnabled,
      isWebFetchEnabled,
      setWebFetchEnabled,
      isCodeExecutionEnabled,
      setCodeExecutionEnabled,
      pendingAttachments,
    ]
  );

  // Handle Ctrl+C to interrupt or exit
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isProcessing) {
        interrupt();
      } else {
        exit();
      }
    }

    // Handle Escape to interrupt
    if (key.escape && isProcessing) {
      interrupt();
    }
  });

  // Combine agent messages with local messages
  const allMessages = [...messages, ...localMessages];

  return (
    <Box flexDirection="column" width="100%" minHeight={20}>
      {/* Welcome banner (shown once) */}
      {showWelcome && allMessages.length === 0 && (
        <Box flexDirection="column" paddingX={1}>
          <WelcomeBanner />
          <Box marginTop={1}>
            <Text dimColor>
              Type a message to get started, or /help for commands.
            </Text>
          </Box>
        </Box>
      )}

      {/* Messages area */}
      <Box flexDirection="column" paddingX={1}>
        <Messages
          messages={allMessages}
          isProcessing={isProcessing}
          streamingText={streamingText}
          status={status}
          processingStartTime={processingStartTime}
          compact={compactMode}
        />
      </Box>

      {/* Model selector overlay */}
      {showModelSelector && (
        <ModelSelector
          models={models}
          currentModelId={model}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      )}

      {/* Input + Status bar + Header together at bottom */}
      <Box flexDirection="column" width="100%" paddingX={1}>
        {!showModelSelector && (
          <Input
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            onPastedText={handlePastedText}
            disabled={isProcessing}
            history={history}
            attachmentCount={pendingAttachments.length}
            attachmentLabel={attachmentLabel}
            columns={columns}
          />
        )}
        <Header
          connected={connected}
          model={model}
          mcpUrl={config.mcpUrl}
          contextTokens={tokenUsage.contextTokens}
          cost={estimateCost(tokenUsage.inputTokens, tokenUsage.outputTokens)}
        />
      </Box>
    </Box>
  );
};
