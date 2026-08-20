import { existsSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';
import { CONFIG_DIR } from './paths.ts';
import { readJsonFileSync } from '../utils/files.ts';
import {
  DEFAULT_LANGUAGE_CODE,
  isSupportedLanguageCode,
} from '../i18n/languages.ts';
import { LOCALE_REGISTRY, type LanguageCode } from '../i18n/registry.ts';

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

export interface UserPreferences {
  name?: string;
  /** Stable local user id (UUID). Generated once on first ensure. */
  userId?: string;
  /** Optional handle used for org invites */
  username?: string;
  /** Optional email used for org invites */
  email?: string;
  timezone?: string;
  location?: UserLocation;
  // Free-form notes the agent learns about the user
  notes?: string;
  // Diff viewer display preferences
  diffViewer?: DiffViewerPreferences;
  // Whether to include Co-Authored-By trailer on git commits (default: true)
  includeCoAuthoredBy?: boolean;
  /**
   * Internal: persisted UI language code (mirrors Appearance → Language).
   * Maintained only by the main-process `i18n:changeLanguage` IPC handler.
   * Missing or unsupported persisted values resolve to the Russian default.
   * Not user-editable; not exposed via the `update_user_preferences` tool.
   */
  uiLanguage?: LanguageCode;
  // When the preferences were last updated
  updatedAt?: number;
}

/** Local identity fields used by orgs / profile (never empty userId after ensure). */
export interface LocalUserIdentity {
  userId: string;
  username?: string;
  email?: string;
  name?: string;
}

const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

export function loadPreferences(): UserPreferences {
  try {
    if (!existsSync(PREFERENCES_FILE)) {
      return {};
    }
    const raw = readJsonFileSync<UserPreferences & { language?: unknown }>(PREFERENCES_FILE);
    // Scrub legacy free-text `language` field on read so it never leaks
    // back into a write. Old values were free-text ("Hungarian", "English") —
    // not language codes — so we drop them rather than migrate.
    if (raw && typeof raw === 'object' && 'language' in raw) {
      delete (raw as { language?: unknown }).language;
    }
    return raw;
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
  };
  savePreferences(updated);
  return updated;
}

/**
 * Ensure preferences.json has a stable local `userId` (UUID v4).
 * Generates once and persists; never overwrites an existing userId.
 * Also fills username from name when username is absent (non-destructive).
 */
export function ensureLocalUserIdentity(): LocalUserIdentity {
  const current = loadPreferences();
  let changed = false;
  let userId = typeof current.userId === 'string' ? current.userId.trim() : '';
  if (!userId) {
    userId = randomUUID();
    current.userId = userId;
    changed = true;
  }
  // Seed username from display name once so invite flows have a handle.
  if (!current.username && typeof current.name === 'string' && current.name.trim()) {
    const seed = current.name
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (seed) {
      current.username = seed;
      changed = true;
    }
  }
  if (changed) savePreferences(current);
  return {
    userId,
    username: current.username,
    email: current.email,
    name: current.name,
  };
}

export function getPreferencesPath(): string {
  return PREFERENCES_FILE;
}

/**
 * Resolve the persisted UI language against the supported registry.
 *
 * An explicit supported choice wins. Missing, legacy, or unsupported values
 * resolve to the Russian default without rewriting unrelated user data.
 */
export function getPersistedUiLanguage(): LanguageCode {
  const candidate = loadPreferences().uiLanguage;
  return isSupportedLanguageCode(candidate)
    ? candidate
    : DEFAULT_LANGUAGE_CODE;
}

/**
 * Persist the UI language code. Idempotent — does not rewrite the file
 * (or bump `updatedAt`) when the value is unchanged. This avoids re-triggering
 * the config watcher on startup syncs and duplicate IPC calls.
 */
export function setPersistedUiLanguage(code: LanguageCode): void {
  const current = loadPreferences();
  if (current.uiLanguage === code) return;
  savePreferences({ ...current, uiLanguage: code });
}

/**
 * Native-language name to request for AI-generated session titles.
 *
 * Uses the same persisted UI-language resolution as app startup, so fresh and
 * invalid configurations consistently use the Russian default.
 */
export function resolveTitleLanguageName(): string {
  return LOCALE_REGISTRY[getPersistedUiLanguage()].nativeName;
}

/**
 * Format preferences for inclusion in system prompt
 */
export function formatPreferencesForPrompt(): string {
  const prefs = loadPreferences();

  // Derive language from the persisted Appearance → Language choice.
  const langCode = getPersistedUiLanguage();
  const langName = LOCALE_REGISTRY[langCode].nativeName;

  if (Object.keys(prefs).length === 0 ||
      (!prefs.name && !prefs.timezone && !prefs.location && !prefs.notes && langCode === 'en')) {
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

  // Always include language so the AI knows which language to respond in.
  lines.push(`- Preferred language: ${langName}`);

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
  const hasNotes = !!prefs.notes;
  const hasAnyPrefs = hasName || hasTimezone || hasLocation || hasNotes;

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

    const displayLangCode = getPersistedUiLanguage();
    const displayLangName = LOCALE_REGISTRY[displayLangCode].nativeName;
    lines.push(`- Language: ${displayLangName} (via Appearance settings)`);

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

/**
 * Whether the Co-Authored-By trailer should be included on git commits.
 * Defaults to true when the preference is not explicitly set.
 */
export function getCoAuthorPreference(): boolean {
  const prefs = loadPreferences();
  return prefs.includeCoAuthoredBy !== false;
}
