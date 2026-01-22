/**
 * System Theme Integration
 *
 * Provides a unified interface for system/desktop theme integration.
 * Currently supports:
 * - Omarchy (Linux) - reads theme from ~/.config/omarchy/current/theme/
 *
 * Additional providers can be added for:
 * - macOS system appearance
 * - Windows accent colors
 * - GNOME/KDE theme settings
 * - etc.
 */

import type { ThemeFile } from './theme.ts';
import * as omarchy from './omarchy-theme.ts';

/**
 * Callback type for theme change events
 */
export type SystemThemeChangeCallback = (theme: ThemeFile | null) => void;

/**
 * Interface for system theme providers
 */
export interface SystemThemeProvider {
  /** Check if this provider is available on the current system */
  isAvailable(): boolean;
  /** Load the current system theme */
  loadTheme(): ThemeFile | null;
  /** Watch for theme changes, returns cleanup function */
  watch(callback: SystemThemeChangeCallback): () => void;
  /** Get the provider name (for display/debugging) */
  name: string;
}

/**
 * Omarchy theme provider (Linux)
 */
const omarchyProvider: SystemThemeProvider = {
  name: 'omarchy',
  isAvailable: () => omarchy.isOmarchyAvailable(),
  loadTheme: () => omarchy.loadOmarchyTheme(),
  watch: (callback) => omarchy.watchOmarchyTheme(callback),
};

/**
 * List of available system theme providers, in priority order
 */
const providers: SystemThemeProvider[] = [
  omarchyProvider,
  // Add more providers here in the future:
  // macosProvider,
  // gnomeProvider,
  // kdeProvider,
  // windowsProvider,
];

/**
 * Get the first available system theme provider
 */
function getActiveProvider(): SystemThemeProvider | null {
  for (const provider of providers) {
    if (provider.isAvailable()) {
      return provider;
    }
  }
  return null;
}

/**
 * Check if any system theme provider is available
 */
export function isSystemThemeAvailable(): boolean {
  return getActiveProvider() !== null;
}

/**
 * Load the current system theme from the active provider
 */
export function loadSystemTheme(): ThemeFile | null {
  const provider = getActiveProvider();
  if (!provider) {
    return null;
  }
  return provider.loadTheme();
}

/**
 * Watch for system theme changes
 * Returns a cleanup function to stop watching
 */
export function watchSystemTheme(callback: SystemThemeChangeCallback): () => void {
  const provider = getActiveProvider();
  if (!provider) {
    return () => {};
  }
  return provider.watch(callback);
}

/**
 * Get the name of the active system theme provider
 */
export function getSystemThemeProviderName(): string | null {
  const provider = getActiveProvider();
  return provider?.name ?? null;
}
