import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { formatTokens } from '../utils/markdown.ts';
import type { AuthType, TokenDisplayMode } from '@craft-agent/shared/config';
import { AnimatedSpinner } from './Spinner.tsx';
import { DEFAULT_MODEL, getModelDisplayName } from '@craft-agent/shared/config';
import { CRAFT_LOGO } from '@craft-agent/shared/branding';

export interface HeaderProps {
  connected: boolean;
  model?: string;
  mcpUrl?: string;
  workspaceName?: string;
  contextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  authType?: AuthType;
  activeAgentName?: string;
  agentsLoading?: boolean;
  tokenDisplay?: TokenDisplayMode;
  showCost?: boolean;
  version?: string;
  safeMode?: boolean;
  /** Show "Press Ctrl+C again to exit" warning */
  exitWarning?: boolean;
}

export const Header: React.FC<HeaderProps> = memo(({
  connected,
  model = DEFAULT_MODEL,
  mcpUrl,
  workspaceName,
  contextTokens = 0,
  inputTokens = 0,
  outputTokens = 0,
  costUsd = 0,
  authType = 'api_key',
  activeAgentName,
  agentsLoading = false,
  tokenDisplay = 'hidden',
  showCost = true,
  version,
  safeMode = false,
  exitWarning = false,
}) => {
  // Map model IDs to friendly names
  const modelDisplay = useMemo(() => getModelDisplayName(model), [model]);

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
        {safeMode && (
          <>
            <Text dimColor> </Text>
            <Text backgroundColor="#006400" color="white" bold> SAFE </Text>
          </>
        )}
        <Text dimColor> | </Text>
        <Text color={connected ? 'green' : 'red'}>
          {connected ? '●' : '○'}
        </Text>
        <Text dimColor> {mcpDisplay}</Text>
        <Text dimColor> | </Text>
        <Text color={authType === 'oauth_token' ? 'green' : authType === 'craft_credits' ? 'magenta' : 'blue'}>
          {authType === 'oauth_token' ? 'Claude Sub' : authType === 'craft_credits' ? 'Craft Credits' : 'API Key'}
        </Text>
        {version && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>v{version}</Text>
          </>
        )}
        {exitWarning && (
          <>
            <Text dimColor> | </Text>
            <Text color="yellow">Press Ctrl+C again to exit</Text>
          </>
        )}
      </Box>

      <Box>
        {tokenDisplay !== 'hidden' && (inputTokens > 0 || outputTokens > 0) && (
          <>
            <Text dimColor>
              {tokenDisplay === 'separate'
                ? `${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`
                : formatTokens(inputTokens + outputTokens)}
            </Text>
            {showCost && authType === 'api_key' && costUsd > 0 && (
              <Text dimColor> ({costDisplay})</Text>
            )}
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
  exitWarning?: boolean;
}

export const StatusLine: React.FC<StatusLineProps> = memo(({
  isProcessing,
  connected,
  compact = false,
  exitWarning = false,
}) => {
  return (
    <Box paddingX={1}>
      {exitWarning ? (
        <Text color="yellow">Press Ctrl+C again to exit</Text>
      ) : (
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
      )}
    </Box>
  );
});

/**
 * Welcome banner shown on startup with ASCII art logo
 *
 * Use direct ANSI escape sequences for maximum terminal compatibility
 * Ink/chalk's color handling can is inconsistent across terminals
 */
export const WelcomeBanner: React.FC<{ version?: string }> = memo(({ version = '1.0.0' }) => {
  const purple = '\x1b[38;2;157;140;255m';
  const reset = '\x1b[0m';

  const logo = CRAFT_LOGO;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{' '}</Text>
      {logo.map((line, i) => (
        <Text key={i}>{purple}{line}{reset}</Text>
      ))}
      <Text>{' '}</Text>
    </Box>
  );
});
