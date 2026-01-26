/**
 * Claude Profiles - Usage Monitor
 *
 * Monitors usage across all Claude profiles by polling Anthropic's usage API.
 * Falls back to parsing Claude CLI output when API is unavailable.
 * Emits events for UI updates and auto-switching triggers.
 */

import { EventEmitter } from 'events';
import { spawn } from 'node:child_process';
import type { ClaudeProfile, ClaudeUsageData } from './types';
import { listProfiles, updateProfileUsage, recordAuthFailure, isInAuthCooldown } from './storage';
import { getProfileTokens, isProfileTokenExpired, refreshProfileToken } from './oauth';
import { debug } from '../utils/debug';

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const CLI_TIMEOUT_MS = 10 * 1000; // 10 seconds for CLI command

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

      if (usage) {
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
      }

      return usage;
    } catch (error) {
      debug(`[ClaudeUsageMonitor] Usage fetch failed for ${profileId}:`, error);

      // Only record auth failure for actual auth errors (401, 403)
      // Don't record for 404 (endpoint not found) or other errors
      if (error instanceof Error && (
        error.message.includes('401') ||
        error.message.includes('403')
      )) {
        await recordAuthFailure(profileId);
        this.emit('auth-failed', profileId, error);
      }

      return profile.usage ?? null;
    }
  }

  /**
   * Fetch usage data from Anthropic's API with CLI fallback.
   * Tries API first, then falls back to parsing Claude CLI output.
   * Returns null if both methods fail.
   */
  private async fetchUsage(accessToken: string): Promise<ClaudeUsageData | null> {
    // Try API first
    const apiResult = await this.fetchUsageViaAPI(accessToken);
    if (apiResult) {
      return apiResult;
    }

    // Fall back to CLI
    debug('[ClaudeUsageMonitor] API unavailable, trying CLI fallback');
    return this.fetchUsageViaCLI(accessToken);
  }

  /**
   * Fetch usage data from Anthropic's API.
   * Returns null if the endpoint is unavailable or returns an error.
   */
  private async fetchUsageViaAPI(accessToken: string): Promise<ClaudeUsageData | null> {
    try {
      const response = await fetch(USAGE_API_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      // Any error means API is not available - try CLI fallback
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        debug(`[ClaudeUsageMonitor] Usage API returned ${response.status}: ${text.slice(0, 100)}`);
        return null;
      }

      const data = await response.json() as {
        five_hour_utilization?: number;
        seven_day_utilization?: number;
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
    } catch (error) {
      debug('[ClaudeUsageMonitor] Usage API fetch error:', error);
      return null;
    }
  }

  /**
   * Fetch usage data by parsing Claude CLI output.
   * Runs `claude /usage` and parses the response.
   */
  private async fetchUsageViaCLI(accessToken: string): Promise<ClaudeUsageData | null> {
    return new Promise((resolve) => {
      try {
        // Run claude with the OAuth token in environment
        const proc = spawn('claude', ['-p', '/usage'], {
          env: {
            ...process.env,
            CLAUDE_CODE_OAUTH_TOKEN: accessToken,
          },
          timeout: CLI_TIMEOUT_MS,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('error', (error) => {
          debug('[ClaudeUsageMonitor] CLI spawn error:', error);
          resolve(null);
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            debug(`[ClaudeUsageMonitor] CLI exited with code ${code}: ${stderr}`);
            resolve(null);
            return;
          }

          const usage = this.parseUsageOutput(stdout);
          resolve(usage);
        });

        // Kill process after timeout
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGTERM');
            debug('[ClaudeUsageMonitor] CLI command timed out');
            resolve(null);
          }
        }, CLI_TIMEOUT_MS);

      } catch (error) {
        debug('[ClaudeUsageMonitor] CLI fallback error:', error);
        resolve(null);
      }
    });
  }

  /**
   * Parse Claude CLI /usage output to extract usage percentages.
   *
   * Example output:
   *   Current session ████▌ 9% used Resets 11:59pm
   *   Current week (all models) 79% used Resets Nov 1, 10:59am
   *   Current week (Opus) 0% used
   */
  private parseUsageOutput(output: string): ClaudeUsageData | null {
    try {
      // Match session usage: "Current session ... X% used"
      const sessionMatch = output.match(/Current session[^]*?(\d+)%\s*used/i);
      // Match weekly usage: "Current week (all models) X% used" or "Current week ... X% used"
      const weeklyMatch = output.match(/Current week[^]*?(\d+)%\s*used/i);

      if (!sessionMatch && !weeklyMatch) {
        debug('[ClaudeUsageMonitor] Could not parse usage from CLI output:', output.slice(0, 200));
        return null;
      }

      const sessionPercent = sessionMatch ? parseInt(sessionMatch[1], 10) : 0;
      const weeklyPercent = weeklyMatch ? parseInt(weeklyMatch[1], 10) : 0;

      // Convert percentages to 0-1 range
      const fiveHourUtilization = sessionPercent / 100;
      const sevenDayUtilization = weeklyPercent / 100;

      return {
        fiveHourUtilization,
        sevenDayUtilization,
        isSessionLimited: sessionPercent >= 100,
        isWeeklyLimited: weeklyPercent >= 100,
        timestamp: Date.now(),
      };
    } catch (error) {
      debug('[ClaudeUsageMonitor] Error parsing CLI output:', error);
      return null;
    }
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
