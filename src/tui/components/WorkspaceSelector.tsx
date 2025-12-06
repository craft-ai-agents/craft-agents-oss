import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Workspace } from '../../config/storage.ts';

export interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onCancel: () => void;
  onAdd: () => void;
  onRename: (workspaceId: string) => void;
  onRemove: (workspaceId: string) => void;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  workspaces,
  currentWorkspaceId,
  onSelect,
  onCancel,
  onAdd,
  onRename,
  onRemove,
}) => {
  // Start with current workspace highlighted, +1 for "Add new" option
  const currentIndex = workspaces.findIndex((w) => w.id === currentWorkspaceId);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  // Total options = workspaces + "Add new" option
  const totalOptions = workspaces.length + 1;

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
    } else if (key.return) {
      if (selectedIndex === workspaces.length) {
        // "Add new" option selected
        onAdd();
      } else {
        const workspace = workspaces[selectedIndex];
        if (workspace) {
          onSelect(workspace.id);
        }
      }
    } else if (key.escape) {
      onCancel();
    } else if (input >= '1' && input <= String(workspaces.length)) {
      // Number key selection (only for existing workspaces)
      const index = parseInt(input, 10) - 1;
      const workspace = workspaces[index];
      if (workspace) {
        onSelect(workspace.id);
      }
    } else if (input.toLowerCase() === 'a') {
      // 'a' shortcut to add new workspace
      onAdd();
    } else if (input.toLowerCase() === 'r') {
      // 'r' shortcut to rename selected workspace (not "Add new" option)
      if (selectedIndex < workspaces.length) {
        const workspace = workspaces[selectedIndex];
        if (workspace) {
          onRename(workspace.id);
        }
      }
    } else if (input.toLowerCase() === 'd') {
      // 'd' shortcut to remove selected workspace (not "Add new" option)
      if (selectedIndex < workspaces.length) {
        const workspace = workspaces[selectedIndex];
        if (workspace) {
          onRemove(workspace.id);
        }
      }
    }
  });

  const currentName = workspaces.find((w) => w.id === currentWorkspaceId)?.name || 'None';

  // Extract domain from MCP URL for display
  const getUrlDisplay = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.split('/').filter(Boolean);
      if (path.length >= 2 && path[0] === 'links') {
        return path[1]?.substring(0, 8) || urlObj.hostname;
      }
      return urlObj.hostname;
    } catch {
      return url.substring(0, 20);
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text>
          <Text bold>Select Workspace</Text>
          <Text dimColor> (Current: {currentName})</Text>
        </Text>
      </Box>

      {workspaces.map((workspace, index) => {
        const isCurrentWorkspace = workspace.id === currentWorkspaceId;
        const isHighlighted = index === selectedIndex;

        return (
          <Box key={workspace.id}>
            <Text
              color={isHighlighted ? 'blue' : undefined}
              bold={isHighlighted}
              inverse={isHighlighted}
            >
              {' '}
              {isCurrentWorkspace ? '●' : '○'} {index + 1}. {workspace.name}
              <Text dimColor={!isHighlighted}> - {getUrlDisplay(workspace.mcpUrl)}</Text>
              {' '}
            </Text>
          </Box>
        );
      })}

      {/* Add new workspace option */}
      <Box>
        <Text
          color={selectedIndex === workspaces.length ? 'green' : undefined}
          bold={selectedIndex === workspaces.length}
          inverse={selectedIndex === workspaces.length}
        >
          {' '}
          + Add new workspace
          {' '}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter select | Esc cancel | 1-{workspaces.length} quick | 'a' add | 'r' rename | 'd' remove
        </Text>
      </Box>
    </Box>
  );
};
