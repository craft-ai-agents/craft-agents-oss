import React, { memo, useMemo, useState, useEffect } from 'react';
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
  showClock?: boolean;
  version?: string;
  planMode?: boolean;
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
  showClock = false,
  version,
  planMode = false,
  exitWarning = false,
}) => {
  // Live clock state - updates every second when enabled
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    if (!showClock) return;
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, [showClock]);

  // Format time with timezone abbreviation
  const clockDisplay = useMemo(() => {
    if (!showClock) return '';
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    // Get timezone abbreviation
    const tzAbbr = currentTime.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
    return `${timeStr} ${tzAbbr}`;
  }, [showClock, currentTime]);
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

  // Format auth type for display
  const authDisplay = useMemo(() => {
    if (authType === 'api_key') return 'API Key';
    if (authType === 'oauth_token') return 'Claude Sub';
    if (authType === 'craft_credits') return 'Craft Credits';
    return 'Unknown';
  }, [authType]);

  // Show only the exit warning when active (replaces entire header)
  if (exitWarning) {
    return (
      <Box justifyContent="space-between">
        <Text color="yellow" bold>Press Ctrl+C again to exit</Text>
        <Box />
      </Box>
    );
  }

  return (
    <Box justifyContent="space-between">
      {/* Left side: craft | ● mcp | auth | version */}
      <Box>
        {/* Agent name or "craft" */}
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
        {planMode && (
          <>
            <Text dimColor> </Text>
            <Text backgroundColor="#006400" color="white" bold> PLAN </Text>
          </>
        )}

        {/* MCP connection status */}
        <Text dimColor> | </Text>
        <Text color={connected ? 'green' : 'red'}>
          {connected ? '●' : '○'}
        </Text>
        <Text dimColor> {mcpDisplay}</Text>

        {/* Auth type */}
        <Text dimColor> | </Text>
        <Text color={authType === 'api_key' ? 'blue' : authType === 'craft_credits' ? 'magenta' : 'green'}>{authDisplay}</Text>

        {/* Version */}
        {version && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>v{version}</Text>
          </>
        )}
      </Box>

      {/* Right side: tokens | model | workspace */}
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
        {showClock && clockDisplay && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>{clockDisplay}</Text>
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
