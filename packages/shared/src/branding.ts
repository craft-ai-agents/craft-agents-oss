/**
 * Centralized branding assets for Runner
 * Used by OAuth callback pages
 */

export const RUNNER_WORDMARK = [
  '██████  ██    ██ ███    ██ ███    ██ ███████ ██████',
  '██   ██ ██    ██ ████   ██ ████   ██ ██      ██   ██',
  '██████  ██    ██ ██ ██  ██ ██ ██  ██ █████   ██████',
  '██   ██ ██    ██ ██  ██ ██ ██  ██ ██ ██      ██   ██',
  '██   ██  ██████  ██   ████ ██   ████ ███████ ██   ██',
] as const;

/** Wordmark as a single string for HTML templates */
export const RUNNER_WORDMARK_HTML = RUNNER_WORDMARK.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL = 'https://github.com/findmikeymike/RunnerOS';
