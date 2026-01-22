/**
 * System Theme Types
 */

import type { ThemeFile } from '../theme.ts';

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
