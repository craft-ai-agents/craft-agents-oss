import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelDefinition } from '@craft-agent/shared/config';

export interface ModelSelectorProps {
  models: ModelDefinition[];
  currentModelId: string;
  onSelect: (modelId: string) => void;
  onCancel: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  currentModelId,
  onSelect,
  onCancel,
}) => {
  // Start with current model highlighted
  const currentIndex = models.findIndex((m) => m.id === currentModelId);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex >= 0 ? currentIndex : 0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : models.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < models.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const model = models[selectedIndex];
      if (model) {
        onSelect(model.id);
      }
    } else if (key.escape) {
      onCancel();
    } else if (input >= '1' && input <= String(models.length)) {
      // Number key selection
      const index = parseInt(input, 10) - 1;
      const model = models[index];
      if (model) {
        onSelect(model.id);
      }
    }
  });

  const currentName = models.find((m) => m.id === currentModelId)?.name || currentModelId;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text>
          <Text bold>Select Model</Text>
          <Text dimColor> (Current: {currentName})</Text>
        </Text>
      </Box>

      {models.map((model, index) => {
        const isCurrentModel = model.id === currentModelId;
        const isHighlighted = index === selectedIndex;

        return (
          <Box key={model.id}>
            <Text
              color={isHighlighted ? 'blue' : undefined}
              bold={isHighlighted}
              inverse={isHighlighted}
            >
              {' '}
              {isCurrentModel ? '●' : '○'} {index + 1}. {model.name}
              <Text dimColor={!isHighlighted}> - {model.description}</Text>
              {' '}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate | Enter select | Esc cancel | 1-{models.length} quick select
        </Text>
      </Box>
    </Box>
  );
};
