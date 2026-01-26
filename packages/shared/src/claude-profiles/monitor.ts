/**
 * Claude Profiles - Usage Monitor
 *
 * Monitors usage across all Claude profiles by polling Anthropic's usage API.
 * Emits events for UI updates and auto-switching triggers.
 */

import { EventEmitter } from 'events';
import type { ClaudeProfile, ClaudeUsageData } from './types';
import { listProfiles, updateProfileUsage, recordAuthFailure, isInAuthCooldown } from './storage';
import { getProfileTokens, isProfileTokenExpired, refreshProfileToken } from './oauth';
import { debug } from '../utils/debug';

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Events emitted by ClaudeUsageMonitor.
 */
export interface ClaudeUsageMonitorEvents {
  /** Usage data updated for a profile */
  'usage-updated': (profileId: string, usage: ClaudeUsageData) => void;

  /** Profile hit a rate limit */
  'profile-limited': (profileId: string, limitType: 'session' | 'weekly') => void;

  /** Authentication failed for a profile */
  'auth-failed': (profileId: string, error: Error) => void;

  /** Token refreshed for a profile */
  'token-refreshed': (profileId: string) => void;

  /** Monitor started */
  'started': () => void;

  /** Monitor stopped */
  'stopped': () => void;

  /** Monitor error */
  'error': (error: Error) => void;
}

/**
 * Usage monitoring service for Claude profiles.
 */
export class ClaudeUsageMonitor extends EventEmitter {
  private intervalId: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;
  private isRunning = false;

  constructor(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
    super();
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Start monitoring all profiles.
   */
  start(): void {
    if (this.isRunning) {
      debug('[ClaudeUsageMonitor] Already running');
      return;
    }

    debug('[ClaudeUsageMonitor] Starting usage monitoring');
    this.isRunning = true;

    // Poll immediately
    this.pollAllProfiles().catch(err => {
      debug('[ClaudeUsageMonitor] Initial poll error:', err);
    });

    // Set up interval
    this.intervalId = setInterval(() => {
      this.pollAllProfiles().catch(err => {
        debug('[ClaudeUsageMonitor] Poll interval error:', err);
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }, this.pollIntervalMs);

    this.emit('started');
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    debug('[ClaudeUsageMonitor] Stopping usage monitoring');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Check if the monitor is running.
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get the poll interval.
   */
  getPollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Set the poll interval (takes effect on next interval).
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;

    // Restart interval if running
    if (this.isRunning && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        this.pollAllProfiles().catch(err => {
          debug('[ClaudeUsageMonitor] Poll interval error:', err);
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        });
      }, this.pollIntervalMs);
    }
  }

  /**
   * Poll usage for all profiles.
   */
  async pollAllProfiles(): Promise<void> {
    const profiles = await listProfiles();

    for (const profile of profiles) {
      try {
        await this.pollProfile(profile.id);
      } catch (error) {
        debug(`[ClaudeUsageMonitor] Error polling profile ${profile.id}:`, error);
      }
    }
  }

  /**
   * Poll usage for a specific profile.
   */
  async pollProfile(profileId: string): Promise<ClaudeUsageData | null> {
    const profiles = await listProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
      debug(`[ClaudeUsageMonitor] Profile ${profileId} not found`);
      return null;
    }

    // Check auth cooldown
    if (isInAuthCooldown(profile)) {
      debug(`[ClaudeUsageMonitor] Profile ${profileId} in auth cooldown, skipping`);
      return profile.usage ?? null;
    }

    // Check if token is expired and needs refresh
    if (await isProfileTokenExpired(profileId)) {
      try {
        debug(`[ClaudeUsageMonitor] Token expired for ${profileId}, refreshing`);
        await refreshProfileToken(profileId);
        this.emit('token-refreshed', profileId);
      } catch (error) {
        debug(`[ClaudeUsageMonitor] Token refresh failed for ${profileId}:`, error);
        await recordAuthFailure(profileId);
        this.emit('auth-failed', profileId, error instanceof Error ? error : new Error(String(error)));
        return profile.usage ?? null;
      }
    }

    // Get tokens
    const tokens = await getProfileTokens(profileId);
    if (!tokens) {
      debug(`[ClaudeUsageMonitor] No tokens for profile ${profileId}`);
      return null;
    }

    // Fetch usage
    try {
      const usage = await this.fetchUsage(tokens.accessToken);

      // Update storage
      await updateProfileUsage(profileId, usage);

      // Emit events
      this.emit('usage-updated', profileId, usage);

      // Check limits
      if (usage.isSessionLimited) {
        this.emit('profile-limited', profileId, 'session');
      }
      if (usage.isWeeklyLimited) {
        this.emit('profile-limited', profileId, 'weekly');
      }

      return usage;
    } catch (error) {
      debug(`[ClaudeUsageMonitor] Usage fetch failed for ${profileId}:`, error);

      // Check if it's an auth error
      if (error instanceof Error && (
        error.message.includes('401') ||
        error.message.includes('403') ||
        error.message.includes('unauthorized')
      )) {
        await recordAuthFailure(profileId);
        this.emit('auth-failed', profileId, error);
      }

      return profile.usage ?? null;
    }
  }

  /**
   * Fetch usage data from Anthropic's API.
   */
  private async fetchUsage(accessToken: string): Promise<ClaudeUsageData> {
    const response = await fetch(USAGE_API_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Usage API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      five_hour_utilization?: number;
      seven_day_utilization?: number;
      // Additional fields we may receive
      is_rate_limited?: boolean;
    };

    const fiveHourUtilization = data.five_hour_utilization ?? 0;
    const sevenDayUtilization = data.seven_day_utilization ?? 0;

    return {
      fiveHourUtilization,
      sevenDayUtilization,
      isSessionLimited: fiveHourUtilization >= 1.0 || data.is_rate_limited === true,
      isWeeklyLimited: sevenDayUtilization >= 1.0,
      timestamp: Date.now(),
    };
  }

  /**
   * Force a refresh of a profile's usage data.
   */
  async refreshProfile(profileId: string): Promise<ClaudeUsageData | null> {
    return this.pollProfile(profileId);
  }

  /**
   * Get cached usage for a profile (from storage, not API).
   */
  async getCachedUsage(profileId: string): Promise<ClaudeUsageData | null> {
    const profiles = await listProfiles();
    const profile = profiles.find(p => p.id === profileId);
    return profile?.usage ?? null;
  }
}

// Singleton instance
let monitorInstance: ClaudeUsageMonitor | null = null;

/**
 * Get the singleton usage monitor instance.
 */
export function getUsageMonitor(): ClaudeUsageMonitor {
  if (!monitorInstance) {
    monitorInstance = new ClaudeUsageMonitor();
  }
  return monitorInstance;
}

/**
 * Create a new usage monitor instance (for testing).
 */
export function createUsageMonitor(pollIntervalMs?: number): ClaudeUsageMonitor {
  return new ClaudeUsageMonitor(pollIntervalMs);
}
