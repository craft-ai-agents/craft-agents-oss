/**
 * Claude Profiles - Storage
 *
 * File-based storage for Claude profiles with proper-lockfile for
 * concurrent-safe operations. Follows patterns from task-lists/storage.ts.
 *
 * Storage locations:
 *   - Profile metadata: ~/.vesper/claude-profiles/profiles.json
 *   - OAuth tokens: ~/.vesper/credentials.enc (via CredentialManager)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import type {
  ClaudeProfile,
  ProfileStorage,
  ClaudeAutoSwitchSettings,
  ClaudeUsageData,
} from './types';
import {
  DEFAULT_AUTO_SWITCH_SETTINGS,
  PROFILE_STORAGE_VERSION,
} from './types';

const VESPER_DIR = join(homedir(), '.vesper');
const PROFILES_DIR = join(VESPER_DIR, 'claude-profiles');
const PROFILES_FILE = join(PROFILES_DIR, 'profiles.json');

/**
 * Custom error class for profile operations.
 */
export class ProfileStorageError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA' | 'LOCK_TIMEOUT' | 'ACTIVE_PROFILE',
    public details?: unknown
  ) {
    super(message);
    this.name = 'ProfileStorageError';
  }
}

/**
 * Get the profiles directory path.
 */
export function getProfilesDir(): string {
  return PROFILES_DIR;
}

/**
 * Get the profiles file path.
 */
export function getProfilesPath(): string {
  return PROFILES_FILE;
}

/**
 * Create default storage structure.
 */
function createDefaultStorage(): ProfileStorage {
  return {
    profiles: [],
    activeProfileId: null,
    autoSwitchSettings: { ...DEFAULT_AUTO_SWITCH_SETTINGS },
    version: PROFILE_STORAGE_VERSION,
  };
}

/**
 * Ensure the profiles directory and file exist.
 */
async function ensureStorageExists(): Promise<void> {
  await mkdir(PROFILES_DIR, { recursive: true });

  if (!existsSync(PROFILES_FILE)) {
    await writeFile(PROFILES_FILE, JSON.stringify(createDefaultStorage(), null, 2));
  }
}

/**
 * Load the profile storage from disk.
 */
export async function loadProfileStorage(): Promise<ProfileStorage> {
  try {
    await ensureStorageExists();

    const content = await readFile(PROFILES_FILE, 'utf-8');
    const storage = JSON.parse(content) as ProfileStorage;

    // Validate structure
    if (!Array.isArray(storage.profiles)) {
      throw new ProfileStorageError('Invalid storage structure', 'CORRUPT_DATA');
    }

    // Migrate if needed (future-proofing)
    if (storage.version !== PROFILE_STORAGE_VERSION) {
      // Handle migrations here
      storage.version = PROFILE_STORAGE_VERSION;
    }

    // Ensure autoSwitchSettings exists
    if (!storage.autoSwitchSettings) {
      storage.autoSwitchSettings = { ...DEFAULT_AUTO_SWITCH_SETTINGS };
    }

    return storage;
  } catch (error) {
    if (error instanceof ProfileStorageError) throw error;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultStorage();
    }

    throw new ProfileStorageError(
      'Failed to load profile storage',
      'IO_ERROR',
      { originalError: error }
    );
  }
}

/**
 * Save the profile storage to disk.
 */
async function saveProfileStorage(storage: ProfileStorage): Promise<void> {
  await ensureStorageExists();
  await writeFile(PROFILES_FILE, JSON.stringify(storage, null, 2));
}

/**
 * Execute an operation with file locking.
 */
async function withLock<T>(operation: () => Promise<T>): Promise<T> {
  await ensureStorageExists();

  let release: (() => Promise<void>) | null = null;

  try {
    release = await lockfile.lock(PROFILES_FILE, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 },
    });

    return await operation();
  } catch (error) {
    if ((error as Error).message?.includes('ELOCKED')) {
      throw new ProfileStorageError(
        'Profile storage is locked by another process',
        'LOCK_TIMEOUT',
        { originalError: error }
      );
    }
    throw error;
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * List all profiles (without OAuth tokens).
 */
export async function listProfiles(): Promise<ClaudeProfile[]> {
  const storage = await loadProfileStorage();
  return storage.profiles;
}

/**
 * Get a profile by ID.
 */
export async function getProfile(profileId: string): Promise<ClaudeProfile | null> {
  const storage = await loadProfileStorage();
  return storage.profiles.find(p => p.id === profileId) ?? null;
}

/**
 * Get the active profile.
 */
export async function getActiveProfile(): Promise<ClaudeProfile | null> {
  const storage = await loadProfileStorage();

  if (!storage.activeProfileId) {
    // Return the default profile if no active profile
    const defaultProfile = storage.profiles.find(p => p.isDefault);
    if (defaultProfile) {
      return defaultProfile;
    }
    // Return the first profile if no default
    return storage.profiles[0] ?? null;
  }

  return storage.profiles.find(p => p.id === storage.activeProfileId) ?? null;
}

/**
 * Get the active profile ID.
 */
export async function getActiveProfileId(): Promise<string | null> {
  const storage = await loadProfileStorage();
  return storage.activeProfileId;
}

/**
 * Create a new profile (without OAuth tokens - tokens are added via completeOAuth).
 */
export async function createProfile(
  name: string,
  email: string
): Promise<ClaudeProfile> {
  if (!name || name.trim().length === 0) {
    throw new ProfileStorageError('Profile name is required', 'INVALID_INPUT');
  }
  if (name.length > 100) {
    throw new ProfileStorageError('Profile name too long (max 100 chars)', 'INVALID_INPUT');
  }
  if (!email || !email.includes('@')) {
    throw new ProfileStorageError('Valid email is required', 'INVALID_INPUT');
  }

  const profile: ClaudeProfile = {
    id: uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    createdAt: Date.now(),
    isDefault: false,
  };

  return withLock(async () => {
    const storage = await loadProfileStorage();

    // Check for duplicate email
    if (storage.profiles.some(p => p.email === profile.email)) {
      throw new ProfileStorageError(
        `Profile with email ${profile.email} already exists`,
        'INVALID_INPUT'
      );
    }

    // First profile becomes default
    if (storage.profiles.length === 0) {
      profile.isDefault = true;
      storage.activeProfileId = profile.id;
    }

    storage.profiles.push(profile);
    await saveProfileStorage(storage);

    return profile;
  });
}

/**
 * Update a profile.
 */
export async function updateProfile(
  profileId: string,
  updates: Partial<Pick<ClaudeProfile, 'name' | 'usage' | 'lastUsedAt' | 'lastMonitoredAt' | 'lastAuthFailureAt'>>
): Promise<ClaudeProfile> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profile = storage.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    // Apply updates
    if (updates.name !== undefined) {
      if (updates.name.trim().length === 0) {
        throw new ProfileStorageError('Profile name cannot be empty', 'INVALID_INPUT');
      }
      profile.name = updates.name.trim();
    }
    if (updates.usage !== undefined) profile.usage = updates.usage;
    if (updates.lastUsedAt !== undefined) profile.lastUsedAt = updates.lastUsedAt;
    if (updates.lastMonitoredAt !== undefined) profile.lastMonitoredAt = updates.lastMonitoredAt;
    if (updates.lastAuthFailureAt !== undefined) profile.lastAuthFailureAt = updates.lastAuthFailureAt;

    await saveProfileStorage(storage);
    return profile;
  });
}

/**
 * Delete a profile and its OAuth tokens.
 */
export async function deleteProfile(profileId: string): Promise<void> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profileIndex = storage.profiles.findIndex(p => p.id === profileId);

    if (profileIndex === -1) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    // Prevent deletion of active profile
    if (storage.activeProfileId === profileId) {
      throw new ProfileStorageError(
        'Cannot delete the active profile. Switch to another profile first.',
        'ACTIVE_PROFILE',
        { profileId }
      );
    }

    const deletedProfile = storage.profiles[profileIndex]!;

    // Remove from array
    storage.profiles.splice(profileIndex, 1);

    // If deleted profile was default, make first profile default
    if (deletedProfile.isDefault && storage.profiles.length > 0) {
      storage.profiles[0]!.isDefault = true;
    }

    await saveProfileStorage(storage);

    // Note: OAuth tokens are deleted separately via CredentialManager
  });
}

/**
 * Set a profile as the default.
 */
export async function setDefaultProfile(profileId: string): Promise<void> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profile = storage.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    // Clear existing default
    for (const p of storage.profiles) {
      p.isDefault = p.id === profileId;
    }

    await saveProfileStorage(storage);
  });
}

/**
 * Set the active profile.
 */
export async function setActiveProfile(profileId: string): Promise<void> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profile = storage.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    storage.activeProfileId = profileId;
    profile.lastUsedAt = Date.now();

    await saveProfileStorage(storage);
  });
}

/**
 * Update usage data for a profile.
 */
export async function updateProfileUsage(
  profileId: string,
  usage: ClaudeUsageData
): Promise<void> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profile = storage.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    profile.usage = usage;
    profile.lastMonitoredAt = Date.now();

    await saveProfileStorage(storage);
  });
}

/**
 * Get auto-switch settings.
 */
export async function getAutoSwitchSettings(): Promise<ClaudeAutoSwitchSettings> {
  const storage = await loadProfileStorage();
  return storage.autoSwitchSettings ?? { ...DEFAULT_AUTO_SWITCH_SETTINGS };
}

/**
 * Update auto-switch settings.
 */
export async function updateAutoSwitchSettings(
  updates: Partial<ClaudeAutoSwitchSettings>
): Promise<ClaudeAutoSwitchSettings> {
  return withLock(async () => {
    const storage = await loadProfileStorage();

    if (!storage.autoSwitchSettings) {
      storage.autoSwitchSettings = { ...DEFAULT_AUTO_SWITCH_SETTINGS };
    }

    // Validate thresholds
    if (updates.proactiveThresholdSession !== undefined) {
      if (updates.proactiveThresholdSession < 0.5 || updates.proactiveThresholdSession > 1.0) {
        throw new ProfileStorageError(
          'Session threshold must be between 0.5 and 1.0',
          'INVALID_INPUT'
        );
      }
    }
    if (updates.proactiveThresholdWeekly !== undefined) {
      if (updates.proactiveThresholdWeekly < 0.5 || updates.proactiveThresholdWeekly > 1.0) {
        throw new ProfileStorageError(
          'Weekly threshold must be between 0.5 and 1.0',
          'INVALID_INPUT'
        );
      }
    }
    if (updates.maxSwapsPerSession !== undefined) {
      if (updates.maxSwapsPerSession < 0 || updates.maxSwapsPerSession > 10) {
        throw new ProfileStorageError(
          'Max swaps per session must be between 0 and 10',
          'INVALID_INPUT'
        );
      }
    }

    // Apply updates
    Object.assign(storage.autoSwitchSettings, updates);

    await saveProfileStorage(storage);
    return storage.autoSwitchSettings;
  });
}

/**
 * Record auth failure for cooldown tracking.
 */
export async function recordAuthFailure(profileId: string): Promise<void> {
  return withLock(async () => {
    const storage = await loadProfileStorage();
    const profile = storage.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new ProfileStorageError('Profile not found', 'NOT_FOUND', { profileId });
    }

    profile.lastAuthFailureAt = Date.now();
    await saveProfileStorage(storage);
  });
}

/**
 * Check if a profile is in auth failure cooldown (5 minutes).
 */
export function isInAuthCooldown(profile: ClaudeProfile): boolean {
  if (!profile.lastAuthFailureAt) return false;
  const cooldownMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() < profile.lastAuthFailureAt + cooldownMs;
}
