/**
 * Source Icon Resolution Utility
 *
 * Resolves iconUrl values to usable URLs for display.
 * Supports three formats:
 * 1. Relative path (./icon.png) → file:// URL
 * 2. Direct image URL (https://example.com/logo.png) → as-is
 * 3. Domain URL (https://developer.apple.com) → Google Favicon API
 */

import { getLogoUrl } from './logo.ts';

/** Image file extensions we recognize as direct image URLs */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.gif'];

/**
 * Check if a URL points directly to an image file
 */
function isDirectImageUrl(url: string): boolean {
  const lowercaseUrl = url.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowercaseUrl.endsWith(ext));
}

/**
 * Browser-compatible path join (for file:// URLs)
 * Ensures proper path separator and handles trailing slashes
 */
function joinPath(base: string, relative: string): string {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedRelative = relative.startsWith('/') ? relative.slice(1) : relative;
  return `${normalizedBase}/${normalizedRelative}`;
}

/**
 * Resolve a source's iconUrl to a usable URL for display.
 *
 * @param iconUrl - The iconUrl from config (relative path, image URL, or domain)
 * @param folderPath - Absolute path to the source folder (for resolving relative paths)
 * @returns Resolved URL string or null if no icon
 *
 * @example
 * // Relative path
 * resolveSourceIconUrl('./icon.png', '/path/to/source') // → 'file:///path/to/source/icon.png'
 *
 * // Direct image URL
 * resolveSourceIconUrl('https://cdn.example.com/logo.png', '...') // → 'https://cdn.example.com/logo.png'
 *
 * // Domain for favicon lookup
 * resolveSourceIconUrl('https://developer.apple.com', '...') // → 'https://www.google.com/s2/favicons?domain=apple.com&sz=128'
 */
export function resolveSourceIconUrl(
  iconUrl: string | undefined,
  folderPath: string
): string | null {
  if (!iconUrl) {
    return null;
  }

  // Relative path → file:// URL
  if (iconUrl.startsWith('./')) {
    const relativePath = iconUrl.slice(2); // Remove './'
    const absolutePath = joinPath(folderPath, relativePath);
    return `file://${absolutePath}`;
  }

  // Direct image URL → use as-is
  if (isDirectImageUrl(iconUrl)) {
    return iconUrl;
  }

  // Domain URL → Google Favicon API
  return getLogoUrl(iconUrl);
}
