import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PlanFile {
  name: string;
  path: string;
  modifiedAt: number;
}

export interface PlanSelectorProps {
  plans: PlanFile[];
  onSelect: (plan: PlanFile) => void;
  onDelete: (plans: PlanFile[]) => void;
  onCancel: () => void;
}

/** Format date for display */
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Clean plan name for display (remove ==PLAN== prefix and timestamp suffix) */
const cleanPlanName = (name: string): string => {
  return name
    .replace(/^==PLAN==\s*/, '')
    .replace(/\s*\(\d{8}-\d{6}\)$/, '')
    .trim();
};

export const PlanSelector: React.FC<PlanSelectorProps> = ({
  plans,
  onSelect,
  onDelete,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const hasSelections = selectedForDelete.size > 0;

  const handleDelete = useCallback(() => {
    if (selectedForDelete.size === 0) return;

    const plansToDelete = Array.from(selectedForDelete)
      .map(idx => plans[idx])
      .filter((p): p is PlanFile => p !== undefined);

    onDelete(plansToDelete);
  }, [selectedForDelete, plans, onDelete]);

  const toggleSelection = useCallback((index: number) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  useInput((input, key) => {
    // Handle delete confirmation
    if (confirmingDelete) {
      if (input.toLowerCase() === 'y') {
        handleDelete();
        return;
      }
      if (input.toLowerCase() === 'n' || key.escape) {
        setConfirmingDelete(false);
        return;
      }
      return;
    }

    // Skip navigation if no plans
    if (plans.length === 0) {
      if (key.escape) onCancel();
      return;
    }

    // Navigation
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : plans.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < plans.length - 1 ? prev + 1 : 0));
    }
    // Enter to load
    else if (key.return) {
      const plan = plans[selectedIndex];
      if (plan) {
        onSelect(plan);
      }
    }
    // Space to toggle selection for delete
    else if (input === ' ') {
      toggleSelection(selectedIndex);
    }
    // D/d to delete selected
    else if (input.toLowerCase() === 'd' && hasSelections) {
      setConfirmingDelete(true);
    }
    // Escape to cancel
    else if (key.escape) {
      if (hasSelections) {
        // Clear selections first
        setSelectedForDelete(new Set());
      } else {
        onCancel();
      }
    }
    // Number keys for quick load
    else if (input >= '1' && input <= '9') {
      const index = parseInt(input, 10) - 1;
      const plan = plans[index];
      if (plan) {
        onSelect(plan);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Plans</Text>
        {hasSelections && (
          <Text color="yellow"> ({selectedForDelete.size} selected)</Text>
        )}
      </Box>

      {plans.length === 0 ? (
        <Box>
          <Text dimColor>No saved plans. Use '/plan start' to create one.</Text>
        </Box>
      ) : confirmingDelete ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="red" bold>Delete {selectedForDelete.size} plan{selectedForDelete.size > 1 ? 's' : ''}?</Text>
          </Box>
          {Array.from(selectedForDelete).map(idx => {
            const plan = plans[idx];
            if (!plan) return null;
            return (
              <Box key={plan.path} marginLeft={1}>
                <Text color="red">• {cleanPlanName(plan.name)}</Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text color="green" bold>[Y]</Text>
            <Text>es </Text>
            <Text color="red" bold>[N]</Text>
            <Text>o</Text>
          </Box>
        </Box>
      ) : (
        plans.map((plan, index) => {
          const isFocused = index === selectedIndex;
          const isMarkedForDelete = selectedForDelete.has(index);
          const displayName = cleanPlanName(plan.name);

          return (
            <Box key={plan.path}>
              <Text
                color={isMarkedForDelete ? 'red' : (isFocused ? 'cyan' : undefined)}
                bold={isFocused}
                inverse={isFocused}
              >
                {' '}
                {isMarkedForDelete ? '[×]' : '   '}
                {' '}
                {index + 1}. {displayName}
                {' '}
              </Text>
              <Text dimColor> {formatDate(plan.modifiedAt)}</Text>
            </Box>
          );
        })
      )}

      {!confirmingDelete && (
        <Box marginTop={1}>
          <Text dimColor>
            {plans.length > 0
              ? `↑↓ nav | Enter load | Space select | ${hasSelections ? 'D delete | ' : ''}Esc ${hasSelections ? 'clear' : 'close'}`
              : 'Esc close'}
          </Text>
        </Box>
      )}
    </Box>
  );
};
