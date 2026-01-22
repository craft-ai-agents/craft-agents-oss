/**
 * Centralized branding assets for Vesper
 * The golden hour where AI Companions work tirelessly into the night
 * while Humans do the Orchestration and Creative Thinking.
 *
 * Used by OAuth callback pages
 */

export const VESPER_LOGO = [
  '██╗   ██╗███████╗███████╗██████╗ ███████╗██████╗ ',
  '██║   ██║██╔════╝██╔════╝██╔══██╗██╔════╝██╔══██╗',
  '██║   ██║█████╗  ███████╗██████╔╝█████╗  ██████╔╝',
  '╚██╗ ██╔╝██╔══╝  ╚════██║██╔═══╝ ██╔══╝  ██╔══██╗',
  ' ╚████╔╝ ███████╗███████║██║     ███████╗██║  ██║',
  '  ╚═══╝  ╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝',
] as const;

/** Logo as a single string for HTML templates */
export const VESPER_LOGO_HTML = VESPER_LOGO.map((line) => line.trimEnd()).join('\n');

// Legacy exports for backward compatibility
export const CRAFT_LOGO = VESPER_LOGO;
export const CRAFT_LOGO_HTML = VESPER_LOGO_HTML;

/** Session viewer base URL */
export const VIEWER_URL = 'https://agents.craft.do';
