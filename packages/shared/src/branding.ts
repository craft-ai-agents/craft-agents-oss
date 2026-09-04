/**
 * Centralized branding assets for Jonwork
 * Used by OAuth callback pages
 */

export const CRAFT_LOGO = [
  '     ██  ██████  ███    ██ ██     ██  ██████  ██████  ██   ██',
  '     ██ ██    ██ ████   ██ ██     ██ ██    ██ ██   ██ ██  ██ ',
  '     ██ ██    ██ ██ ██  ██ ██  █  ██ ██    ██ ██████  █████  ',
  '██   ██ ██    ██ ██  ██ ██ ██ ███ ██ ██    ██ ██   ██ ██  ██ ',
  ' █████   ██████  ██   ████  ███ ███   ██████  ██   ██ ██   ██',
] as const;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = CRAFT_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export { requireShareServerUrl } from './deployment';
