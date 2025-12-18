import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AuthType, TokenDisplayMode } from '@craft-agent/shared/config';

export type SettingsAction =
  | { type: 'set_verbose'; verbose: boolean }
  | { type: 'change_auth_mode'; mode: AuthType }
  | { type: 'set_token_display'; mode: TokenDisplayMode }
  | { type: 'set_show_cost'; show: boolean };

interface MenuItem {
  key: string;
  label: string;
  desc: string;
  action: SettingsAction | null;
  disabled?: boolean;
  isCurrent?: boolean;
  isHeader?: boolean;
}

export interface SettingsProps {
  compactMode: boolean;
  currentAuthType: AuthType;
  tokenDisplay: TokenDisplayMode;
  showCost: boolean;
  onAction: (action: SettingsAction) => void;
  onCancel: () => void;
}

const AUTH_MODE_LABELS: Record<AuthType, string> = {
  'craft_credits': 'Craft Credits',
  'api_key': 'API Key',
  'oauth_token': 'Claude Max',
};

export const Settings: React.FC<SettingsProps> = ({
  compactMode,
  currentAuthType,
  tokenDisplay,
  showCost,
  onAction,
  onCancel,
}) => {
  const menuItems: MenuItem[] = [
    // Tool Output section
    {
      key: 'tool_output_header',
      label: '── Tool Output ──',
      desc: '',
      action: null,
      isHeader: true,
    },
    {
      key: 'compact',
      label: 'Compact',
      desc: 'Show minimal tool output',
      action: compactMode ? null : { type: 'set_verbose', verbose: false },
      isCurrent: compactMode,
    },
    {
      key: 'verbose',
      label: 'Verbose',
      desc: 'Show detailed tool output',
      action: compactMode ? { type: 'set_verbose', verbose: true } : null,
      isCurrent: !compactMode,
    },
    // Token Usage section
    {
      key: 'token_header',
      label: '── Token Usage ──',
      desc: '',
      action: null,
      isHeader: true,
    },
    {
      key: 'token_hidden',
      label: 'Hidden',
      desc: 'Don\'t show token usage',
      action: tokenDisplay === 'hidden' ? null : { type: 'set_token_display', mode: 'hidden' },
      isCurrent: tokenDisplay === 'hidden',
    },
    {
      key: 'token_total',
      label: 'Total',
      desc: 'Show combined total',
      action: tokenDisplay === 'total' ? null : { type: 'set_token_display', mode: 'total' },
      isCurrent: tokenDisplay === 'total',
    },
    {
      key: 'token_separate',
      label: 'Input / Output',
      desc: 'Show in/out separately',
      action: tokenDisplay === 'separate' ? null : { type: 'set_token_display', mode: 'separate' },
      isCurrent: tokenDisplay === 'separate',
    },
    // Session Cost section (only for API Key users)
    ...(currentAuthType === 'api_key' ? [
      {
        key: 'cost_header',
        label: '── Session Cost ──',
        desc: '',
        action: null,
        isHeader: true,
      },
      {
        key: 'cost_show',
        label: 'Show',
        desc: 'Display cost in status bar',
        action: showCost ? null : { type: 'set_show_cost', show: true },
        isCurrent: showCost,
      },
      {
        key: 'cost_hide',
        label: 'Hide',
        desc: 'Hide cost from status bar',
        action: showCost ? { type: 'set_show_cost', show: false } : null,
        isCurrent: !showCost,
      },
    ] as MenuItem[] : []),
    // AI Usage Mode section
    {
      key: 'ai_header',
      label: '── AI Usage Mode ──',
      desc: '',
      action: null,
      isHeader: true,
    },
    {
      key: 'craft_credits',
      label: 'Craft Credits',
      desc: 'Use Craft AI credits',
      action: currentAuthType === 'craft_credits' ? null : { type: 'change_auth_mode', mode: 'craft_credits' },
      isCurrent: currentAuthType === 'craft_credits',
    },
    {
      key: 'api_key',
      label: 'API Key',
      desc: 'Use your Anthropic API key',
      action: currentAuthType === 'api_key' ? null : { type: 'change_auth_mode', mode: 'api_key' },
      isCurrent: currentAuthType === 'api_key',
    },
    {
      key: 'oauth_token',
      label: 'Claude Max',
      desc: 'Use Claude Max subscription',
      action: currentAuthType === 'oauth_token' ? null : { type: 'change_auth_mode', mode: 'oauth_token' },
      isCurrent: currentAuthType === 'oauth_token',
    },
  ];

  // Filter out headers for navigation but keep for display
  const navigableItems = menuItems.filter(item => !item.isHeader);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : navigableItems.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < navigableItems.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = navigableItems[selectedIndex];
      if (item?.action && !item.disabled) {
        onAction(item.action);
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  // Map navigable index back to display
  const selectedKey = navigableItems[selectedIndex]?.key;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Settings</Text>
      </Box>

      {menuItems.map((item) => {
        if (item.isHeader) {
          return (
            <Box key={item.key} marginTop={1}>
              <Text dimColor>{item.label}</Text>
            </Box>
          );
        }

        const isHighlighted = item.key === selectedKey;
        const isDisabled = item.disabled;
        const isCurrent = item.isCurrent;

        return (
          <Box key={item.key}>
            <Text
              color={isDisabled ? undefined : isHighlighted ? 'blue' : undefined}
              bold={isHighlighted && !isDisabled}
              inverse={isHighlighted && !isDisabled}
              dimColor={isDisabled}
            >
              {' '}
              {isCurrent ? '●' : '○'} {item.label}
              <Text dimColor={!isHighlighted || isDisabled}> - {item.desc}</Text>
              {' '}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate | Enter select | Esc close
        </Text>
      </Box>
    </Box>
  );
};
