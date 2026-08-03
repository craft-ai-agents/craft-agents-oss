import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { OwnerProfile } from '@archstudio/core';
import { CONFIG_DIR } from '../config/paths.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { loadPreferences } from '../config/preferences.ts';
import { DEFAULT_OWNER_PROFILE, validateOwnerProfile } from './schema.ts';
import { migratePreferencesToOwnerProfile } from './migrations.ts';

const OWNER_PROFILE_FILE = join(CONFIG_DIR, 'owner-profile.json');

/**
 * Ensures the configuration directory exists.
 */
function ensureConfigDir(): void {
  const { ensureConfigDir: ensureDir } = require('../config/storage.ts');
  ensureDir();
}

/**
 * Loads the owner profile. If it doesn't exist, attempts to migrate
 * from legacy preferences.json, otherwise falls back to the default profile.
 */
export function loadOwnerProfile(): OwnerProfile {
  try {
    if (existsSync(OWNER_PROFILE_FILE)) {
      const raw = readJsonFileSync<unknown>(OWNER_PROFILE_FILE);
      return validateOwnerProfile(raw);
    }

    // Try migrating from legacy preferences
    const legacyPrefs = loadPreferences();
    if (legacyPrefs && (legacyPrefs.name || legacyPrefs.timezone || legacyPrefs.uiLanguage)) {
      const migrated = migratePreferencesToOwnerProfile(legacyPrefs);
      saveOwnerProfile(migrated);
      return migrated;
    }

    // Write and return default profile
    saveOwnerProfile(DEFAULT_OWNER_PROFILE);
    return DEFAULT_OWNER_PROFILE;
  } catch (error) {
    console.error('Failed to load owner profile, returning default:', error);
    return DEFAULT_OWNER_PROFILE;
  }
}

/**
 * Saves the owner profile after schema validation.
 */
export function saveOwnerProfile(profile: OwnerProfile): void {
  ensureConfigDir();
  const validated = validateOwnerProfile(profile);
  validated.updatedAt = Date.now();
  writeFileSync(OWNER_PROFILE_FILE, JSON.stringify(validated, null, 2), 'utf-8');
}

/**
 * Updates the owner profile by merging partial changes, keeping nested properties intact.
 */
export function updateOwnerProfile(updates: Partial<OwnerProfile>): OwnerProfile {
  const current = loadOwnerProfile();
  
  const updated: OwnerProfile = {
    ...current,
    identity: updates.identity 
      ? { ...current.identity, ...updates.identity }
      : current.identity,
    communication: updates.communication
      ? { ...current.communication, ...updates.communication }
      : current.communication,
    execution: updates.execution
      ? { ...current.execution, ...updates.execution }
      : current.execution,
    paths: updates.paths
      ? { ...current.paths, ...updates.paths }
      : current.paths,
    privacy: updates.privacy
      ? { ...current.privacy, ...updates.privacy }
      : current.privacy,
  };

  saveOwnerProfile(updated);
  return updated;
}

export function getOwnerProfilePath(): string {
  return OWNER_PROFILE_FILE;
}
