import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionMetadata } from '@craft-agent/shared/config';

export interface SessionMenuProps {
  sessions: SessionMetadata[];
  currentSessionId: string;
  onSelect: (session: SessionMetadata) => void;
  onCancel: () => void;
}

const formatLastActive = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
};

const truncatePreview = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
};

export const SessionMenu: React.FC<SessionMenuProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    // Navigation
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : sessions.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < sessions.length - 1 ? prev + 1 : 0));
    }
    // Enter to resume
    else if (key.return) {
      const session = sessions[selectedIndex];
      if (session && session.id !== currentSessionId) {
        onSelect(session);
      }
    }
    // Number keys for quick select
    else if (input >= '1' && input <= '9') {
      const index = parseInt(input, 10) - 1;
      const session = sessions[index];
      if (session && session.id !== currentSessionId) {
        onSelect(session);
      }
    }
    // Escape to close
    else if (key.escape) {
      onCancel();
    }
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Sessions</Text>
        </Box>
        <Text dimColor>No sessions found.</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Sessions</Text>
      </Box>

      {sessions.map((session, index) => {
        const isFocused = index === selectedIndex;
        const isCurrent = session.id === currentSessionId;
        const preview = session.preview || '[empty session]';

        return (
          <Box key={session.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text
                color={isFocused ? 'cyan' : undefined}
                bold={isFocused}
                inverse={isFocused}
              >
                {' '}{index + 1}.{' '}
              </Text>
              <Text color={isCurrent ? 'green' : (isFocused ? 'cyan' : undefined)} bold={isFocused}>
                {truncatePreview(preview, 60)}
              </Text>
              {isCurrent && <Text color="green"> (current)</Text>}
            </Box>
            <Box marginLeft={4}>
              <Text dimColor>
                {session.messageCount} messages · {formatLastActive(session.lastUsedAt)}
                {session.planCount ? ` · ${session.planCount} plan${session.planCount > 1 ? 's' : ''}` : ''}
                {session.agents && session.agents.length > 0 ? ` · @${session.agents.join(', @')}` : ''}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate | Enter resume | Esc close</Text>
      </Box>
    </Box>
  );
};
