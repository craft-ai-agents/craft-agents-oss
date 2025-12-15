import React, { useState, memo } from 'react';
import { Box, Text } from 'ink';
import { formatDuration, truncateText } from '../utils/markdown.ts';
import { AnimatedSpinner } from './Spinner.tsx';
import { useElapsedTime } from '../hooks/index.ts';

export interface ToolCallProps {
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'error';
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  duration?: number;
  startTime?: number;
  compact?: boolean;
}

// Format tool name for display (snake_case to Title Case)
const formatToolName = (name: string): string => {
  // Handle MCP tools (mcp__server__tool)
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const tool = parts[2] || parts[1] || name;
    return tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Format input params as clean, readable text
const formatInputParams = (input?: Record<string, unknown>): string => {
  if (!input || Object.keys(input).length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;

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

// Get custom display for specific tools
const getCustomToolDisplay = (toolName: string, input?: Record<string, unknown>): { name: string; params: string } | null => {
  if (toolName === 'WebFetch' && input?.url) {
    return {
      name: 'Fetching content for',
      params: truncateText(String(input.url), 60),
    };
  }
  if (toolName === 'WebSearch' && input?.query) {
    return {
      name: 'Searching for',
      params: truncateText(String(input.query), 60),
    };
  }
  // Docs server tools - friendly names for documentation
  if (toolName === 'mcp__docs__SearchCraftAgents' || toolName === 'SearchCraftAgents') {
    return {
      name: 'Searching Documentation',
      params: input?.query ? truncateText(String(input.query), 60) : '',
    };
  }
  return null;
};

export const ToolCall: React.FC<ToolCallProps> = memo(({
  toolName,
  status,
  input,
  result,
  isError = false,
  duration,
  startTime,
  compact = true,
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
    }
  };

  const { icon, color } = getStatusDisplay();

  // Format for display - check for custom display first
  const customDisplay = getCustomToolDisplay(toolName, input);
  const displayName = customDisplay?.name ?? formatToolName(toolName);
  const inputParams = customDisplay?.params ?? formatInputParams(input);

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
          {inputParams && <Text color="gray"> {inputParams}</Text>}
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

/**
 * A group of tool calls with expand/collapse functionality
 */
export interface ToolCallGroupProps {
  tools: Array<{
    id: string;
    toolName: string;
    status: 'pending' | 'executing' | 'completed' | 'error';
    input?: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    duration?: number;
  }>;
  compact?: boolean;
}

export const ToolCallGroup: React.FC<ToolCallGroupProps> = memo(({ tools, compact = true }) => {
  return (
    <Box flexDirection="column">
      {tools.map((tool) => (
        <ToolCall
          key={tool.id}
          toolName={tool.toolName}
          status={tool.status}
          input={tool.input}
          result={tool.result}
          isError={tool.isError}
          duration={tool.duration}
          compact={compact}
        />
      ))}
    </Box>
  );
});
