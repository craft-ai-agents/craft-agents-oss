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

import type { ThemeFile } from '../theme.ts';
import type { SystemThemeProvider, SystemThemeChangeCallback } from './types.ts';
import { omarchyProvider } from './providers/omarchy.ts';

// Re-export types
export type { SystemThemeProvider, SystemThemeChangeCallback } from './types.ts';

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
