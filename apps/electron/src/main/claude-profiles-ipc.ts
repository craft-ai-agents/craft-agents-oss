/**
 * Claude Profiles IPC Handlers
 *
 * IPC handlers for Claude profile management, OAuth flow, usage monitoring,
 * and auto-switching configuration.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type {
  ClaudeProfile,
  ClaudeUsageData,
  ClaudeAutoSwitchSettings,
  ProfileScore,
  ProfileSwapEvent,
} from '@vesper/shared/claude-profiles';
import {
  // Storage
  ProfileStorageError,
  listProfiles,
  getProfile,
  getActiveProfile,
  getActiveProfileId,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  setActiveProfile,
  getAutoSwitchSettings,
  updateAutoSwitchSettings,
  // OAuth
  startProfileOAuth,
  completeProfileOAuth,
  refreshProfileToken,
  deleteProfileTokens,
  validateOAuthState,
  // Monitoring
  getUsageMonitor,
  // Switching
  getProfileSwitcher,
} from '@vesper/shared/claude-profiles';

/**
 * Broadcast profile event to all windows.
 */
function broadcastProfileEvent(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, data);
  });
}

/**
 * Register Claude profiles IPC handlers.
 */
export function registerClaudeProfilesIpc(): void {
  // ========================================
  // Profile CRUD
  // ========================================

  // List all profiles
  ipcMain.handle('claude-profiles:list', async (): Promise<ClaudeProfile[]> => {
    try {
      return await listProfiles();
    } catch (error) {
      console.error('[claude-profiles:list] Error:', error);
      throw error;
    }
  });

  // Get a single profile
  ipcMain.handle(
    'claude-profiles:get',
    async (_event, profileId: string): Promise<ClaudeProfile | null> => {
      try {
        return await getProfile(profileId);
      } catch (error) {
        console.error('[claude-profiles:get] Error:', error);
        throw error;
      }
    }
  );

  // Get active profile
  ipcMain.handle('claude-profiles:get-active', async (): Promise<ClaudeProfile | null> => {
    try {
      return await getActiveProfile();
    } catch (error) {
      console.error('[claude-profiles:get-active] Error:', error);
      throw error;
    }
  });

  // Get active profile ID
  ipcMain.handle('claude-profiles:get-active-id', async (): Promise<string | null> => {
    try {
      return await getActiveProfileId();
    } catch (error) {
      console.error('[claude-profiles:get-active-id] Error:', error);
      throw error;
    }
  });

  // Start OAuth flow (returns auth URL and state)
  ipcMain.handle(
    'claude-profiles:start-oauth',
    async (_event, profileName: string): Promise<{ authUrl: string; state: string }> => {
      try {
        return await startProfileOAuth(profileName);
      } catch (error) {
        console.error('[claude-profiles:start-oauth] Error:', error);
        throw error;
      }
    }
  );

  // Complete OAuth flow (validates state, exchanges code, creates profile)
  ipcMain.handle(
    'claude-profiles:complete-oauth',
    async (
      _event,
      authorizationCode: string,
      state: string
    ): Promise<ClaudeProfile> => {
      try {
        const profile = await completeProfileOAuth(authorizationCode, state);
        broadcastProfileEvent('claude-profiles:created', { profile });
        return profile;
      } catch (error) {
        console.error('[claude-profiles:complete-oauth] Error:', error);
        throw error;
      }
    }
  );

  // Validate OAuth state (for checking if state is still valid)
  ipcMain.handle(
    'claude-profiles:validate-oauth-state',
    async (_event, state: string): Promise<boolean> => {
      try {
        return validateOAuthState(state) !== null;
      } catch (error) {
        console.error('[claude-profiles:validate-oauth-state] Error:', error);
        throw error;
      }
    }
  );

  // Refresh token for a profile
  ipcMain.handle(
    'claude-profiles:refresh-token',
    async (_event, profileId: string): Promise<void> => {
      try {
        await refreshProfileToken(profileId);
        broadcastProfileEvent('claude-profiles:token-refreshed', { profileId });
      } catch (error) {
        console.error('[claude-profiles:refresh-token] Error:', error);
        throw error;
      }
    }
  );

  // Update profile (name only, other fields are internal)
  ipcMain.handle(
    'claude-profiles:update',
    async (
      _event,
      profileId: string,
      updates: { name?: string }
    ): Promise<ClaudeProfile> => {
      try {
        const profile = await updateProfile(profileId, updates);
        broadcastProfileEvent('claude-profiles:updated', { profile });
        return profile;
      } catch (error) {
        console.error('[claude-profiles:update] Error:', error);
        throw error;
      }
    }
  );

  // Delete profile
  ipcMain.handle(
    'claude-profiles:delete',
    async (_event, profileId: string): Promise<void> => {
      try {
        await deleteProfile(profileId);
        // Also delete OAuth tokens
        await deleteProfileTokens(profileId);
        broadcastProfileEvent('claude-profiles:deleted', { profileId });
      } catch (error) {
        // If profile not found, treat as success (idempotent delete)
        if (error instanceof ProfileStorageError && error.code === 'NOT_FOUND') {
          return;
        }
        console.error('[claude-profiles:delete] Error:', error);
        throw error;
      }
    }
  );

  // Set default profile
  ipcMain.handle(
    'claude-profiles:set-default',
    async (_event, profileId: string): Promise<void> => {
      try {
        await setDefaultProfile(profileId);
        broadcastProfileEvent('claude-profiles:default-changed', { profileId });
      } catch (error) {
        console.error('[claude-profiles:set-default] Error:', error);
        throw error;
      }
    }
  );

  // Set active profile
  ipcMain.handle(
    'claude-profiles:set-active',
    async (_event, profileId: string): Promise<void> => {
      try {
        await setActiveProfile(profileId);
        broadcastProfileEvent('claude-profiles:active-changed', { profileId });
      } catch (error) {
        console.error('[claude-profiles:set-active] Error:', error);
        throw error;
      }
    }
  );

  // ========================================
  // Usage Monitoring
  // ========================================

  // Get usage for a profile
  ipcMain.handle(
    'claude-profiles:get-usage',
    async (_event, profileId: string): Promise<ClaudeUsageData | null> => {
      try {
        const monitor = getUsageMonitor();
        return await monitor.getCachedUsage(profileId);
      } catch (error) {
        console.error('[claude-profiles:get-usage] Error:', error);
        throw error;
      }
    }
  );

  // Refresh usage for a profile
  ipcMain.handle(
    'claude-profiles:refresh-usage',
    async (_event, profileId: string): Promise<ClaudeUsageData | null> => {
      try {
        const monitor = getUsageMonitor();
        return await monitor.refreshProfile(profileId);
      } catch (error) {
        console.error('[claude-profiles:refresh-usage] Error:', error);
        throw error;
      }
    }
  );

  // Start monitoring
  ipcMain.handle('claude-profiles:start-monitoring', async (): Promise<void> => {
    try {
      const monitor = getUsageMonitor();

      // Set up event listeners for broadcasting to renderer
      monitor.removeAllListeners(); // Clear any existing listeners

      monitor.on('usage-updated', (profileId, usage) => {
        broadcastProfileEvent('claude-profiles:usage-updated', { profileId, usage });
      });

      monitor.on('profile-limited', (profileId, limitType) => {
        broadcastProfileEvent('claude-profiles:profile-limited', { profileId, limitType });
      });

      monitor.on('auth-failed', (profileId, error) => {
        broadcastProfileEvent('claude-profiles:auth-failed', {
          profileId,
          error: error.message,
        });
      });

      monitor.on('token-refreshed', (profileId) => {
        broadcastProfileEvent('claude-profiles:token-refreshed', { profileId });
      });

      monitor.start();
    } catch (error) {
      console.error('[claude-profiles:start-monitoring] Error:', error);
      throw error;
    }
  });

  // Stop monitoring
  ipcMain.handle('claude-profiles:stop-monitoring', async (): Promise<void> => {
    try {
      const monitor = getUsageMonitor();
      monitor.stop();
    } catch (error) {
      console.error('[claude-profiles:stop-monitoring] Error:', error);
      throw error;
    }
  });

  // Check if monitoring is active
  ipcMain.handle('claude-profiles:is-monitoring', async (): Promise<boolean> => {
    try {
      const monitor = getUsageMonitor();
      return monitor.isMonitoring();
    } catch (error) {
      console.error('[claude-profiles:is-monitoring] Error:', error);
      throw error;
    }
  });

  // ========================================
  // Auto-Switch Settings
  // ========================================

  // Get settings
  ipcMain.handle(
    'claude-profiles:get-settings',
    async (): Promise<ClaudeAutoSwitchSettings> => {
      try {
        return await getAutoSwitchSettings();
      } catch (error) {
        console.error('[claude-profiles:get-settings] Error:', error);
        throw error;
      }
    }
  );

  // Update settings
  ipcMain.handle(
    'claude-profiles:update-settings',
    async (
      _event,
      updates: Partial<ClaudeAutoSwitchSettings>
    ): Promise<ClaudeAutoSwitchSettings> => {
      try {
        const settings = await updateAutoSwitchSettings(updates);
        broadcastProfileEvent('claude-profiles:settings-changed', { settings });
        return settings;
      } catch (error) {
        console.error('[claude-profiles:update-settings] Error:', error);
        throw error;
      }
    }
  );

  // ========================================
  // Profile Switching
  // ========================================

  // Get scored profiles for UI
  ipcMain.handle(
    'claude-profiles:get-scored',
    async (): Promise<Array<{ profile: ClaudeProfile; score: ProfileScore }>> => {
      try {
        const switcher = getProfileSwitcher();
        return await switcher.getScoredProfiles();
      } catch (error) {
        console.error('[claude-profiles:get-scored] Error:', error);
        throw error;
      }
    }
  );

  // Check switch recommendation
  ipcMain.handle(
    'claude-profiles:check-switch',
    async (
      _event,
      sessionId?: string
    ): Promise<{
      recommended: boolean;
      reason: string;
      currentProfile: ClaudeProfile | null;
      bestAlternative: ClaudeProfile | null;
      currentScore: ProfileScore | null;
      alternativeScore: ProfileScore | null;
    }> => {
      try {
        const switcher = getProfileSwitcher();
        return await switcher.checkSwitchRecommendation(sessionId);
      } catch (error) {
        console.error('[claude-profiles:check-switch] Error:', error);
        throw error;
      }
    }
  );

  // Execute manual swap
  ipcMain.handle(
    'claude-profiles:manual-swap',
    async (
      _event,
      toProfileId: string,
      sessionId?: string
    ): Promise<ProfileSwapEvent> => {
      try {
        const switcher = getProfileSwitcher();
        const event = await switcher.executeSwap(toProfileId, 'manual', sessionId);
        broadcastProfileEvent('claude-profiles:swapped', { event });
        return event;
      } catch (error) {
        console.error('[claude-profiles:manual-swap] Error:', error);
        throw error;
      }
    }
  );

  // Get session swap count
  ipcMain.handle(
    'claude-profiles:get-swap-count',
    async (_event, sessionId: string): Promise<number> => {
      try {
        const switcher = getProfileSwitcher();
        return switcher.getSessionSwapCount(sessionId);
      } catch (error) {
        console.error('[claude-profiles:get-swap-count] Error:', error);
        throw error;
      }
    }
  );

  // Reset session swap count (after manual selection)
  ipcMain.handle(
    'claude-profiles:reset-swap-count',
    async (_event, sessionId: string): Promise<void> => {
      try {
        const switcher = getProfileSwitcher();
        switcher.resetSessionSwapCount(sessionId);
      } catch (error) {
        console.error('[claude-profiles:reset-swap-count] Error:', error);
        throw error;
      }
    }
  );

  // ========================================
  // Session Profile Management
  // ========================================

  // Set profile for a specific session (manual override)
  ipcMain.handle(
    'claude-profiles:set-session-profile',
    async (_event, sessionId: string, profileId: string): Promise<void> => {
      try {
        // Set as active and reset swap count
        await setActiveProfile(profileId);

        const switcher = getProfileSwitcher();
        switcher.resetSessionSwapCount(sessionId);

        broadcastProfileEvent('claude-profiles:session-profile-set', {
          sessionId,
          profileId,
        });
      } catch (error) {
        console.error('[claude-profiles:set-session-profile] Error:', error);
        throw error;
      }
    }
  );

  // Set up switcher event listeners
  const switcher = getProfileSwitcher();

  switcher.on('profile-swapped', (event: ProfileSwapEvent) => {
    broadcastProfileEvent('claude-profiles:swapped', { event });
  });

  switcher.on('manual-required', (reason: string) => {
    broadcastProfileEvent('claude-profiles:manual-required', { reason });
  });

  switcher.on('threshold-reached', (profileId: string, usageType: string, usage: number) => {
    broadcastProfileEvent('claude-profiles:threshold-reached', {
      profileId,
      usageType,
      usage,
    });
  });

  switcher.on('swap-rejected', (reason: string) => {
    broadcastProfileEvent('claude-profiles:swap-rejected', { reason });
  });
}
