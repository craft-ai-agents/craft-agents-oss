/**
 * Claude Profiles - Scoring
 *
 * Profile scoring algorithm for automatic profile selection.
 * Higher scores indicate better candidates for switching.
 *
 * Scoring Algorithm:
 *   Base score: 1000
 *
 *   Rate limit penalties:
 *     - Session limited (5-hour): -500
 *     - Weekly limited (7-day): -1000
 *
 *   Usage penalties (quadratic):
 *     - Session: -(usage^2 * 200)  // 0.9 = -162 pts
 *     - Weekly: -(usage^2 * 100)   // 0.9 = -81 pts
 *
 *   Availability bonuses:
 *     - Current profile: +50 (prefer stability)
 *     - Recently used (< 1hr): +20 (token likely valid)
 *     - Never used: +10 (fresh account)
 *
 *   Auth state penalties:
 *     - Token expired: -2000 (force refresh or skip)
 *     - Auth failed recently: -1500
 */

import type { ClaudeProfile, ProfileScore } from './types';
import { isInAuthCooldown, isProfileRateLimited } from './storage';
import { isProfileTokenExpired, getProfileTokens } from './oauth';

// Scoring constants
const BASE_SCORE = 1000;
const SESSION_LIMITED_PENALTY = -500;
const WEEKLY_LIMITED_PENALTY = -1000;
const USAGE_SESSION_MULTIPLIER = 200;
const USAGE_WEEKLY_MULTIPLIER = 100;
const CURRENT_PROFILE_BONUS = 50;
const RECENTLY_USED_BONUS = 20;
const NEVER_USED_BONUS = 10;
const TOKEN_EXPIRED_PENALTY = -2000;
const AUTH_FAILED_PENALTY = -1500;
const NO_TOKENS_PENALTY = -3000;

// Time constants
const RECENTLY_USED_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Score a single profile.
 */
export async function scoreProfile(
  profile: ClaudeProfile,
  currentProfileId?: string
): Promise<ProfileScore> {
  let score = BASE_SCORE;
  const reasons: string[] = [];

  // Check if profile has tokens
  const tokens = await getProfileTokens(profile.id);
  if (!tokens) {
    return {
      profileId: profile.id,
      score: BASE_SCORE + NO_TOKENS_PENALTY,
      reason: 'No OAuth tokens - profile needs authentication',
      isAvailable: false,
    };
  }

  // Check auth state
  if (isInAuthCooldown(profile)) {
    score += AUTH_FAILED_PENALTY;
    reasons.push('auth failed recently (-1500)');
  }

  // Check token expiry
  if (await isProfileTokenExpired(profile.id)) {
    score += TOKEN_EXPIRED_PENALTY;
    reasons.push('token expired (-2000)');
  }

  // Check rate limits from recorded events (reactive mode)
  const rateLimitStatus = isProfileRateLimited(profile);
  if (rateLimitStatus.isLimited) {
    if (rateLimitStatus.type === 'weekly') {
      score += WEEKLY_LIMITED_PENALTY;
      reasons.push('weekly limited (-1000)');
    } else {
      score += SESSION_LIMITED_PENALTY;
      reasons.push('session limited (-500)');
    }
  }

  // Also check rate limits from usage data (proactive mode - if available)
  if (profile.usage?.isWeeklyLimited && !rateLimitStatus.isLimited) {
    score += WEEKLY_LIMITED_PENALTY;
    reasons.push('weekly limited from usage (-1000)');
  }
  if (profile.usage?.isSessionLimited && !rateLimitStatus.isLimited) {
    score += SESSION_LIMITED_PENALTY;
    reasons.push('session limited from usage (-500)');
  }

  // Apply usage penalties (quadratic to penalize high usage more)
  // Only if usage data is available (proactive mode)
  if (profile.usage) {
    const sessionPenalty = -(profile.usage.fiveHourUtilization ** 2 * USAGE_SESSION_MULTIPLIER);
    const weeklyPenalty = -(profile.usage.sevenDayUtilization ** 2 * USAGE_WEEKLY_MULTIPLIER);

    score += sessionPenalty;
    score += weeklyPenalty;

    if (sessionPenalty < -50) {
      reasons.push(`5hr usage ${Math.round(profile.usage.fiveHourUtilization * 100)}% (${Math.round(sessionPenalty)})`);
    }
    if (weeklyPenalty < -25) {
      reasons.push(`7d usage ${Math.round(profile.usage.sevenDayUtilization * 100)}% (${Math.round(weeklyPenalty)})`);
    }
  }

  // Apply availability bonuses
  if (profile.id === currentProfileId) {
    score += CURRENT_PROFILE_BONUS;
    reasons.push('current profile (+50)');
  }

  const now = Date.now();
  if (profile.lastUsedAt) {
    if (now - profile.lastUsedAt < RECENTLY_USED_THRESHOLD_MS) {
      score += RECENTLY_USED_BONUS;
      reasons.push('recently used (+20)');
    }
  } else {
    score += NEVER_USED_BONUS;
    reasons.push('never used (+10)');
  }

  // Determine availability (check both rate limit events and usage data)
  const isAvailable =
    !rateLimitStatus.isLimited &&
    !profile.usage?.isSessionLimited &&
    !profile.usage?.isWeeklyLimited &&
    !isInAuthCooldown(profile) &&
    !(await isProfileTokenExpired(profile.id));

  return {
    profileId: profile.id,
    score: Math.round(score),
    reason: reasons.length > 0 ? reasons.join(', ') : 'base score',
    isAvailable,
  };
}

/**
 * Score all profiles and return sorted results.
 *
 * @param profiles - Profiles to score
 * @param currentProfileId - Current active profile ID (gets stability bonus)
 * @returns Scored profiles sorted by score (highest first)
 */
export async function scoreProfiles(
  profiles: ClaudeProfile[],
  currentProfileId?: string
): Promise<ProfileScore[]> {
  const scores = await Promise.all(
    profiles.map(profile => scoreProfile(profile, currentProfileId))
  );

  // Sort by score descending
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Get the best available profile (highest score and available).
 *
 * @param profiles - Profiles to consider
 * @param excludeProfileIds - Profile IDs to exclude (e.g., current profile)
 * @returns Best profile or null if none available
 */
export async function getBestProfile(
  profiles: ClaudeProfile[],
  excludeProfileIds: string[] = []
): Promise<ClaudeProfile | null> {
  // Filter out excluded profiles
  const candidates = profiles.filter(p => !excludeProfileIds.includes(p.id));

  if (candidates.length === 0) {
    return null;
  }

  // Score remaining profiles (no current profile bonus since we're excluding current)
  const scores = await scoreProfiles(candidates);

  // Find best available
  const bestScore = scores.find(s => s.isAvailable);
  if (!bestScore) {
    return null;
  }

  return candidates.find(p => p.id === bestScore.profileId) ?? null;
}

/**
 * Check if switching profiles would be beneficial.
 *
 * @param currentProfile - Current profile
 * @param bestAlternative - Best alternative profile
 * @param currentScore - Current profile's score
 * @param alternativeScore - Alternative profile's score
 * @returns Whether switching is recommended
 */
export function shouldSwitch(
  currentScore: ProfileScore,
  alternativeScore: ProfileScore
): { shouldSwitch: boolean; reason: string } {
  // Don't switch if current is available and alternative isn't
  if (currentScore.isAvailable && !alternativeScore.isAvailable) {
    return {
      shouldSwitch: false,
      reason: 'Current profile is available, alternative is not',
    };
  }

  // Switch if current is not available but alternative is
  if (!currentScore.isAvailable && alternativeScore.isAvailable) {
    return {
      shouldSwitch: true,
      reason: `Current profile unavailable (${currentScore.reason}), switching to available profile`,
    };
  }

  // Both available or both unavailable - compare scores
  // Require significant improvement to avoid unnecessary switches
  const scoreDiff = alternativeScore.score - currentScore.score;
  const improvementThreshold = 100; // Require 100+ point improvement

  if (scoreDiff > improvementThreshold) {
    return {
      shouldSwitch: true,
      reason: `Alternative profile has significantly better score (+${Math.round(scoreDiff)})`,
    };
  }

  return {
    shouldSwitch: false,
    reason: `Current profile score (${currentScore.score}) is within threshold of alternative (${alternativeScore.score})`,
  };
}

/**
 * Get scoring details for display in UI.
 */
export function getScoringExplanation(): string {
  return `Profile Scoring Algorithm:

Base score: ${BASE_SCORE}

Rate limit penalties:
  - Session limited (5-hour): ${SESSION_LIMITED_PENALTY}
  - Weekly limited (7-day): ${WEEKLY_LIMITED_PENALTY}

Usage penalties (quadratic - penalizes high usage more):
  - Session: -(usage^2 * ${USAGE_SESSION_MULTIPLIER})
  - Weekly: -(usage^2 * ${USAGE_WEEKLY_MULTIPLIER})

Availability bonuses:
  - Current profile: +${CURRENT_PROFILE_BONUS}
  - Recently used (<1hr): +${RECENTLY_USED_BONUS}
  - Never used: +${NEVER_USED_BONUS}

Auth state penalties:
  - Token expired: ${TOKEN_EXPIRED_PENALTY}
  - Auth failed recently: ${AUTH_FAILED_PENALTY}
  - No tokens: ${NO_TOKENS_PENALTY}`;
}
