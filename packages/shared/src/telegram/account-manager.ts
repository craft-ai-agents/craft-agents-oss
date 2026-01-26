/**
 * Telegram Account Management
 *
 * Utilities for managing multiple Telegram bot accounts per workspace,
 * including token resolution and account configuration.
 */

import type { TelegramAccountConfig } from './types.ts';
import type { WorkspaceConfig } from '../workspaces/types.ts';
import type { CredentialManager } from '../credentials/index.ts';

/**
 * Token resolution priority:
 * 1. Account-specific tokenFile (if tokenSource is 'tokenFile')
 * 2. Account-specific token in credentials (if tokenSource is 'config')
 *    - Stored at: telegram_bot_token:{workspaceId}:{accountId}
 * 3. Legacy global token (backward compatibility for "default" account)
 *    - Stored at: telegram_bot_token:{workspaceId}:default
 * 4. Environment variable TELEGRAM_BOT_TOKEN (for "default" account only)
 *    - Used in development/CI environments
 */
export async function resolveAccountToken(
  workspaceId: string,
  accountId: string,
  account: TelegramAccountConfig,
  credentialManager: CredentialManager
): Promise<string | null> {
  // 1. Account-specific tokenFile
  if (account.tokenSource === 'tokenFile') {
    // TODO: Implement tokenFile reading in Phase 2
    // For now, fall through to other sources
  }

  // 2. Account-specific token in credentials (encrypted storage)
  if (account.tokenSource === 'config') {
    const token = await credentialManager.getTelegramBotToken(workspaceId, accountId);
    if (token) return token;
  }

  // 3. Legacy global token (backward compatibility for "default" account)
  if (accountId === 'default') {
    const legacyToken = await credentialManager.getTelegramBotToken(workspaceId);
    if (legacyToken) return legacyToken;
  }

  // 4. Environment variable (default account only)
  if (accountId === 'default' && account.tokenSource === 'env') {
    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    if (envToken) return envToken;
  }

  return null;
}

/**
 * Get all enabled accounts for a workspace.
 * Returns account configurations from workspace config.
 */
export function getEnabledAccounts(workspaceConfig: WorkspaceConfig): TelegramAccountConfig[] {
  if (!workspaceConfig.telegramAccounts) {
    return [];
  }

  return Object.values(workspaceConfig.telegramAccounts).filter(
    (account) => account.enabled
  );
}

/**
 * Get a specific account by ID from workspace config.
 */
export function getAccountById(
  workspaceConfig: WorkspaceConfig,
  accountId: string
): TelegramAccountConfig | null {
  if (!workspaceConfig.telegramAccounts) {
    return null;
  }

  return workspaceConfig.telegramAccounts[accountId] || null;
}

/**
 * Create default account configuration for backward compatibility.
 * This ensures existing single-account setups continue to work.
 */
export function getDefaultAccountConfig(): TelegramAccountConfig {
  return {
    id: 'default',
    enabled: true,
    name: 'Default Bot',
    tokenSource: 'config',
    config: {
      debounceMs: 1500,
      requireMention: false,
    },
  };
}

/**
 * Migrate legacy single-account setup to multi-account architecture.
 * This is called when a workspace has no telegramAccounts but has a legacy token.
 */
export function ensureDefaultAccount(
  workspaceConfig: WorkspaceConfig
): WorkspaceConfig {
  if (!workspaceConfig.telegramAccounts) {
    workspaceConfig.telegramAccounts = {
      default: getDefaultAccountConfig(),
    };
  }

  return workspaceConfig;
}
