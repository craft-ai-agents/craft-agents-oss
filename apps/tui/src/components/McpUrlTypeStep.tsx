import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type McpUrlMethod = 'paste' | 'craft_auth';

export interface McpUrlTypeStepProps {
  onSelect: (method: McpUrlMethod) => void;
  onBack: () => void;
}

export const McpUrlTypeStep: React.FC<McpUrlTypeStepProps> = ({ onSelect, onBack }) => {
  const [selected, setSelected] = useState<number>(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(0);
    } else if (key.downArrow) {
      setSelected(1);
    } else if (key.return) {
      onSelect(selected === 0 ? 'paste' : 'craft_auth');
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Connect to Craft MCP Server</Text>
      <Box marginY={1}>
        <Text dimColor>How would you like to connect to your Craft space?</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text color={selected === 0 ? 'green' : undefined}>
            {selected === 0 ? '❯ ' : '  '}
          </Text>
          <Text color={selected === 0 ? 'green' : undefined} bold={selected === 0}>
            Paste MCP URL
          </Text>
          <Text dimColor> - Enter your workflow link manually</Text>
        </Box>
        <Box>
          <Text color={selected === 1 ? 'green' : undefined}>
            {selected === 1 ? '❯ ' : '  '}
          </Text>
          <Text color={selected === 1 ? 'green' : undefined} bold={selected === 1}>
            Authorize with Craft
          </Text>
          <Text dimColor> - Connect via browser authentication</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to select, Enter to confirm, Esc to go back</Text>
      </Box>
    </Box>
  );
};
