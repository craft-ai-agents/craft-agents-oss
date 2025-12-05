import React, { memo } from 'react';
import { Box, Text } from 'ink';

export interface SpinnerProps {
  label?: string;
  color?: string;
}

// Simple static spinner - no animation to prevent re-renders
export const Spinner: React.FC<SpinnerProps> = memo(({ label = 'Loading', color = 'cyan' }) => {
  return (
    <Box>
      <Text color={color}>●</Text>
      <Text dimColor> {label}...</Text>
    </Box>
  );
});

export interface ThinkingIndicatorProps {
  status?: string;
}

// Static indicator - no animation to prevent flashing
export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = memo(({ status }) => {
  return (
    <Box paddingLeft={1} marginY={1}>
      <Text color="yellow">●</Text>
      <Text color="gray"> {status || 'Thinking...'}</Text>
    </Box>
  );
});
