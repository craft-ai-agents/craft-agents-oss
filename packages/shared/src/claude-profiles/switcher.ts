/**
 * Claude Profiles - Switcher
 *
 * Handles automatic and manual profile switching with swap limits
 * and context preservation.
 */

import { EventEmitter } from 'events';
import type {
  ClaudeProfile,
  ClaudeAutoSwitchSettings,
  ProfileSwapEvent,
  ProfileScore,
} from './types';
import {
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  getAutoSwitchSettings,
  updateProfile,
} from './storage';
import { scoreProfiles, scoreProfile, getBestProfile, shouldSwitch } from './scoring';
import { debug } from '../utils/debug';

/**
 * Events emitted by ProfileSwitcher.
 */
export interface ProfileSwitcherEvents {
  /** Profile swap occurred */
  'profile-swapped': (event: ProfileSwapEvent) => void;

  /** Manual profile selection required (all profiles exhausted) */
  'manual-required': (reason: string) => void;

  /** Proactive swap threshold reached */
  'threshold-reached': (profileId: string, usageType: 'session' | 'weekly', usage: number) => void;

  /** Swap rejected due to limits */
  'swap-rejected': (reason: string) => void;
}

/**
 * Profile switching service.
 */
export class ProfileSwitcher extends EventEmitter {
  /** Track swap counts per session */
  private sessionSwapCounts = new Map<string, number>();

  /**
   * Check if a proactive swap should occur based on usage thresholds.
   *
   * @param currentProfile - Current active profile
   * @param settings - Auto-switch settings
   * @returns Decision and reason
   */
  async shouldProactiveSwap(
    currentProfile: ClaudeProfile,
    settings?: ClaudeAutoSwitchSettings
  ): Promise<{ shouldSwap: boolean; reason: string }> {
    const autoSettings = settings ?? await getAutoSwitchSettings();

    // Check if auto-switching is enabled
    if (!autoSettings.enabled) {
      return { shouldSwap: false, reason: 'Auto-switching is disabled' };
    }

    // Check usage data
    const usage = currentProfile.usage;
    if (!usage) {
      return { shouldSwap: false, reason: 'No usage data available' };
    }

    // Check session threshold
    if (usage.fiveHourUtilization >= autoSettings.proactiveThresholdSession) {
      this.emit('threshold-reached', currentProfile.id, 'session', usage.fiveHourUtilization);
      return {
        shouldSwap: true,
        reason: `5-hour usage (${Math.round(usage.fiveHourUtilization * 100)}%) exceeds threshold (${Math.round(autoSettings.proactiveThresholdSession * 100)}%)`,
      };
    }

    // Check weekly threshold
    if (usage.sevenDayUtilization >= autoSettings.proactiveThresholdWeekly) {
      this.emit('threshold-reached', currentProfile.id, 'weekly', usage.sevenDayUtilization);
      return {
        shouldSwap: true,
        reason: `7-day usage (${Math.round(usage.sevenDayUtilization * 100)}%) exceeds threshold (${Math.round(autoSettings.proactiveThresholdWeekly * 100)}%)`,
      };
    }

    // Check if already limited
    if (usage.isSessionLimited) {
      return {
        shouldSwap: true,
        reason: 'Profile is session-limited',
      };
    }
    if (usage.isWeeklyLimited) {
      return {
        shouldSwap: true,
        reason: 'Profile is weekly-limited',
      };
    }

    return { shouldSwap: false, reason: 'Usage within thresholds' };
  }

  /**
   * Check if a reactive swap should occur (rate limit hit).
   *
   * @param settings - Auto-switch settings
   * @returns Whether reactive switching is allowed
   */
  async shouldReactiveSwap(
    settings?: ClaudeAutoSwitchSettings
  ): Promise<{ shouldSwap: boolean; reason: string }> {
    const autoSettings = settings ?? await getAutoSwitchSettings();

    if (!autoSettings.enabled) {
      return { shouldSwap: false, reason: 'Auto-switching is disabled' };
    }

    if (!autoSettings.reactiveEnabled) {
      return { shouldSwap: false, reason: 'Reactive switching is disabled' };
    }

    return { shouldSwap: true, reason: 'Reactive switching is enabled' };
  }

  /**
   * Select the best profile to switch to.
   *
   * @param excludeProfileIds - Profile IDs to exclude
   * @returns Best profile or null if none available
   */
  async selectBestProfile(
    excludeProfileIds: string[] = []
  ): Promise<ClaudeProfile | null> {
    const profiles = await listProfiles();
    return getBestProfile(profiles, excludeProfileIds);
  }

  /**
   * Get scored profiles for UI display.
   */
  async getScoredProfiles(): Promise<{ profile: ClaudeProfile; score: ProfileScore }[]> {
    const profiles = await listProfiles();
    const currentProfile = await getActiveProfile();
    const scores = await scoreProfiles(profiles, currentProfile?.id);

    return profiles.map(profile => ({
      profile,
      score: scores.find(s => s.profileId === profile.id)!,
    })).sort((a, b) => b.score.score - a.score.score);
  }

  /**
   * Execute a profile swap.
   *
   * @param toProfileId - Profile ID to switch to
   * @param reason - Reason for the swap
   * @param sessionId - Session ID for swap count tracking
   * @returns The swap event
   */
  async executeSwap(
    toProfileId: string,
    reason: 'proactive' | 'reactive' | 'manual',
    sessionId?: string
  ): Promise<ProfileSwapEvent> {
    const settings = await getAutoSwitchSettings();
    const currentProfile = await getActiveProfile();
    const fromProfileId = currentProfile?.id ?? 'none';

    // Check swap limits for non-manual swaps
    if (reason !== 'manual' && sessionId) {
      const swapCount = this.sessionSwapCounts.get(sessionId) ?? 0;

      if (swapCount >= settings.maxSwapsPerSession) {
        const rejectReason = `Max swaps (${settings.maxSwapsPerSession}) reached for session`;
        this.emit('swap-rejected', rejectReason);
        this.emit('manual-required', rejectReason);
        throw new Error(rejectReason);
      }
    }

    debug(`[ProfileSwitcher] Swapping from ${fromProfileId} to ${toProfileId} (${reason})`);

    // Execute the swap
    await setActiveProfile(toProfileId);

    // Update last used
    await updateProfile(toProfileId, { lastUsedAt: Date.now() });

    // Update swap count
    if (sessionId) {
      const currentCount = this.sessionSwapCounts.get(sessionId) ?? 0;
      this.sessionSwapCounts.set(sessionId, currentCount + 1);
    }

    // Create swap event
    const event: ProfileSwapEvent = {
      fromProfileId,
      toProfileId,
      reason,
      timestamp: Date.now(),
    };

    this.emit('profile-swapped', event);

    return event;
  }

  /**
   * Attempt an automatic swap (proactive or reactive).
   *
   * @param reason - Swap reason
   * @param sessionId - Session ID for tracking
   * @param excludeProfileIds - Profiles to exclude
   * @returns The swap event, or null if swap not possible
   */
  async attemptAutoSwap(
    reason: 'proactive' | 'reactive',
    sessionId?: string,
    excludeProfileIds: string[] = []
  ): Promise<ProfileSwapEvent | null> {
    // Check settings
    const canSwap = reason === 'proactive'
      ? await this.shouldProactiveSwap(await getActiveProfile() as ClaudeProfile)
      : await this.shouldReactiveSwap();

    if (!canSwap.shouldSwap) {
      debug(`[ProfileSwitcher] Auto swap not allowed: ${canSwap.reason}`);
      return null;
    }

    // Check swap limits
    const settings = await getAutoSwitchSettings();
    if (sessionId) {
      const swapCount = this.sessionSwapCounts.get(sessionId) ?? 0;
      if (swapCount >= settings.maxSwapsPerSession) {
        const rejectReason = `Max swaps (${settings.maxSwapsPerSession}) reached for session`;
        this.emit('manual-required', rejectReason);
        debug(`[ProfileSwitcher] ${rejectReason}`);
        return null;
      }
    }

    // Find best profile
    const currentProfile = await getActiveProfile();
    const allExcludes = currentProfile
      ? [...excludeProfileIds, currentProfile.id]
      : excludeProfileIds;

    const bestProfile = await this.selectBestProfile(allExcludes);

    if (!bestProfile) {
      const rejectReason = 'No available profiles to switch to';
      this.emit('manual-required', rejectReason);
      debug(`[ProfileSwitcher] ${rejectReason}`);
      return null;
    }

    // Execute swap
    return this.executeSwap(bestProfile.id, reason, sessionId);
  }

  /**
   * Get the swap count for a session.
   */
  getSessionSwapCount(sessionId: string): number {
    return this.sessionSwapCounts.get(sessionId) ?? 0;
  }

  /**
   * Reset the swap count for a session (e.g., on manual profile selection).
   */
  resetSessionSwapCount(sessionId: string): void {
    this.sessionSwapCounts.delete(sessionId);
  }

  /**
   * Clear all session swap counts.
   */
  clearAllSwapCounts(): void {
    this.sessionSwapCounts.clear();
  }

  /**
   * Check if a profile switch is recommended.
   *
   * @param sessionId - Session ID for tracking
   * @returns Recommendation and reason
   */
  async checkSwitchRecommendation(
    sessionId?: string
  ): Promise<{
    recommended: boolean;
    reason: string;
    currentProfile: ClaudeProfile | null;
    bestAlternative: ClaudeProfile | null;
    currentScore: ProfileScore | null;
    alternativeScore: ProfileScore | null;
  }> {
    const currentProfile = await getActiveProfile();

    if (!currentProfile) {
      const profiles = await listProfiles();
      if (profiles.length === 0) {
        return {
          recommended: false,
          reason: 'No profiles configured',
          currentProfile: null,
          bestAlternative: null,
          currentScore: null,
          alternativeScore: null,
        };
      }

      // No active profile but profiles exist - recommend first available
      const bestProfile = await this.selectBestProfile();
      return {
        recommended: !!bestProfile,
        reason: bestProfile ? 'No active profile - recommend selecting one' : 'No available profiles',
        currentProfile: null,
        bestAlternative: bestProfile,
        currentScore: null,
        alternativeScore: bestProfile ? await scoreProfile(bestProfile) : null,
      };
    }

    // Check swap limits
    const settings = await getAutoSwitchSettings();
    if (sessionId) {
      const swapCount = this.sessionSwapCounts.get(sessionId) ?? 0;
      if (swapCount >= settings.maxSwapsPerSession) {
        return {
          recommended: false,
          reason: `Max swaps (${settings.maxSwapsPerSession}) reached for session`,
          currentProfile,
          bestAlternative: null,
          currentScore: await scoreProfile(currentProfile, currentProfile.id),
          alternativeScore: null,
        };
      }
    }

    // Score current profile
    const currentScore = await scoreProfile(currentProfile, currentProfile.id);

    // Find best alternative
    const bestAlternative = await this.selectBestProfile([currentProfile.id]);
    if (!bestAlternative) {
      return {
        recommended: false,
        reason: 'No alternative profiles available',
        currentProfile,
        bestAlternative: null,
        currentScore,
        alternativeScore: null,
      };
    }

    const alternativeScore = await scoreProfile(bestAlternative);

    // Check if switch is recommended
    const decision = shouldSwitch(currentScore, alternativeScore);

    return {
      recommended: decision.shouldSwitch,
      reason: decision.reason,
      currentProfile,
      bestAlternative,
      currentScore,
      alternativeScore,
    };
  }
}

// Singleton instance
let switcherInstance: ProfileSwitcher | null = null;

/**
 * Get the singleton profile switcher instance.
 */
export function getProfileSwitcher(): ProfileSwitcher {
  if (!switcherInstance) {
    switcherInstance = new ProfileSwitcher();
  }
  return switcherInstance;
}

/**
 * Create a new profile switcher instance (for testing).
 */
export function createProfileSwitcher(): ProfileSwitcher {
  return new ProfileSwitcher();
}
