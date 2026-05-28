/**
 * Centralized branding assets for MDP
 * Used by OAuth callback pages
 */

export const MDP_LOGO = [
  '██       ██ ███████    ██████████',
  '████   ████ ████   ███ ████    ██',
  '██ ██ ██ ██ ████    ██ ██████████',
  '██  ███  ██ ████   ███ ████      ',
  '██       ██ ███████    ████      ',
] as const;

/** Logo as a single string for HTML templates */
export const MDP_LOGO_HTML = MDP_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL = 'https://agents.craft.do';
