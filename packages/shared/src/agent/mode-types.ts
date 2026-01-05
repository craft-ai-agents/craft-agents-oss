/**
 * Mode Types and Constants
 *
 * Pure types and UI configuration for permission modes.
 * This file has NO runtime dependencies - safe for browser bundling.
 *
 * For runtime mode management functions, use './mode-manager.ts'
 */

// ============================================================
// Permission Mode Types
// ============================================================

/**
 * Available permission modes
 * - 'safe': Read-only, blocks writes, never prompts (green)
 * - 'ask': Prompts for dangerous operations (amber)
 * - 'allow-all': Everything allowed, no prompts (violet)
 */
export type PermissionMode = 'safe' | 'ask' | 'allow-all';

/**
 * Order of modes for cycling with SHIFT+TAB
 */
export const PERMISSION_MODE_ORDER: PermissionMode[] = ['safe', 'ask', 'allow-all'];

/**
 * Display configuration for each mode
 */
export const PERMISSION_MODE_CONFIG: Record<PermissionMode, {
  displayName: string;
  shortName: string;
  description: string;
  /** SVG path data for the icon (viewBox 0 0 24 24, stroke-based) */
  svgPath: string;
  /** Tailwind color classes for consistent theming */
  colorClass: {
    /** Text color class (e.g., 'text-info') */
    text: string;
    /** Background color class (e.g., 'bg-info') */
    bg: string;
    /** Border color class (e.g., 'border-info') */
    border: string;
  };
  /** Fallback hex colors for contexts where CSS variables aren't available */
  colors: {
    /** Primary color - used for icons, borders, accents */
    primary: string;
    /** Muted/darker variant - used for text on dark backgrounds */
    muted: string;
  };
}> = {
  'safe': {
    displayName: 'Explore',
    shortName: 'Explore',
    description: 'Read-only exploration. Blocks writes, never prompts.',
    // Compass icon from Lucide
    svgPath: 'M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
    colorClass: {
      text: 'text-foreground-60',
      bg: 'bg-foreground-60',
      border: 'border-foreground-60',
    },
    colors: {
      primary: '#6b7280', // gray-500 fallback
      muted: '#4b5563',   // gray-600 fallback
    },
  },
  'ask': {
    displayName: 'Ask to Edit',
    shortName: 'Ask',
    description: 'Prompts before making edits.',
    // Info icon from Lucide
    svgPath: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4m0 4h.01',
    colorClass: {
      text: 'text-info',
      bg: 'bg-info',
      border: 'border-info',
    },
    colors: {
      primary: '#f59e0b', // amber-500 fallback
      muted: '#d97706',   // amber-600 fallback
    },
  },
  'allow-all': {
    displayName: 'Auto',
    shortName: 'Auto',
    description: 'Automatic execution, no prompts.',
    // Repeat icon from Lucide (loop)
    svgPath: 'm17 1 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    colorClass: {
      text: 'text-accent',
      bg: 'bg-accent',
      border: 'border-accent',
    },
    colors: {
      primary: '#9570BE', // brand purple fallback
      muted: '#7c5aa8',   // darker purple fallback
    },
  },
};

/**
 * Convert hex color to RGB string for CSS variables
 */
export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result || !result[1] || !result[2] || !result[3]) return '0, 0, 0';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}
