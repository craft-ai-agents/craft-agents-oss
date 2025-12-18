import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentError, RecoveryAction } from '@craft-agent/shared/agent';

export interface ErrorBannerProps {
  error: AgentError;
  onAction: (action: RecoveryAction) => void;
  onDismiss: () => void;
}

/**
 * User-friendly error banner with recovery actions.
 *
 * Displays a styled error message with keyboard shortcuts for recovery actions.
 * Used for billing errors, auth errors, and other recoverable errors.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onAction,
  onDismiss,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const hasDetails = (error.details && error.details.length > 0) || error.originalError;

  useInput((input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }

    // Toggle details
    if (input.toLowerCase() === 'd' && hasDetails) {
      setShowDetails(!showDetails);
      return;
    }

    // Check for action shortcuts
    const lowerInput = input.toLowerCase();
    for (const action of error.actions) {
      if (action.key.toLowerCase() === lowerInput) {
        onAction(action);
        return;
      }
    }
  });

  // Choose icon based on error type
  const icon = error.canRetry ? '!' : 'x';
  const iconColor = error.canRetry ? 'yellow' : 'red';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={iconColor}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      {/* Header */}
      <Box>
        <Text color={iconColor} bold>{icon} </Text>
        <Text bold>{error.title}</Text>
      </Box>

      {/* Message */}
      <Box marginTop={1}>
        <Text>{error.message}</Text>
      </Box>

      {/* Actions */}
      {error.actions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {error.actions.map((action, i) => (
            <Box key={i}>
              <Text dimColor>  Press </Text>
              <Text color="cyan" bold>{action.key.toUpperCase()}</Text>
              <Text dimColor> to {action.label}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Technical Details Toggle */}
      {hasDetails && (
        <Box marginTop={1}>
          <Text dimColor>  Press </Text>
          <Text color="cyan" bold>D</Text>
          <Text dimColor> to {showDetails ? 'hide' : 'show'} technical details</Text>
        </Box>
      )}

      {/* Technical Details Content */}
      {showDetails && hasDetails && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Text dimColor bold>─── Technical Details ───</Text>
          {error.details?.map((detail, i) => (
            <Text key={i} dimColor>{detail}</Text>
          ))}
          {error.originalError && !error.details?.some(d => d.includes('Raw error:')) && (
            <Text dimColor>Raw: {error.originalError.slice(0, 200)}{error.originalError.length > 200 ? '...' : ''}</Text>
          )}
        </Box>
      )}

      {/* Dismiss hint */}
      <Box marginTop={1}>
        <Text dimColor>Press Esc to dismiss</Text>
      </Box>
    </Box>
  );
};

/**
 * Inline error message (simpler, for non-blocking errors)
 */
export interface InlineErrorProps {
  title: string;
  message: string;
}

export const InlineError: React.FC<InlineErrorProps> = ({ title, message }) => {
  return (
    <Box marginY={1}>
      <Text color="red" bold>{title}: </Text>
      <Text color="red">{message}</Text>
    </Box>
  );
};

/**
 * Warning banner for low credits (non-blocking)
 */
export interface LowCreditsWarningProps {
  balance: number;
  onTopUp: () => void;
}

export const LowCreditsWarning: React.FC<LowCreditsWarningProps> = ({
  balance,
  onTopUp,
}) => {
  useInput((input) => {
    if (input.toLowerCase() === 'c') {
      onTopUp();
    }
  });

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color="yellow">! </Text>
      <Text color="yellow">Low credits: </Text>
      <Text color="yellow" bold>{balance.toFixed(2)}</Text>
      <Text dimColor> remaining. Press </Text>
      <Text color="cyan" bold>C</Text>
      <Text dimColor> to top up.</Text>
    </Box>
  );
};
