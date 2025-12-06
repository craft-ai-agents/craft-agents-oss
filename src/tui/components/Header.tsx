import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { formatTokens } from '../utils/markdown.ts';
import type { AuthType } from '../../config/storage.ts';
import { AnimatedSpinner } from './Spinner.tsx';

export interface HeaderProps {
  connected: boolean;
  model?: string;
  mcpUrl?: string;
  workspaceName?: string;
  contextTokens?: number;
  costUsd?: number;
  authType?: AuthType;
  activeAgentName?: string;
  agentsLoading?: boolean;
}

export const Header: React.FC<HeaderProps> = memo(({
  connected,
  model = 'claude-sonnet-4-5-20250929',
  mcpUrl,
  workspaceName,
  contextTokens = 0,
  costUsd = 0,
  authType = 'api_key',
  activeAgentName,
  agentsLoading = false,
}) => {
  // Map model IDs to friendly names
  const modelDisplay = useMemo(() => {
    const modelNames: Record<string, string> = {
      'claude-opus-4-5-20251101': 'Opus 4.5',
      'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
      'claude-haiku-4-5-20251001': 'Haiku 4.5',
    };
    return modelNames[model] || model.replace('claude-', '').replace(/-\d{8}$/, '');
  }, [model]);

  // Extract MCP server name from URL
  const mcpDisplay = useMemo(() => mcpUrl
    ? mcpUrl.replace(/^https?:\/\//, '').split('/')[0]
    : 'Not connected', [mcpUrl]);

  // Format cost from SDK (already in USD) - round to 2 decimal places
  const costDisplay = useMemo(() => {
    if (costUsd < 0.01) {
      return `${(costUsd * 100).toFixed(1)}¢`;
    }
    return `$${costUsd.toFixed(2)}`;
  }, [costUsd]);

  return (
    <Box justifyContent="space-between">
      <Box>
        {agentsLoading && (
          <>
            <AnimatedSpinner color="magenta" />
            <Text dimColor> </Text>
          </>
        )}
        {activeAgentName ? (
          <Text color="magenta" bold>@{activeAgentName.length > 12 ? activeAgentName.slice(0, 12) + '…' : activeAgentName}</Text>
        ) : (
          <Text color="magenta" bold>craft</Text>
        )}
        <Text dimColor> | </Text>
        <Text color={connected ? 'green' : 'red'}>
          {connected ? '●' : '○'}
        </Text>
        <Text dimColor> {mcpDisplay}</Text>
        <Text dimColor> | </Text>
        <Text color={authType === 'oauth_token' ? 'green' : 'blue'}>
          {authType === 'oauth_token' ? 'Max' : 'API'}
        </Text>
      </Box>

      <Box>
        {contextTokens > 0 && (
          <>
            <Text dimColor>{formatTokens(contextTokens)} ({costDisplay})</Text>
            <Text dimColor> | </Text>
          </>
        )}
        <Text color="cyan">{modelDisplay}</Text>
        {workspaceName && (
          <>
            <Text dimColor> | </Text>
            <Text color="yellow">{workspaceName.length > 20 ? workspaceName.slice(0, 20) + '…' : workspaceName}</Text>
          </>
        )}
      </Box>
    </Box>
  );
});

/**
 * Minimal status line for bottom of screen
 */
export interface StatusLineProps {
  isProcessing: boolean;
  connected: boolean;
  compact?: boolean;
}

export const StatusLine: React.FC<StatusLineProps> = memo(({
  isProcessing,
  connected,
  compact = false,
}) => {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        {isProcessing ? 'Ctrl+C to interrupt' : 'Ctrl+C to exit'}
        {'  '}
        /help for commands
        {!compact && (
          <>
            {'  '}
            /clear to reset
          </>
        )}
      </Text>
    </Box>
  );
});

/**
 * Welcome banner shown on startup with ASCII art logo
 */
export const WelcomeBanner: React.FC<{ version?: string }> = memo(({ version = '1.0.0' }) => {
  const logo = [
    '                                                      ',
    '                                                      ',
    '  ████████ █████████    ██████   ██████████ ██████████',
    '██████████ ██████████ ██████████ █████████  ██████████',
    '██████     ██████████ ██████████ ████████   ██████████',
    '██████████ ████████   ██████████ ███████      █████   ',
    '  ████████ ████  ████ ████  ████ █████        █████   ',
    '                                                      ',
    '                                                      ',
  ];

  return (
    <Box flexDirection="column" marginBottom={1}>
      {logo.map((line, i) => (
        <Box key={i}>
          <Text color="magenta" bold>{line}</Text>
        </Box>
      ))}
    </Box>
  );
});
