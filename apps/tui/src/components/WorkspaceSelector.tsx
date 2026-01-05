import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Workspace } from '@craft-agent/shared/config';

export interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onCancel: () => void;
  onRename: (workspaceId: string) => void;
  onRemove: (workspaceId: string) => void;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  workspaces,
  currentWorkspaceId,
  onSelect,
  onCancel,
  onRename,
  onRemove,
}) => {
  // Start with current workspace highlighted
  const currentIndex = workspaces.findIndex((w) => w.id === currentWorkspaceId);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : workspaces.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < workspaces.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const workspace = workspaces[selectedIndex];
      if (workspace) {
        onSelect(workspace.id);
      }
    } else if (key.escape) {
      onCancel();
    } else if (input >= '1' && input <= String(workspaces.length)) {
      // Number key selection
      const index = parseInt(input, 10) - 1;
      const workspace = workspaces[index];
      if (workspace) {
        onSelect(workspace.id);
      }
    } else if (input.toLowerCase() === 'r') {
      // 'r' shortcut to rename selected workspace
      const workspace = workspaces[selectedIndex];
      if (workspace) {
        onRename(workspace.id);
      }
    } else if (input.toLowerCase() === 'd') {
      // 'd' shortcut to remove selected workspace
      const workspace = workspaces[selectedIndex];
      if (workspace) {
        onRemove(workspace.id);
      }
    }
  });

  const currentName = workspaces.find((w) => w.id === currentWorkspaceId)?.name || 'None';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text>
          <Text bold>Select Space</Text>
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
              {' '}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          {['Enter select', 'Esc cancel', ...(workspaces.length > 1 ? [`1-${workspaces.length} quick select`] : []), 'r rename', 'd remove'].join(' | ')}
        </Text>
      </Box>
    </Box>
  );
};
