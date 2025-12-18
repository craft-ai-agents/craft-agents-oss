import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Plan } from '@craft-agent/shared/agents';

export type PlanAction =
  | { type: 'start' }
  | { type: 'plans' }  // Unified list/load/delete view
  | { type: 'view' }
  | { type: 'approve' }
  | { type: 'cancel' };

export interface PlanMenuProps {
  activePlan: Plan | null;
  onAction: (action: PlanAction) => void;
  onCancel: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  desc: string;
  action: PlanAction;
}

export const PlanMenu: React.FC<PlanMenuProps> = ({
  activePlan,
  onAction,
  onCancel,
}) => {
  // Build menu items based on whether a plan is active (memoized)
  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];

    if (activePlan) {
      // Plan is active - show plan-specific actions
      items.push({
        key: 'view',
        label: 'View Plan',
        desc: `View current plan: ${activePlan.title}`,
        action: { type: 'view' },
      });

      if (activePlan.state === 'creating' || activePlan.state === 'refining' || activePlan.state === 'ready') {
        items.push({
          key: 'approve',
          label: 'Approve & Execute',
          desc: 'Approve the plan and start execution',
          action: { type: 'approve' },
        });
      }

      items.push({
        key: 'cancel',
        label: 'Cancel Plan',
        desc: 'Discard current plan',
        action: { type: 'cancel' },
      });
    } else {
      // No active plan - show start and plans options
      items.push({
        key: 'start',
        label: 'Start New Plan',
        desc: 'Enter planning mode for a complex task',
        action: { type: 'start' },
      });
      items.push({
        key: 'plans',
        label: 'Saved Plans',
        desc: 'View, load, or delete saved plans',
        action: { type: 'plans' },
      });
    }

    return items;
  }, [activePlan]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : menuItems.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < menuItems.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = menuItems[selectedIndex];
      if (item) {
        onAction(item.action);
      }
    } else if (key.escape) {
      onCancel();
    }
    // Quick keys (using toLowerCase for consistency)
    const lowerInput = input.toLowerCase();
    if (lowerInput === 's') {
      const startItem = menuItems.find(m => m.key === 'start');
      if (startItem) onAction(startItem.action);
    } else if (lowerInput === 'p') {
      // 'p' for plans
      const item = menuItems.find(m => m.key === 'plans');
      if (item) onAction(item.action);
    } else if (lowerInput === 'v') {
      const viewItem = menuItems.find(m => m.key === 'view');
      if (viewItem) onAction(viewItem.action);
    } else if (lowerInput === 'a') {
      const approveItem = menuItems.find(m => m.key === 'approve');
      if (approveItem) onAction(approveItem.action);
    } else if (lowerInput === 'c') {
      const cancelItem = menuItems.find(m => m.key === 'cancel');
      if (cancelItem) onAction(cancelItem.action);
    }
  });

  // Get state badge color
  const getStateColor = (state: Plan['state']): string => {
    switch (state) {
      case 'creating':
        return 'blue';
      case 'refining':
        return 'yellow';
      case 'ready':
        return 'green';
      case 'executing':
        return 'cyan';
      case 'completed':
        return 'green';
      case 'cancelled':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Plan Menu</Text>
        {activePlan && (
          <>
            <Text dimColor> - </Text>
            <Text color={getStateColor(activePlan.state)}>
              [{activePlan.state}]
            </Text>
            <Text dimColor> {activePlan.title}</Text>
          </>
        )}
      </Box>

      {/* Menu items */}
      {menuItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={item.key}>
            <Text
              color={isSelected ? 'cyan' : undefined}
              bold={isSelected}
              inverse={isSelected}
            >
              {isSelected ? '> ' : '  '}
              {item.label}
            </Text>
            <Text dimColor> - {item.desc}</Text>
          </Box>
        );
      })}

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          up/down navigate | Enter select | Esc close
        </Text>
      </Box>
    </Box>
  );
};
