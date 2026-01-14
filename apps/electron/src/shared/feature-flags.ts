/**
 * Feature flags for controlling experimental or in-development features.
 * Set to `true` to enable, `false` to disable.
 */
export const FEATURE_FLAGS = {
  /**
   * Pexels background images for sessions.
   * When enabled, new sessions fetch a random nature image from Pexels.
   * When disabled, no backgrounds are fetched or displayed.
   */
  PEXELS_BACKGROUNDS: false,
} as const
