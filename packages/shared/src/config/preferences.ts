import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';
import { CONFIG_DIR } from './paths.ts';

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
}

/**
 * Diff viewer display preferences
 * Persisted to preferences.json as a user-level setting
 */
export interface DiffViewerPreferences {
  /** Diff layout: 'unified' (stacked) or 'split' (side-by-side) */
  diffStyle?: 'unified' | 'split';
  /** Whether to disable background highlighting on changed lines */
  disableBackground?: boolean;
}

/**
 * Auto new chat settings
 * When the app comes to foreground after being idle for a period,
 * automatically start a new conversation instead of resuming the last one.
 */
export interface AutoNewChatSettings {
  /** Whether auto new chat is enabled (default: false) */
  enabled?: boolean;
  /** Idle timeout in minutes before auto-creating new chat (default: 10) */
  idleTimeoutMinutes?: number;
}

/**
 * Global shortcut settings for activating the app
 * The shortcut brings the app to foreground when pressed
 */
export interface GlobalShortcutSettings {
  /** Whether global shortcut is enabled (default: false) */
  enabled?: boolean;
  /** The shortcut accelerator (e.g., 'CommandOrControl+Shift+Space') */
  shortcut?: string;
}

export interface UserPreferences {
  name?: string;
  timezone?: string;
  location?: UserLocation;
  language?: string;
  // Free-form notes the agent learns about the user
  notes?: string;
  // Diff viewer display preferences
  diffViewer?: DiffViewerPreferences;
  // Auto new chat settings
  autoNewChat?: AutoNewChatSettings;
  // Global shortcut settings for activating the app
  globalShortcut?: GlobalShortcutSettings;
  // When the preferences were last updated
  updatedAt?: number;
}

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
    // Merge diffViewer if provided
    diffViewer: updates.diffViewer
      ? { ...current.diffViewer, ...updates.diffViewer }
      : current.diffViewer,
    // Merge autoNewChat if provided
    autoNewChat: updates.autoNewChat
      ? { ...current.autoNewChat, ...updates.autoNewChat }
      : current.autoNewChat,
    // Merge globalShortcut if provided
    globalShortcut: updates.globalShortcut
      ? { ...current.globalShortcut, ...updates.globalShortcut }
      : current.globalShortcut,
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

  const lines: string[] = ['## User Preferences - User has explicitly set these preferences, so adhere to them', ''];

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

  const lines: string[] = ['**Your Preferences**', ''];

  // Check if any preferences are actually set
  const hasName = !!prefs.name;
  const hasTimezone = !!prefs.timezone;
  const hasLocation = prefs.location && (prefs.location.city || prefs.location.region || prefs.location.country);
  const hasLanguage = !!prefs.language;
  const hasNotes = !!prefs.notes;
  const hasAnyPrefs = hasName || hasTimezone || hasLocation || hasLanguage || hasNotes;

  lines.push('Your preferences help personalise your experience. The assistant uses these to provide more relevant responses (e.g., timezone for scheduling, language for communication).');
  lines.push('');

  if (!hasAnyPrefs) {
    lines.push('**Status:** Nothing saved yet.');
    lines.push('');
  } else {
    lines.push(`- Name: ${prefs.name || '(not set)'}`);
    lines.push(`- Timezone: ${prefs.timezone || '(not set)'}`);

    if (hasLocation) {
      const loc = prefs.location!;
      const parts = [loc.city, loc.region, loc.country].filter(Boolean);
      lines.push(`- Location: ${parts.join(', ')}`);
    } else {
      lines.push('- Location: (not set)');
    }

    lines.push(`- Language: ${prefs.language || '(not set)'}`);

    if (hasNotes) {
      lines.push('', '**Notes**', prefs.notes!);
    }

    if (prefs.updatedAt) {
      lines.push('', `_Last updated: ${new Date(prefs.updatedAt).toLocaleString()}_`);
    }
    lines.push('');
  }

  lines.push('**How to update:** Just tell the assistant (e.g., "My name is Alex" or "I\'m in London, GMT timezone").');
  lines.push(`**Config file:** \`${PREFERENCES_FILE}\``);

  return lines.join('\n');
}
