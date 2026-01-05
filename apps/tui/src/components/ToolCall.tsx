import React, { useState, memo } from 'react';
import { Box, Text } from 'ink';
import { formatDuration, truncateText } from '../utils/markdown.ts';
import { AnimatedSpinner } from './Spinner.tsx';
import { useElapsedTime } from '../hooks/index.ts';
import { getToolDisplayName } from '@craft-agent/shared/utils';

export interface ToolCallProps {
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'error' | 'backgrounded';
  input?: Record<string, unknown>;
  intent?: string;  // Explicit intent from **Doing:** marker or Bash description
  result?: string;
  isError?: boolean;
  duration?: number;
  startTime?: number;
  compact?: boolean;
  taskId?: string;          // For background Task
  shellId?: string;         // For background Bash
  elapsedSeconds?: number;  // Live elapsed time for background tasks
}

// Format input params as clean, readable text
const formatInputParams = (input?: Record<string, unknown>): string => {
  if (!input || Object.keys(input).length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    // Skip _intent field (used for UI display separately) and undefined/null values
    if (key === '_intent' || value === undefined || value === null) continue;

    let valStr: string;
    if (typeof value === 'string') {
      // Clean up whitespace, trim
      valStr = value.replace(/\s+/g, ' ').trim();
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      valStr = String(value);
    } else {
      // For objects/arrays, stringify and clean up
      valStr = JSON.stringify(value).replace(/[{}"]/g, '').replace(/,/g, ', ').trim();
    }

    if (valStr) {
      parts.push(`${key}: ${valStr}`);
    }
  }

  return truncateText(parts.join(', '), 60);
};

// Get custom display for specific tools that need special formatting
const getCustomToolDisplay = (toolName: string, input?: Record<string, unknown>): { name: string; params: string } | null => {
  if (toolName === 'WebFetch' && input?.url) {
    return {
      name: 'Fetching',
      params: truncateText(String(input.url), 60),
    };
  }
  if (toolName === 'WebSearch' && input?.query) {
    return {
      name: 'Searching',
      params: truncateText(String(input.query), 60),
    };
  }
  // Docs server tools - friendly names for documentation
  if (toolName === 'mcp__docs__SearchCraftAgents' || toolName === 'SearchCraftAgents') {
    return {
      name: 'Searching Docs',
      params: input?.query ? truncateText(String(input.query), 60) : '',
    };
  }
  return null;
};

export const ToolCall: React.FC<ToolCallProps> = memo(({
  toolName,
  status,
  input,
  intent,
  result,
  isError = false,
  duration,
  startTime,
  compact = true,
  taskId,
  shellId,
  elapsedSeconds,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Live elapsed time for executing tools
  const liveElapsed = useElapsedTime({
    startTime: startTime ?? null,
    enabled: status === 'executing',
  });

  // Get appropriate icon and color
  const getStatusDisplay = () => {
    switch (status) {
      case 'pending':
        return { icon: '○', color: 'gray' as const };
      case 'executing':
        return { icon: null, color: 'yellow' as const }; // spinner
      case 'completed':
        return { icon: '✓', color: 'green' as const };
      case 'error':
        return { icon: '✗', color: 'red' as const };
      case 'backgrounded':
        return { icon: '⟳', color: 'cyan' as const };
    }
  };

  const { icon, color } = getStatusDisplay();

  // Format for display - prefer intent, then custom display, then formatted params
  const customDisplay = getCustomToolDisplay(toolName, input);

  // For background tasks, show task/shell ID with elapsed time
  let displayDescription: string;
  if (taskId) {
    displayDescription = `Task ID: ${taskId}${elapsedSeconds ? `, ${formatDuration(elapsedSeconds * 1000)} elapsed` : ''}`;
  } else if (shellId) {
    displayDescription = `Shell ID: ${shellId}${elapsedSeconds ? `, ${formatDuration(elapsedSeconds * 1000)} elapsed` : ''}`;
  } else {
    // Use intent as the display description if available (most user-friendly)
    displayDescription = intent
      ? truncateText(intent, 70)
      : customDisplay?.params ?? formatInputParams(input);
  }

  // Use custom name if available, otherwise use friendly display name
  const displayName = customDisplay?.name ?? getToolDisplayName(toolName);

  // Compact view (single line, but with progress sub-lines when executing)
  if (compact && !expanded) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {/* Main tool header line */}
        <Box>
          {status === 'executing' ? (
            <Box>
              <AnimatedSpinner color="yellow" />
              <Text> </Text>
            </Box>
          ) : (
            <Text color={color}>{icon} </Text>
          )}
          <Text dimColor>{displayName}</Text>
          {displayDescription && <Text color="gray"> {displayDescription}</Text>}
          {status === 'executing' && liveElapsed !== null && liveElapsed >= 1000 && (
            <Text dimColor> ({formatDuration(liveElapsed)})</Text>
          )}
          {status === 'completed' && duration !== undefined && (
            <Text dimColor> ({formatDuration(duration)})</Text>
          )}
          {status === 'error' && result && (
            <Text color="red"> — {truncateText(result.replace(/\n/g, ' '), 50)}</Text>
          )}
        </Box>
        {/* Progress messages when executing (indented below header) */}
        {status === 'executing' && result && (
          <Box paddingLeft={2}>
            <Text dimColor>{result}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Expanded view
  return (
    <Box flexDirection="column" paddingLeft={1} marginY={1}>
      {/* Header */}
      <Box>
        {status === 'executing' ? (
          <AnimatedSpinner color="yellow" />
        ) : (
          <Text color={color}>{icon}</Text>
        )}
        <Text> </Text>
        <Text color="magenta" bold>{displayName}</Text>
        {status === 'executing' && liveElapsed !== null && liveElapsed >= 1000 && (
          <Text dimColor> ({formatDuration(liveElapsed)})</Text>
        )}
        {status !== 'executing' && duration !== undefined && (
          <Text dimColor> ({formatDuration(duration)})</Text>
        )}
      </Box>

      {/* Intent - what the model is trying to accomplish */}
      {intent && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Goal: </Text>
          <Text color="gray">{intent}</Text>
        </Box>
      )}

      {/* Input */}
      {input && Object.keys(input).length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text dimColor bold>Input:</Text>
          <Box paddingLeft={2} flexDirection="column">
            {Object.entries(input).map(([key, value]) => (
              <Box key={key}>
                <Text color="cyan">{key}</Text>
                <Text dimColor>: </Text>
                <Text wrap="truncate-end">
                  {typeof value === 'string'
                    ? truncateText(value, 100)
                    : JSON.stringify(value)}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Result */}
      {result && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text color={isError ? 'red' : 'green'} bold>
            {isError ? 'Error:' : 'Result:'}
          </Text>
          <Box paddingLeft={2}>
            <Text color={isError ? 'red' : 'gray'} wrap="wrap">
              {truncateText(result, 500)}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
});
