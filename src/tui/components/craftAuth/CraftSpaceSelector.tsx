
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CraftApi } from '../../../clients/craftApi';

export interface CraftSpaceSelectorProps {
  token: string;
  onComplete: (spaceId: string) => void;
  onBack: () => void;
}

interface Space {
  id: string;
  name: string;
}

const MCP_LINK_NAME = 'Craft TUI MCP';

export const CraftSpaceSelector: React.FC<CraftSpaceSelectorProps> = ({ token, onComplete, onBack }) => {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selected, setSelected] = useState<number>(0);
  const [loading, setLoading] = useState<string | null>("Loading spaces");

  useEffect(() => {
    (async () => {
      const craftApi = new CraftApi('https://api.craft.do');
      const profile = await craftApi.getProfile(token);
      setSpaces(profile.spaces);
      setLoading(null);
    })();
  }, [token]);

  useInput((input, key) => {
    if (loading || spaces.length === 0) return;

    if (key.upArrow) {
      setSelected((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.downArrow) {
      setSelected((prev) => (prev < spaces.length - 1 ? prev + 1 : prev));
    } else if (key.return) {
      const selectedSpace = spaces[selected];
      if (selectedSpace) {
        selectSpace(selectedSpace.id);
      }
    } else if (key.escape) {
      onBack();
    }
  });

  const selectSpace = async (spaceId: string) => {
    const craftApi = new CraftApi('https://api.craft.do');
    setLoading("Loading MCP URL");
    const workflowLinks = await craftApi.getWorkflowLinks({ authToken: token, spaceId });
    console.log(workflowLinks);
    const spaceWorkflowLink = workflowLinks.find(link => link.type === 'mcp' && link.scope === 'fullSpace' && link.enabled && link.name === MCP_LINK_NAME);
    if (spaceWorkflowLink?.urls?.mcp != null) {
      setLoading(null);
      onComplete(spaceWorkflowLink.urls.mcp);
    } else {
      const link = await craftApi.createSpaceWorkflowLink({ authToken: token, spaceId, name: 'Craft TUI MCP', type: 'mcp', scope: 'fullSpace' });
      if (link.urls?.mcp != null) {
        setLoading(null);
        onComplete(link.urls.mcp);
      } else {
        setLoading(null);
        throw new Error('Failed to create MCP link');
      }
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold>Select a Craft Space</Text>
      <Box marginY={1}>
        <Text dimColor>Choose the workspace to connect:</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        {loading ? (
          <Text dimColor>{loading}</Text>
        ) : spaces.length === 0 ? (
          <Text dimColor>No spaces found</Text>
        ) : (
          spaces.map((space, index) => (
            <Box key={space.id}>
              <Text color={selected === index ? 'green' : undefined}>
                {selected === index ? '❯ ' : '  '}
              </Text>
              <Text color={selected === index ? 'green' : undefined} bold={selected === index}>
                {space.name}
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to select, Enter to confirm, Esc to go back</Text>
      </Box>
    </Box>
  );
};