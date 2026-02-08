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
    /** Default API base URL for new installations */
    anthropicBaseUrl?: string;
    /** Default model for new installations */
    customModel?: string;
    autoCapitalisation: boolean;
    sendMessageKey: 'enter' | 'cmd-enter';
    spellCheck: boolean;
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
 * Built-in IDEA (ByteDance) API configuration
 * Used as default provider for new installations
 */
export const IDEA_BASE_URL = 'https://idea.bytedance.net/llm_middleware';
export const IDEA_API_KEY = 'sk-abcxxx';
export const IDEA_DEFAULT_MODEL = 'gemini-3-flash-priority';

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
    colorTheme: 'xcode',
    anthropicBaseUrl: IDEA_BASE_URL,
    customModel: IDEA_DEFAULT_MODEL,
    autoCapitalisation: false,
    sendMessageKey: 'enter',
    spellCheck: false,
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
