import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_OWNER_PROFILE } from '../schema.ts';

// Set the override before importing modules that capture CONFIG_DIR at load time.
// These tests must never read, delete, or restore a developer's real profile.
const TEST_CONFIG_DIR = mkdtempSync(join(process.cwd(), '.owner-profile-test-'));
process.env.CRAFT_CONFIG_DIR = TEST_CONFIG_DIR;

const { CONFIG_DIR } = await import('../../config/paths.ts');
const { loadOwnerProfile, saveOwnerProfile, updateOwnerProfile, getOwnerProfilePath } =
  await import('../storage.ts');

const OWNER_PROFILE_FILE = getOwnerProfilePath();
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

describe('owner profile storage and migration', () => {
  beforeEach(() => {
    if (existsSync(OWNER_PROFILE_FILE)) {
      unlinkSync(OWNER_PROFILE_FILE);
    }
    if (existsSync(PREFERENCES_FILE)) {
      unlinkSync(PREFERENCES_FILE);
    }
  });

  afterAll(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    delete process.env.CRAFT_CONFIG_DIR;
  });

  function readFileSyncSafe(path: string): string {
    const fs = require('fs');
    return fs.readFileSync(path, 'utf-8');
  }

  it('loads default owner profile when no files exist', () => {
    const profile = loadOwnerProfile();
    expect(profile.identity.name).toBe('Skobez');
    expect(profile.communication.verbosity).toBe(3);
    expect(profile.execution.defaultMode).toBe('owner-auto');
    expect(existsSync(OWNER_PROFILE_FILE)).toBe(true);
  });

  it('saves and loads configured owner profile text correctly', () => {
    const custom = {
      ...DEFAULT_OWNER_PROFILE,
      identity: {
        name: 'Richard',
        aliases: ['Richard'],
        locale: 'hu',
        timezone: 'CET',
      },
    };
    saveOwnerProfile(custom);
    const loaded = loadOwnerProfile();
    expect(loaded.identity.name).toBe('Richard');
    expect(loaded.identity.locale).toBe('hu');
    expect(loaded.identity.timezone).toBe('CET');
  });

  it('migrates name, timezone, and uiLanguage from legacy preferences.json', () => {
    const legacyPrefs = {
      name: 'SkobezLocal',
      timezone: 'Europe/Budapest',
      uiLanguage: 'pl',
    };
    writeFileSync(PREFERENCES_FILE, JSON.stringify(legacyPrefs, null, 2), 'utf-8');

    const loaded = loadOwnerProfile();
    // Verify migration
    expect(loaded.identity.name).toBe('SkobezLocal');
    expect(loaded.identity.timezone).toBe('Europe/Budapest');
    expect(loaded.identity.locale).toBe('pl');
    expect(loaded.identity.aliases).toContain('SkobezLocal');

    // Should also verify that preferences.json still exists and was not deleted/modified
    expect(existsSync(PREFERENCES_FILE)).toBe(true);
    const originalPrefsParsed = JSON.parse(readFileSyncSafe(PREFERENCES_FILE));
    expect(originalPrefsParsed.name).toBe('SkobezLocal');
  });

  it('safely updates profile fields using updateOwnerProfile', () => {
    // Generate default profile first
    loadOwnerProfile();
    
    updateOwnerProfile({
      identity: {
        name: 'NewName',
        aliases: ['NewName', 'Alt'],
        locale: 'en',
        timezone: 'UTC',
      },
      communication: {
        tone: 'highly sarcastic',
        verbosity: 1,
        bannedPhrases: ['None'],
      }
    });

    const loaded = loadOwnerProfile();
    expect(loaded.identity.name).toBe('NewName');
    expect(loaded.communication.verbosity).toBe(1);
    expect(loaded.communication.tone).toBe('highly sarcastic');
    // Ensure nested fields that were not updated (like execution mode) are preserved
    expect(loaded.execution.defaultMode).toBe('owner-auto');
  });
});
