/**
 * Account Manager Tests
 *
 * Tests for multi-account architecture support
 */

import { describe, it, expect } from 'bun:test';
import {
  getDefaultAccountConfig,
  getAccountById,
  getEnabledAccounts,
  ensureDefaultAccount,
} from './account-manager';
import type { WorkspaceConfig } from '../workspaces/types';

describe('Account Manager', () => {
  describe('getDefaultAccountConfig', () => {
    it('should return default account configuration', () => {
      const config = getDefaultAccountConfig();
      expect(config.id).toBe('default');
      expect(config.enabled).toBe(true);
      expect(config.tokenSource).toBe('config');
      expect(config.config.debounceMs).toBe(1500);
      expect(config.config.requireMention).toBe(false);
    });
  });

  describe('getAccountById', () => {
    it('should return null if no accounts configured', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const account = getAccountById(workspaceConfig, 'default');
      expect(account).toBe(null);
    });

    it('should return account if exists', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        telegramAccounts: {
          default: {
            id: 'default',
            enabled: true,
            tokenSource: 'config',
            config: {},
          },
        },
      };
      const account = getAccountById(workspaceConfig, 'default');
      expect(account).not.toBe(null);
      expect(account?.id).toBe('default');
    });

    it('should return null if account does not exist', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        telegramAccounts: {
          default: {
            id: 'default',
            enabled: true,
            tokenSource: 'config',
            config: {},
          },
        },
      };
      const account = getAccountById(workspaceConfig, 'non-existent');
      expect(account).toBe(null);
    });
  });

  describe('getEnabledAccounts', () => {
    it('should return empty array if no accounts configured', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const accounts = getEnabledAccounts(workspaceConfig);
      expect(accounts).toEqual([]);
    });

    it('should return only enabled accounts', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        telegramAccounts: {
          default: {
            id: 'default',
            enabled: true,
            tokenSource: 'config',
            config: {},
          },
          'support-bot': {
            id: 'support-bot',
            enabled: false,
            tokenSource: 'config',
            config: {},
          },
          'alerts-bot': {
            id: 'alerts-bot',
            enabled: true,
            tokenSource: 'config',
            config: {},
          },
        },
      };
      const accounts = getEnabledAccounts(workspaceConfig);
      expect(accounts.length).toBe(2);
      expect(accounts.map(a => a.id).sort()).toEqual(['alerts-bot', 'default']);
    });
  });

  describe('ensureDefaultAccount', () => {
    it('should add default account if none exist', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = ensureDefaultAccount(workspaceConfig);
      expect(updated.telegramAccounts).toBeDefined();
      expect(updated.telegramAccounts?.default).toBeDefined();
      if (updated.telegramAccounts?.default) {
        expect(updated.telegramAccounts.default.id).toBe('default');
      }
    });

    it('should not modify existing accounts', () => {
      const workspaceConfig: WorkspaceConfig = {
        id: 'test-ws',
        name: 'Test Workspace',
        slug: 'test-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        telegramAccounts: {
          'custom-bot': {
            id: 'custom-bot',
            enabled: true,
            tokenSource: 'config',
            config: {},
          },
        },
      };
      const updated = ensureDefaultAccount(workspaceConfig);
      expect(updated.telegramAccounts).toBeDefined();
      expect(updated.telegramAccounts?.['custom-bot']).toBeDefined();
      // Should not add default if accounts already exist
      expect(Object.keys(updated.telegramAccounts || {}).length).toBe(1);
    });
  });
});
