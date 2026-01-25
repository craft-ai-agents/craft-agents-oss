/**
 * Schema for config-defaults.json
 * This file contains the default values for all configuration options.
 */

import type { AuthType } from '@vesper/core/types';
import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

/**
 * Notification settings defaults
 */
export interface NotificationSettingsDefaults {
  enabled: boolean;
  sound: boolean;
  soundVolume: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  agentCompletion: boolean;
  agentError: boolean;
  schedulerRun: boolean;
  messageReceived: boolean;
}

export interface ConfigDefaults {
  version: string;
  description: string;
  defaults: {
    authType: AuthType;
    notificationsEnabled: boolean;
    agentationEnabled: boolean;
    colorTheme: string;
    notificationSettings: NotificationSettingsDefaults;
  };
  workspaceDefaults: {
    thinkingLevel: ThinkingLevel;
    permissionMode: PermissionMode;
    cyclablePermissionModes: PermissionMode[];
    localMcpServers: {
      enabled: boolean;
    };
  };
}

/**
 * Bundled defaults (shipped with the app)
 * This is the source of truth for default values.
 */
export const BUNDLED_CONFIG_DEFAULTS: ConfigDefaults = {
  version: '1.0',
  description: 'Default configuration values for Vesper',
  defaults: {
    authType: 'api_key',
    notificationsEnabled: true,
    agentationEnabled: false,
    colorTheme: 'default',
    notificationSettings: {
      enabled: true,
      sound: true,
      soundVolume: 80,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      agentCompletion: true,
      agentError: true,
      schedulerRun: true,
      messageReceived: true,
    },
  },
  workspaceDefaults: {
    thinkingLevel: 'think',
    permissionMode: 'safe', // NEW: was 'ask' before
    cyclablePermissionModes: ['safe', 'ask', 'allow-all', 'ralph'],
    localMcpServers: {
      enabled: true,
    },
  },
};
