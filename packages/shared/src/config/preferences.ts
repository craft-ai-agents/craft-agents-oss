import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';
import { CONFIG_DIR } from './paths.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { i18n, SUPPORTED_LANGUAGE_CODES } from '../i18n/index.ts';
import { LOCALE_REGISTRY, type LanguageCode } from '../i18n/registry.ts';
import { sanitizePromptBody, sanitizePromptLine } from '../prompts/prompt-sanitize.ts';

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
   * Not user-editable; not exposed via the `update_user_preferences` tool.
   */
  uiLanguage?: LanguageCode;
  /**
   * Internal: default zoom for app windows in percent (Appearance → Default zoom).
   * Maintained only by the Electron main process (`zoom:setDefault` IPC); a per-device
   * display setting, so it lives here and never on a remote server. Not exposed to the agent.
   */
  defaultZoomLevel?: number;
  /**
   * Internal: Crafty, the system-wide helper (Settings → App → Crafty; macOS, desktop only).
   * A per-device switch maintained by the Electron main process (`crafty:setEnabled` IPC), so it
   * lives here and never on a remote server. Not exposed to the agent. Default off.
   */
  craftyEnabled?: boolean;
  /**
   * Internal: the session Crafty sends to ("Send Crafty here"), per device like `craftyEnabled`.
   * Unset means a new session for each question. Maintained by the Electron main process.
   */
  craftyTarget?: { workspaceId: string; sessionId: string };
  /**
   * Internal: how Crafty opens, per device like `craftyEnabled` (Settings → App → Crafty).
   * `craftyDoubleTap` is the left modifier whose double-tap opens it, or 'off' to leave only
   * ⌃⌥Space (default 'command'). `craftyOpenWith` is what opens: the pie or the panel (default
   * 'pie'). Maintained by the Electron main process.
   */
  craftyDoubleTap?: CraftyDoubleTap;
  craftyOpenWith?: CraftyOpenWith;
  /**
   * Internal: the pie's recent Translate languages (BCP 47, most recent first), so the sub-pie
   * leads with them. Maintained by the Electron main process.
   */
  craftyRecentLanguages?: string[];
  // When the preferences were last updated
  updatedAt?: number;
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

export function getPreferencesPath(): string {
  return PREFERENCES_FILE;
}

/**
 * Read the persisted UI language code (validated against the supported set).
 * Returns `undefined` when the field is missing or holds an unrecognised value.
 */
export function getPersistedUiLanguage(): LanguageCode | undefined {
  const prefs = loadPreferences();
  const candidate = prefs.uiLanguage;
  if (!candidate) return undefined;
  if (!SUPPORTED_LANGUAGE_CODES.includes(candidate)) return undefined;
  return candidate;
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

/** The stored default zoom percentage, if any (callers snap it to the offered choices). */
export function getPersistedDefaultZoomLevel(): number | undefined {
  const level = loadPreferences().defaultZoomLevel;
  return typeof level === 'number' && Number.isFinite(level) ? level : undefined;
}

export function setPersistedDefaultZoomLevel(level: number): void {
  const current = loadPreferences();
  if (current.defaultZoomLevel === level) return;
  savePreferences({ ...current, defaultZoomLevel: level });
}

/** Whether Crafty is switched on for this device (default off). */
export function getPersistedCraftyEnabled(): boolean {
  return loadPreferences().craftyEnabled === true;
}

export function setPersistedCraftyEnabled(enabled: boolean): void {
  const current = loadPreferences();
  if ((current.craftyEnabled === true) === enabled) return;
  savePreferences({ ...current, craftyEnabled: enabled });
}

export type CraftyDoubleTap = 'command' | 'option' | 'control' | 'off';
export type CraftyOpenWith = 'pie' | 'panel';
export const CRAFTY_DOUBLE_TAP_VALUES: readonly CraftyDoubleTap[] = ['command', 'option', 'control', 'off'];
export const CRAFTY_OPEN_WITH_VALUES: readonly CraftyOpenWith[] = ['pie', 'panel'];

/** The left modifier whose double-tap opens Crafty, or 'off' (default the left ⌘). */
export function getPersistedCraftyDoubleTap(): CraftyDoubleTap {
  const value = loadPreferences().craftyDoubleTap;
  return value && CRAFTY_DOUBLE_TAP_VALUES.includes(value) ? value : 'command';
}

export function setPersistedCraftyDoubleTap(value: CraftyDoubleTap): void {
  const current = loadPreferences();
  if (current.craftyDoubleTap === value) return;
  savePreferences({ ...current, craftyDoubleTap: value });
}

/** What Crafty's triggers open (default the pie). */
export function getPersistedCraftyOpenWith(): CraftyOpenWith {
  return loadPreferences().craftyOpenWith === 'panel' ? 'panel' : 'pie';
}

export function setPersistedCraftyOpenWith(value: CraftyOpenWith): void {
  const current = loadPreferences();
  if (current.craftyOpenWith === value) return;
  savePreferences({ ...current, craftyOpenWith: value });
}

/** How many recent Translate languages the pie keeps. */
const CRAFTY_RECENT_LANGUAGES_MAX = 5;

/** The pie's recent Translate languages, most recent first. */
export function getPersistedCraftyRecentLanguages(): string[] {
  const value = loadPreferences().craftyRecentLanguages;
  return Array.isArray(value) ? value.filter(code => typeof code === 'string').slice(0, CRAFTY_RECENT_LANGUAGES_MAX) : [];
}

/** Put a language first in the pie's recent Translate languages. */
export function rememberCraftyLanguage(code: string): void {
  const current = loadPreferences();
  const recent = getPersistedCraftyRecentLanguages();
  if (recent[0] === code) return;
  const next = [code, ...recent.filter(c => c !== code)].slice(0, CRAFTY_RECENT_LANGUAGES_MAX);
  savePreferences({ ...current, craftyRecentLanguages: next });
}

/** The session Crafty sends to, or null for a new session each time. */
export function getPersistedCraftyTarget(): { workspaceId: string; sessionId: string } | null {
  const target = loadPreferences().craftyTarget;
  return target && typeof target.workspaceId === 'string' && typeof target.sessionId === 'string'
    ? { workspaceId: target.workspaceId, sessionId: target.sessionId }
    : null;
}

export function setPersistedCraftyTarget(target: { workspaceId: string; sessionId: string } | null): void {
  const current = loadPreferences();
  const stored = current.craftyTarget;
  if (stored?.workspaceId === target?.workspaceId && stored?.sessionId === target?.sessionId) return;
  const { craftyTarget: _previous, ...rest } = current;
  savePreferences(target ? { ...rest, craftyTarget: target } : rest);
}

/**
 * Native-language name to request for AI-generated session titles, or
 * `undefined` to let the model follow the conversation's own language.
 *
 * Resolves from the explicitly persisted UI language (disk-backed) rather than
 * `i18n.resolvedLanguage`, which in the main process hydrates asynchronously at
 * startup and can still read the `'en'` fallback when an early title fires
 * (#885). Returning `undefined` when no language was chosen lets the title
 * prompt auto-detect the conversation language instead of being forced to
 * English.
 */
export function resolveTitleLanguageName(): string | undefined {
  const code = getPersistedUiLanguage();
  return code ? LOCALE_REGISTRY[code]?.nativeName : undefined;
}

/**
 * Format preferences for inclusion in system prompt
 */
export function formatPreferencesForPrompt(): string {
  const prefs = loadPreferences();

  // Derive language from the app's i18n setting (Appearance > Language).
  const langCode = (i18n.resolvedLanguage ?? 'en') as LanguageCode;
  const langEntry = LOCALE_REGISTRY[langCode];
  const langName = langEntry?.nativeName ?? 'English';

  if (Object.keys(prefs).length === 0 ||
      (!prefs.name && !prefs.timezone && !prefs.location && !prefs.notes && langCode === 'en')) {
    return '';
  }

  const tags = ['user_preferences'] as const;
  const lines: string[] = [
    '<user_preferences>',
    'The user/app supplied these preferences. Follow them unless they conflict with higher-priority system, developer, tool, safety, or permission instructions.',
    '',
  ];

  if (prefs.name) {
    lines.push(`- Name: ${sanitizePromptLine(prefs.name, tags)}`);
  }

  if (prefs.timezone) {
    lines.push(`- Timezone: ${sanitizePromptLine(prefs.timezone, tags)}`);
  }

  if (prefs.location) {
    const loc = prefs.location;
    const parts = [loc.city, loc.region, loc.country].filter(Boolean).map((part) => sanitizePromptLine(part!, tags));
    if (parts.length > 0) {
      lines.push(`- Location: ${parts.join(', ')}`);
    }
  }

  // UI language is app state, not necessarily an explicitly saved user note.
  lines.push(`- Preferred response language (from app UI): ${sanitizePromptLine(langName, tags)}`);

  if (prefs.notes) {
    lines.push('', '### Notes about this user', sanitizePromptBody(prefs.notes, tags));
  }

  lines.push('</user_preferences>', '');
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

    const displayLangCode = (i18n.resolvedLanguage ?? 'en') as LanguageCode;
    const displayLangEntry = LOCALE_REGISTRY[displayLangCode];
    lines.push(`- Language: ${displayLangEntry?.nativeName ?? 'English'} (via Appearance settings)`);

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
