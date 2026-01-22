/**
 * Icon Encoder Utility
 *
 * Converts icon file paths to base64 data URLs for embedding in session storage.
 * This allows the session viewer (web) to display icons without filesystem access.
 */

import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import { isEmoji } from './icon-constants.ts';

/**
 * MIME type mappings for icon files
 */
const EXT_TO_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Maximum file size for encoding (50KB)
 * Larger files are skipped to avoid bloating session storage
 */
const MAX_FILE_SIZE = 50 * 1024;

/**
 * Encode an icon file to a base64 data URL.
 *
 * @param iconPath - Absolute path to the icon file
 * @returns Base64 data URL (e.g., "data:image/png;base64,...") or undefined if encoding fails
 *
 * Handles:
 * - PNG, JPG, JPEG, SVG image files
 * - Existing data URLs (pass through)
 * - File paths that don't exist (returns undefined)
 * - Files larger than 50KB (returns undefined)
 */
export function encodeIconToDataUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) {
    return undefined;
  }

  // Already a data URL - pass through
  if (iconPath.startsWith('data:')) {
    return iconPath;
  }

  // Emoji - not a file path, skip
  if (isEmoji(iconPath)) {
    return undefined;
  }

  // Check file exists
  if (!existsSync(iconPath)) {
    return undefined;
  }

  // Get MIME type from extension
  const ext = extname(iconPath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    return undefined;
  }

  try {
    // Read file and check size
    const buffer = readFileSync(iconPath);
    if (buffer.length > MAX_FILE_SIZE) {
      return undefined;
    }

    // Encode to base64 data URL
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return undefined;
  }
}

/**
 * Get the emoji value if the input is an emoji, otherwise undefined.
 * Used for ToolDisplayMeta where we might want to display emoji as icon.
 */
export function getEmojiIcon(value: string | undefined): string | undefined {
  if (value && isEmoji(value)) {
    return value;
  }
  return undefined;
}
