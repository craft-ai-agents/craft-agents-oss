import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
}

export interface UserPreferences {
  name?: string;
  timezone?: string;
  location?: UserLocation;
  language?: string;
  // Free-form notes the agent learns about the user
  notes?: string;
  // When the preferences were last updated
  updatedAt?: number;
}

const CONFIG_DIR = join(homedir(), '.craft-agent');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

export function loadPreferences(): UserPreferences {
  try {
    if (!existsSync(PREFERENCES_FILE)) {
      return {};
    }
    const content = readFileSync(PREFERENCES_FILE, 'utf-8');
    return JSON.parse(content) as UserPreferences;
  } catch {
    return {};
  }
}

export function savePreferences(prefs: UserPreferences): void {
  ensureConfigDir();
  prefs.updatedAt = Date.now();
  writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}

export function updatePreferences(updates: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences();
  const updated = {
    ...current,
    ...updates,
    // Merge location if provided
    location: updates.location
      ? { ...current.location, ...updates.location }
      : current.location,
  };
  savePreferences(updated);
  return updated;
}

export function getPreferencesPath(): string {
  return PREFERENCES_FILE;
}

/**
 * Format preferences for inclusion in system prompt
 */
export function formatPreferencesForPrompt(): string {
  const prefs = loadPreferences();

  if (Object.keys(prefs).length === 0 ||
      (!prefs.name && !prefs.timezone && !prefs.location && !prefs.language && !prefs.notes)) {
    return '';
  }

  const lines: string[] = ['## User Preferences', ''];

  if (prefs.name) {
    lines.push(`- Name: ${prefs.name}`);
  }

  if (prefs.timezone) {
    lines.push(`- Timezone: ${prefs.timezone}`);
  }

  if (prefs.location) {
    const loc = prefs.location;
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`- Location: ${parts.join(', ')}`);
    }
  }

  if (prefs.language) {
    lines.push(`- Preferred language: ${prefs.language}`);
  }

  if (prefs.notes) {
    lines.push('', '### Notes about this user', prefs.notes);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format preferences as readable text for display
 */
export function formatPreferencesDisplay(): string {
  const prefs = loadPreferences();

  if (Object.keys(prefs).length === 0) {
    return 'No preferences set yet. The assistant will learn about you over time, or you can set them manually.';
  }

  const lines: string[] = ['**User Preferences**', ''];

  lines.push(`- Name: ${prefs.name || '(not set)'}`);
  lines.push(`- Timezone: ${prefs.timezone || '(not set)'}`);

  const loc = prefs.location;
  if (loc && (loc.city || loc.region || loc.country)) {
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    lines.push(`- Location: ${parts.join(', ')}`);
  } else {
    lines.push('- Location: (not set)');
  }

  lines.push(`- Language: ${prefs.language || '(not set)'}`);

  if (prefs.notes) {
    lines.push('', '**Notes**', prefs.notes);
  }

  if (prefs.updatedAt) {
    lines.push('', `_Last updated: ${new Date(prefs.updatedAt).toLocaleString()}_`);
  }

  lines.push('', `Config file: \`${PREFERENCES_FILE}\``);

  return lines.join('\n');
}
