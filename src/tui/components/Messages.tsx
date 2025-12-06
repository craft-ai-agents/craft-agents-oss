import React, { memo, useRef } from 'react';
import { Box, Text, Static } from 'ink';
import { ToolCall } from './ToolCall.tsx';
import { ThinkingIndicator } from './Spinner.tsx';
import { WelcomeBanner } from './Header.tsx';
import { useElapsedTime } from '../hooks/useElapsedTime.ts';
import { renderMarkdown } from '../utils/markdown.ts';

export interface Message {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolStatus?: 'pending' | 'executing' | 'completed' | 'error';
  toolDuration?: number;
  isError?: boolean;
  isStreaming?: boolean;
  timestamp?: number;
}

export interface MessagesProps {
  messages: Message[];
  isProcessing: boolean;
  streamingText?: string;
  status?: string;
  processingStartTime?: number | null;
  hasExecutingTool?: boolean;
  compact?: boolean;
  showWelcome?: boolean;
  resetKey?: number;
}

// Static item type - welcome banner or message
type StaticItem =
  | { type: 'welcome'; id: string; showHint: boolean }
  | { type: 'message'; id: string; message: Message };

export const Messages: React.FC<MessagesProps> = memo(({
  messages,
  isProcessing,
  streamingText,
  status,
  processingStartTime,
  hasExecutingTool = false,
  compact = true,
  showWelcome = false,
  resetKey = 0,
}) => {
  // Track elapsed time since processing started
  const elapsed = useElapsedTime({
    startTime: processingStartTime ?? null,
    enabled: isProcessing && !streamingText && !hasExecutingTool,
  });

  // Track which items have been rendered to Static (persists across renders)
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const lastResetKeyRef = useRef<number>(resetKey);

  // Clear the rendered IDs when resetKey changes (screen was cleared)
  if (resetKey !== lastResetKeyRef.current) {
    renderedIdsRef.current.clear();
    lastResetKeyRef.current = resetKey;
  }

  // Split messages: completed ones go in Static (won't re-render), active in dynamic area
  const completedMessages = messages.filter(m => m.toolStatus !== 'executing');
  const executingMessages = messages.filter(m => m.toolStatus === 'executing');

  // Build static items: only include NEW items not yet rendered
  const staticItems: StaticItem[] = [];

  // Welcome banner - add with unique ID based on resetKey
  // Each /clear increments resetKey, creating a fresh banner
  const welcomeId = `welcome-banner-${resetKey}`;
  if (showWelcome && !renderedIdsRef.current.has(welcomeId)) {
    staticItems.push({ type: 'welcome', id: welcomeId, showHint: messages.length === 0 });
    renderedIdsRef.current.add(welcomeId);
  }

  // Add completed messages that haven't been rendered yet
  // Include resetKey in ID so messages re-render after screen clear
  for (const msg of completedMessages) {
    const msgId = `${msg.id}-${resetKey}`;
    if (!renderedIdsRef.current.has(msgId)) {
      staticItems.push({ type: 'message', id: msgId, message: msg });
      renderedIdsRef.current.add(msgId);
    }
  }

  return (
    <Box flexDirection="column">
      {/* Static content: welcome banner + completed messages (rendered once) */}
      <Static items={staticItems}>
        {(item) => {
          if (item.type === 'welcome') {
            return (
              <Box key={`${item.id}-${resetKey}`} flexDirection="column" paddingX={1}>
                <WelcomeBanner />
                {item.showHint && (
                  <Box marginTop={1}>
                    <Text dimColor>
                      Type a message to get started, or /help for commands.
                    </Text>
                  </Box>
                )}
              </Box>
            );
          }
          return (
            <Box key={`${item.id}-${resetKey}`} paddingX={1}>
              <MessageItem
                message={item.message}
                compact={compact}
              />
            </Box>
          );
        }}
      </Static>

      {/* Currently executing tools - dynamic area */}
      {/* Use justifyContent="space-between" to fill full width (prevents resize artifacts) */}
      {executingMessages.map((message) => (
        <Box key={message.id} justifyContent="space-between" paddingX={1}>
          <Box>
            <MessageItem
              message={message}
              compact={compact}
            />
          </Box>
          <Box />
        </Box>
      ))}

      {/* Show streaming text */}
      {streamingText && (
        <Box justifyContent="space-between" paddingX={1}>
          <Box>
            <StreamingMessage content={streamingText} />
          </Box>
          <Box />
        </Box>
      )}

      {/* Show thinking indicator when processing but no streaming text and no executing tool */}
      {isProcessing && !streamingText && !hasExecutingTool && (
        <Box justifyContent="space-between" paddingX={1}>
          <Box>
            <ThinkingIndicator status={status} elapsedMs={elapsed ?? undefined} />
          </Box>
          <Box />
        </Box>
      )}
    </Box>
  );
});

interface MessageItemProps {
  message: Message;
  compact?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = memo(({ message, compact = true }) => {
  switch (message.type) {
    case 'user':
      return <UserMessage content={message.content} />;

    case 'assistant':
      return <AssistantMessage content={message.content} />;

    case 'tool':
      return (
        <ToolCall
          toolName={message.toolName || 'unknown'}
          status={message.toolStatus || 'completed'}
          input={message.toolInput}
          result={message.content}
          isError={message.isError}
          duration={message.toolDuration}
          startTime={message.timestamp}
          compact={compact}
        />
      );

    case 'error':
      return <ErrorMessage content={message.content} />;

    case 'status':
      return <StatusMessage content={message.content} />;

    case 'system':
      return <SystemMessage content={message.content} />;

    default:
      return null;
  }
});

// User message with blue styling
const UserMessage: React.FC<{ content: string }> = memo(({ content }) => {
  return (
    <Box marginTop={1} marginBottom={1}>
      <Box>
        <Text color="blue" bold>{'> '}</Text>
        <Text color="white" bold>{content}</Text>
      </Box>
    </Box>
  );
});

// Assistant message - renders markdown with Tokyo Night theme
const AssistantMessage: React.FC<{ content: string }> = memo(({ content }) => {
  const rendered = renderMarkdown(content);
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text>{rendered}</Text>
    </Box>
  );
});

// Streaming message - render markdown directly (throttling is handled in useAgent at 50ms)
const StreamingMessage: React.FC<{ content: string }> = memo(({ content }) => {
  // Render markdown directly - useAgent already throttles at 50ms
  const rendered = renderMarkdown(content);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text>{rendered}<Text color="blue">▌</Text></Text>
    </Box>
  );
});

// Error message with red styling
const ErrorMessage: React.FC<{ content: string }> = memo(({ content }) => {
  return (
    <Box marginTop={1} marginBottom={1}>
      <Box borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>Error: </Text>
        <Text color="red">{content}</Text>
      </Box>
    </Box>
  );
});

// Status message (dimmed)
const StatusMessage: React.FC<{ content: string }> = memo(({ content }) => {
  return (
    <Box marginY={1}>
      <Text dimColor>{content}</Text>
    </Box>
  );
});

// System message (for internal notifications)
const SystemMessage: React.FC<{ content: string }> = memo(({ content }) => {
  return (
    <Box marginY={1} paddingX={1}>
      <Text color="yellow" dimColor>{'─ '}</Text>
      <Text dimColor italic>{content}</Text>
      <Text color="yellow" dimColor>{' ─'}</Text>
    </Box>
  );
});

// Separator component
export const MessageSeparator: React.FC = () => {
  return (
    <Box marginY={1}>
      <Text dimColor>{'─'.repeat(40)}</Text>
    </Box>
  );
};
