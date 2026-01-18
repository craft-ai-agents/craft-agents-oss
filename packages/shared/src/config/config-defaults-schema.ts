/**
 * Schema for config-defaults.json
 * This file contains the default values for all configuration options.
 */

import type { AuthType } from '@craft-agent/core/types';
import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

export interface ConfigDefaults {
  version: string;
  description: string;
  defaults: {
    authType: AuthType;
    notificationsEnabled: boolean;
    colorTheme: string;
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
  description: 'Default configuration values for Craft Agent',
  defaults: {
    authType: 'api_key',
    notificationsEnabled: true,
    colorTheme: 'default',
  },
  workspaceDefaults: {
    thinkingLevel: 'think',
    permissionMode: 'safe', // NEW: was 'ask' before
    cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
    localMcpServers: {
      enabled: true,
    },
  },
};
