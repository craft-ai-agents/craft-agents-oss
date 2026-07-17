/**
 * Centralized branding assets for Craft Agent
 * Used by OAuth callback pages
 */

export const CRAFT_LOGO = [
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      ██████  ',
  '  ████████ ████  ████ ████  ████ █████        ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = CRAFT_LOGO.map((line) => line.trimEnd()).join('\n');

/**
 * Session viewer base URL — where "Share Conversation" uploads transcripts and
 * mints share links. Defaults to the hosted viewer; set `CRAFT_VIEWER_URL` to
 * point at a self-hosted share server so shared sessions stay on your own infra.
 * Consumed server-side only (SessionManager, in the Node process).
 */
export const VIEWER_URL =
  (typeof process !== 'undefined' && process.env?.CRAFT_VIEWER_URL) ||
  'https://agents.craft.do';
