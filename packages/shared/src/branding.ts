/**
 * Centralized branding assets for G4 OS
 * Used by OAuth callback pages
 */

export const G4OS_LOGO = [
  '  ██████  ██   ██       ██████  ███████',
  ' ██       ██   ██      ██    ██ ██     ',
  ' ██   ███ ███████      ██    ██ ███████',
  ' ██    ██      ██      ██    ██      ██',
  '  ██████       ██       ██████  ███████',
] as const;

/** Logo as a single string for HTML templates */
export const G4OS_LOGO_HTML = G4OS_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL = 'https://g4os-viewer.pages.dev';

/** Base URL for release artifacts (served via Cloudflare Pages + R2) */
export const RELEASES_URL = 'https://g4os-viewer.pages.dev/electron';
