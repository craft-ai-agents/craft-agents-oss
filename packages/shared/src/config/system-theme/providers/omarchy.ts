/**
 * Omarchy Theme Provider
 *
 * Reads theme colors from omarchy's current theme directory and converts
 * them to the craft-agent theme format for seamless desktop integration.
 *
 * Omarchy stores theme data at:
 * - ~/.config/omarchy/current/theme.name - Theme name (e.g., "flexoki-light")
 * - ~/.config/omarchy/current/theme/colors.toml - Color definitions
 * - ~/.config/omarchy/current/theme/light.mode - Light/dark mode indicator
 */

import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ThemeFile, ThemeOverrides, PresetTheme } from '../../theme.ts';
import { loadPresetThemes } from '../../storage.ts';
import type { SystemThemeProvider, SystemThemeChangeCallback } from '../types.ts';

// Omarchy configuration paths
const OMARCHY_CONFIG_DIR = join(homedir(), '.config', 'omarchy');
const OMARCHY_CURRENT_DIR = join(OMARCHY_CONFIG_DIR, 'current');
const OMARCHY_THEME_NAME_FILE = join(OMARCHY_CURRENT_DIR, 'theme.name');
const OMARCHY_THEME_DIR = join(OMARCHY_CURRENT_DIR, 'theme');
const OMARCHY_COLORS_FILE = join(OMARCHY_THEME_DIR, 'colors.toml');
const OMARCHY_LIGHT_MODE_FILE = join(OMARCHY_THEME_DIR, 'light.mode');

/**
 * Parsed omarchy colors from colors.toml
 */
interface OmarchyColors {
  accent?: string;
  cursor?: string;
  foreground?: string;
  background?: string;
  selection_foreground?: string;
  selection_background?: string;
  // ANSI colors (color0-color15)
  color0?: string;  // black
  color1?: string;  // red
  color2?: string;  // green
  color3?: string;  // yellow
  color4?: string;  // blue
  color5?: string;  // magenta
  color6?: string;  // cyan
  color7?: string;  // white
  color8?: string;  // bright black
  color9?: string;  // bright red
  color10?: string; // bright green
  color11?: string; // bright yellow
  color12?: string; // bright blue
  color13?: string; // bright magenta
  color14?: string; // bright cyan
  color15?: string; // bright white
}

/**
 * Parse a simple TOML file with key = "value" format
 * (Omarchy's colors.toml uses this simple format)
 */
function parseSimpleToml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match key = "value" or key = 'value'
    const match = trimmed.match(/^(\w+)\s*=\s*["']([^"']+)["']\s*$/);
    if (match) {
      result[match[1]!] = match[2]!;
    }
  }

  return result;
}

/**
 * Load omarchy colors from colors.toml
 */
function loadOmarchyColors(): OmarchyColors | null {
  if (!existsSync(OMARCHY_COLORS_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(OMARCHY_COLORS_FILE, 'utf-8');
    return parseSimpleToml(content) as OmarchyColors;
  } catch {
    return null;
  }
}

/**
 * Get the current omarchy theme name
 */
function getOmarchyThemeName(): string | null {
  if (!existsSync(OMARCHY_THEME_NAME_FILE)) {
    return null;
  }

  try {
    return readFileSync(OMARCHY_THEME_NAME_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Parse a hex color and return its luminance (0-1).
 * Uses the relative luminance formula for sRGB.
 */
function getColorLuminance(hex: string): number {
  // Remove # prefix if present
  const cleanHex = hex.replace(/^#/, '');
  if (cleanHex.length !== 6) return 0.5;

  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  // Simplified luminance (good enough for light/dark detection)
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Check if the current omarchy theme is light mode.
 * First checks the light.mode file, then falls back to analyzing background color.
 */
function isOmarchyLightMode(): boolean {
  // First, check the light.mode file if it exists
  if (existsSync(OMARCHY_LIGHT_MODE_FILE)) {
    try {
      const content = readFileSync(OMARCHY_LIGHT_MODE_FILE, 'utf-8');
      // File typically contains "prefer-light" or similar
      return content.toLowerCase().includes('light');
    } catch {
      // Fall through to color analysis
    }
  }

  // Fall back to analyzing the background color
  const colors = loadOmarchyColors();
  if (colors?.background) {
    const luminance = getColorLuminance(colors.background);
    // If luminance > 0.5, it's a light background
    return luminance > 0.5;
  }

  // Default to light mode if we can't determine
  return true;
}

/**
 * Check if omarchy theme is available on this system
 */
function isOmarchyAvailable(): boolean {
  return existsSync(OMARCHY_CURRENT_DIR) && existsSync(OMARCHY_COLORS_FILE);
}

/**
 * Normalize a theme name for comparison.
 * Converts to lowercase and replaces spaces with hyphens.
 * This allows matching "Rose Pine" with "rose-pine", "Tokyo Night" with "tokyo-night", etc.
 */
function normalizeThemeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Find a matching preset theme for the given omarchy theme name.
 * Matches by:
 * 1. Exact ID match (case-insensitive, spaces → hyphens)
 * 2. Exact name match (case-insensitive, spaces → hyphens)
 * 3. Prefix match - omarchy theme starts with preset ID (e.g., "catppuccin-latte" matches "catppuccin")
 *
 * @returns The matching preset theme, or null if no match found
 */
function findMatchingPresetTheme(omarchyThemeName: string): PresetTheme | null {
  const presetThemes = loadPresetThemes();
  if (presetThemes.length === 0) {
    return null;
  }

  const nameNormalized = normalizeThemeName(omarchyThemeName);

  // First try exact ID match (IDs are already kebab-case)
  let match = presetThemes.find(p => p.id.toLowerCase() === nameNormalized);
  if (match) return match;

  // Then try exact name match (normalize both sides)
  match = presetThemes.find(p => {
    const presetName = p.theme.name;
    return presetName && normalizeThemeName(presetName) === nameNormalized;
  });
  if (match) return match;

  // Then try prefix match (omarchy name starts with preset ID)
  // Sort by ID length descending to prefer longer matches (e.g., "catppuccin-mocha" over "catppuccin")
  const sortedByIdLength = [...presetThemes].sort((a, b) => b.id.length - a.id.length);
  match = sortedByIdLength.find(p => nameNormalized.startsWith(p.id.toLowerCase()));
  if (match) return match;

  // Also try prefix match with preset name (normalize both sides)
  match = sortedByIdLength.find(p => {
    const presetName = p.theme.name;
    return presetName && nameNormalized.startsWith(normalizeThemeName(presetName));
  });
  if (match) return match;

  return null;
}

/**
 * Convert omarchy colors to craft-agent theme format.
 *
 * First checks if the omarchy theme name matches a Craft Agents preset theme.
 * If a match is found, returns the preset theme for better color accuracy.
 * Otherwise, extracts colors from omarchy's colors.toml.
 */
function loadOmarchyTheme(): ThemeFile | null {
  if (!isOmarchyAvailable()) {
    return null;
  }

  const themeName = getOmarchyThemeName() || 'System';

  // Check if omarchy theme name matches a Craft Agents preset theme
  const matchingPreset = findMatchingPresetTheme(themeName);
  if (matchingPreset) {
    const isLight = isOmarchyLightMode();
    // Return the preset theme with updated metadata
    // Override supportedModes to match omarchy's current light/dark mode
    // This ensures the app uses the correct mode for the matched preset
    return {
      ...matchingPreset.theme,
      name: themeName,
      description: `System theme (using ${matchingPreset.theme.name || matchingPreset.id} preset)`,
      supportedModes: [isLight ? 'light' : 'dark'],
    };
  }

  // No matching preset found - extract colors from omarchy
  const colors = loadOmarchyColors();
  if (!colors) {
    return null;
  }

  const isLight = isOmarchyLightMode();

  // Map omarchy colors to craft-agent theme colors
  // Use ANSI colors for semantic meanings:
  // - color1 (red) → destructive
  // - color2 (green) → success
  // - color3 (yellow) → info
  // - accent → accent (or fall back to color4/blue)

  const themeColors: ThemeOverrides = {
    background: colors.background,
    foreground: colors.foreground,
    accent: colors.accent || colors.color4, // accent or blue
    info: colors.color3,      // yellow
    success: colors.color2,   // green
    destructive: colors.color1, // red
  };

  // For light themes, the light colors are primary
  // For dark themes, we need to set up the dark overrides
  if (isLight) {
    // Light theme: colors are already correct for light mode
    // Dark mode would need inverted colors (not available from omarchy single theme)
    return {
      name: themeName,
      description: `Synced from omarchy (${themeName})`,
      author: 'omarchy',
      supportedModes: ['light'],
      shikiTheme: {
        light: 'github-light',
        dark: 'github-dark',
      },
      ...themeColors,
    };
  } else {
    // Dark theme: colors are for dark mode
    return {
      name: themeName,
      description: `Synced from omarchy (${themeName})`,
      author: 'omarchy',
      supportedModes: ['dark'],
      shikiTheme: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // Set light mode to defaults (theme only supports dark)
      background: '#faf9fb',
      foreground: '#1a1625',
      accent: colors.accent || colors.color4,
      info: '#d97706',
      success: '#16a34a',
      destructive: '#dc2626',
      // Dark mode uses the omarchy colors
      dark: themeColors,
    };
  }
}

/**
 * Watch for omarchy theme changes
 * Returns a cleanup function to stop watching
 */
function watchOmarchyTheme(callback: SystemThemeChangeCallback): () => void {
  if (!isOmarchyAvailable()) {
    return () => {};
  }

  const watchers: FSWatcher[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  const notifyChange = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      const theme = loadOmarchyTheme();
      callback(theme);
    }, 100);
  };

  // Watch the current theme directory for changes
  try {
    // Watch theme.name file
    if (existsSync(OMARCHY_THEME_NAME_FILE)) {
      const watcher = watch(OMARCHY_CURRENT_DIR, (_, filename) => {
        if (filename === 'theme.name') {
          notifyChange();
        }
      });
      watchers.push(watcher);
    }

    // Watch theme directory (colors.toml, light.mode, etc.)
    if (existsSync(OMARCHY_THEME_DIR)) {
      const watcher = watch(OMARCHY_THEME_DIR, (_, filename) => {
        if (filename === 'colors.toml' || filename === 'light.mode') {
          notifyChange();
        }
      });
      watchers.push(watcher);
    }
  } catch {
    // Ignore watch errors
  }

  // Return cleanup function
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

/**
 * Omarchy theme provider
 */
export const omarchyProvider: SystemThemeProvider = {
  name: 'omarchy',
  isAvailable: isOmarchyAvailable,
  loadTheme: loadOmarchyTheme,
  watch: watchOmarchyTheme,
};
