/**
 * OAuth State Encoding/Decoding
 *
 * Encodes and decodes OAuth state parameters for CSRF protection.
 * Uses base64url encoding to make the state URL-safe.
 */

import type { OAuthState } from '../types.ts';

/**
 * Encode OAuth state to a URL-safe string
 */
export function encodeOAuthState(state: OAuthState): string {
  const json = JSON.stringify(state);
  // Use base64url encoding (URL-safe base64)
  return btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode OAuth state from a URL-safe string
 * Returns null if decoding fails
 */
export function decodeOAuthState(encoded: string): OAuthState | null {
  try {
    // Restore standard base64
    const base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

    const json = atob(padded);
    const state = JSON.parse(json) as OAuthState;

    // Validate required fields
    if (!state.workspaceSlug || !state.repoKey || !state.redirectUri || !state.nonce) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}
