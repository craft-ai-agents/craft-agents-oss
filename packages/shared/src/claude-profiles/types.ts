/**
 * Claude Profiles - Type Definitions
 *
 * Types for multi-account Claude OAuth support with usage monitoring,
 * profile scoring, and automatic account switching.
 */

/**
 * A Claude account profile with OAuth credentials and usage tracking.
 */
export interface ClaudeProfile {
  /** Unique identifier (UUID) */
  id: string;

  /** User-defined label (e.g., "Work", "Personal") */
  name: string;

  /** Account email address */
  email: string;

  /** Timestamp when profile was created (Unix ms) */
  createdAt: number;

  /** Timestamp when profile was last used (Unix ms) */
  lastUsedAt?: number;

  /** Whether this is the default profile for new sessions */
  isDefault: boolean;

  /** Cached usage data from last poll */
  usage?: ClaudeUsageData;

  /** Timestamp of last successful usage poll (Unix ms) */
  lastMonitoredAt?: number;

  /** Timestamp of last auth failure (for cooldown) */
  lastAuthFailureAt?: number;
}

/**
 * Usage data from Anthropic's OAuth usage API.
 */
export interface ClaudeUsageData {
  /** 5-hour rolling window utilization (0.0-1.0) */
  fiveHourUtilization: number;

  /** 7-day rolling window utilization (0.0-1.0) */
  sevenDayUtilization: number;

  /** Whether the profile has hit the 5-hour limit */
  isSessionLimited: boolean;

  /** Whether the profile has hit the 7-day limit */
  isWeeklyLimited: boolean;

  /** Timestamp when this data was fetched (Unix ms) */
  timestamp: number;
}

/**
 * Score assigned to a profile for switching decisions.
 */
export interface ProfileScore {
  /** Profile ID */
  profileId: string;

  /** Numeric score (higher is better) */
  score: number;

  /** Human-readable reason for this score */
  reason: string;

  /** Whether the profile can be used right now */
  isAvailable: boolean;
}

/**
 * Auto-switching configuration settings.
 */
export interface ClaudeAutoSwitchSettings {
  /** Master toggle for auto-switching */
  enabled: boolean;

  /** Threshold for proactive session switching (0.0-1.0, default 0.95) */
  proactiveThresholdSession: number;

  /** Threshold for proactive weekly switching (0.0-1.0, default 0.99) */
  proactiveThresholdWeekly: number;

  /** Enable reactive switching on rate limit errors */
  reactiveEnabled: boolean;

  /** Maximum swaps allowed per session (default 2) */
  maxSwapsPerSession: number;
}

/**
 * Record of a profile swap event.
 */
export interface ProfileSwapEvent {
  /** Profile ID we switched from */
  fromProfileId: string;

  /** Profile ID we switched to */
  toProfileId: string;

  /** Reason for the swap */
  reason: 'proactive' | 'reactive' | 'manual';

  /** Timestamp when the swap occurred (Unix ms) */
  timestamp: number;
}

/**
 * Storage format for claude-profiles.json.
 */
export interface ProfileStorage {
  /** All profiles */
  profiles: ClaudeProfile[];

  /** Currently active profile ID (null if none) */
  activeProfileId: string | null;

  /** Auto-switch configuration */
  autoSwitchSettings: ClaudeAutoSwitchSettings;

  /** Storage format version */
  version: number;
}

/**
 * Default auto-switch settings.
 */
export const DEFAULT_AUTO_SWITCH_SETTINGS: ClaudeAutoSwitchSettings = {
  enabled: true,
  proactiveThresholdSession: 0.95,
  proactiveThresholdWeekly: 0.99,
  reactiveEnabled: true,
  maxSwapsPerSession: 2,
};

/**
 * Current storage version.
 */
export const PROFILE_STORAGE_VERSION = 1;
