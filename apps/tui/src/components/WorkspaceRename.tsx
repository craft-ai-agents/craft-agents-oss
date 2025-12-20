import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from './TextInput.tsx';

export interface WorkspaceRenameProps {
  currentName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

export const WorkspaceRename: React.FC<WorkspaceRenameProps> = ({
  currentName,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(currentName);

  const handleSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }, [onSubmit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Rename Space</Text>
      </Box>

      <Box>
        <Text>New name: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          onCancel={onCancel}
          placeholder="Enter a name"
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter confirm | Esc cancel | ←→ navigate | Ctrl+U clear
        </Text>
      </Box>
    </Box>
  );
};
