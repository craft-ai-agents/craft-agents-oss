/**
 * Claude Profiles - Public API
 *
 * Multi-account OAuth support for Claude with usage monitoring,
 * profile scoring, and automatic account switching.
 *
 * Usage:
 *   import {
 *     // Types
 *     type ClaudeProfile,
 *     type ClaudeUsageData,
 *     type ClaudeAutoSwitchSettings,
 *     type ProfileScore,
 *     type ProfileSwapEvent,
 *
 *     // Storage
 *     listProfiles,
 *     getProfile,
 *     getActiveProfile,
 *     setActiveProfile,
 *     setDefaultProfile,
 *     updateProfile,
 *     deleteProfile,
 *     getAutoSwitchSettings,
 *     updateAutoSwitchSettings,
 *     ProfileStorageError,
 *
 *     // OAuth
 *     startProfileOAuth,
 *     completeProfileOAuth,
 *     refreshProfileToken,
 *     getProfileTokens,
 *     deleteProfileTokens,
 *     isProfileTokenExpired,
 *     validateOAuthState,
 *
 *     // Monitoring
 *     ClaudeUsageMonitor,
 *     getUsageMonitor,
 *     createUsageMonitor,
 *
 *     // Scoring
 *     scoreProfiles,
 *     scoreProfile,
 *     getBestProfile,
 *
 *     // Switching
 *     ProfileSwitcher,
 *     getProfileSwitcher,
 *     createProfileSwitcher,
 *   } from '@vesper/shared/claude-profiles';
 */

// Types
export type {
  ClaudeProfile,
  ClaudeUsageData,
  ClaudeAutoSwitchSettings,
  ProfileScore,
  ProfileSwapEvent,
  ProfileStorage,
} from './types';

export {
  DEFAULT_AUTO_SWITCH_SETTINGS,
  PROFILE_STORAGE_VERSION,
} from './types';

// Storage
export {
  ProfileStorageError,
  getProfilesDir,
  getProfilesPath,
  listProfiles,
  getProfile,
  getActiveProfile,
  getActiveProfileId,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  setActiveProfile,
  updateProfileUsage,
  getAutoSwitchSettings,
  updateAutoSwitchSettings,
  recordAuthFailure,
  isInAuthCooldown,
} from './storage';

// OAuth
export type {
  ProfileOAuthState,
  ProfileOAuthTokens,
  UserInfo,
} from './oauth';

export {
  startProfileOAuth,
  completeProfileOAuth,
  refreshProfileToken,
  getProfileTokens,
  deleteProfileTokens,
  isProfileTokenExpired,
  validateOAuthState,
  hasValidOAuthState,
  clearOAuthState,
  clearAllOAuthStates,
  getPendingOAuthStateCount,
} from './oauth';

// Monitoring
export type {
  ClaudeUsageMonitorEvents,
} from './monitor';

export {
  ClaudeUsageMonitor,
  getUsageMonitor,
  createUsageMonitor,
} from './monitor';

// Scoring
export {
  scoreProfiles,
  scoreProfile,
  getBestProfile,
  shouldSwitch,
  getScoringExplanation,
} from './scoring';

// Switching
export type {
  ProfileSwitcherEvents,
} from './switcher';

export {
  ProfileSwitcher,
  getProfileSwitcher,
  createProfileSwitcher,
} from './switcher';
