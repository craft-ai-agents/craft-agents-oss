/**
 * Theme Configuration
 *
 * App-level theme system with preset themes.
 * Light mode is default, with optional dark mode overrides.
 *
 * Storage locations:
 * - App override:   ~/.vesper/theme.json
 * - Preset themes:  ~/.vesper/themes/*.json
 */

/**
 * CSS color string - any valid CSS color format:
 * - Hex: #8b5cf6, #8b5cf6cc
 * - RGB: rgb(139, 92, 246), rgba(139, 92, 246, 0.8)
 * - HSL: hsl(262, 83%, 58%)
 * - OKLCH: oklch(0.58 0.22 293) (recommended)
 * - Named: purple, rebeccapurple
 */
export type CSSColor = string;

/**
 * Core theme colors (6-color semantic system)
 */
export interface ThemeColors {
  background?: CSSColor;
  foreground?: CSSColor;
  accent?: CSSColor; // Brand purple (Execute mode)
  info?: CSSColor; // Amber (Ask mode, warnings)
  success?: CSSColor; // Green
  destructive?: CSSColor; // Red
}

/**
 * Surface colors for specific UI regions
 * All optional - fall back to `background` if not set
 */
export interface SurfaceColors {
  paper?: CSSColor; // AI messages, cards, elevated content
  navigator?: CSSColor; // Left sidebar background
  input?: CSSColor; // Input field background
  popover?: CSSColor; // Dropdowns, modals, context menus (always solid, no transparency)
  popoverSolid?: CSSColor; // Guaranteed 100% opaque popover bg (required for scenic mode)
}

/**
 * Theme mode - solid (default) or scenic (background image with glass panels)
 */
export type ThemeMode = 'solid' | 'scenic';

/**
 * Theme overrides - light mode default, optional dark overrides
 * App-level only (no workspace cascading)
 */
export interface ThemeOverrides extends ThemeColors, SurfaceColors {
  // Optional dark mode overrides (includes both semantic and surface colors)
  dark?: ThemeColors & SurfaceColors;

  /**
   * Theme mode: 'solid' (default) or 'scenic'
   * - solid: Traditional solid color backgrounds
   * - scenic: Full-window background image with glass panels
   */
  mode?: ThemeMode;

  /**
   * Background image URL for scenic mode
   * Remote URL to background image (JPEG, PNG, WebP recommended)
   * Required when mode='scenic', ignored otherwise
   */
  backgroundImage?: string;
}

/**
 * Deep merge two theme objects (source wins for defined values)
 */
const COLOR_KEYS: (keyof ThemeColors)[] = [
  'background',
  'foreground',
  'accent',
  'info',
  'success',
  'destructive',
];

const SURFACE_KEYS: (keyof SurfaceColors)[] = [
  'paper',
  'navigator',
  'input',
  'popover',
  'popoverSolid',
];

// Combined keys for merging (all color properties)
const ALL_COLOR_KEYS = [...COLOR_KEYS, ...SURFACE_KEYS] as const;

function mergeThemes(
  base: ThemeOverrides | undefined,
  override: ThemeOverrides | undefined
): ThemeOverrides {
  if (!base) return override || {};
  if (!override) return base;

  const result: ThemeOverrides = { ...base };

  // Merge top-level color properties (semantic + surface)
  for (const key of ALL_COLOR_KEYS) {
    if (override[key] !== undefined) {
      result[key] = override[key];
    }
  }

  // Merge scenic mode properties
  if (override.mode !== undefined) result.mode = override.mode;
  if (override.backgroundImage !== undefined)
    result.backgroundImage = override.backgroundImage;

  // Deep merge dark overrides
  if (override.dark) {
    result.dark = { ...base.dark };
    for (const key of ALL_COLOR_KEYS) {
      if (override.dark[key] !== undefined) {
        result.dark![key] = override.dark[key];
      }
    }
  }

  return result;
}

/**
 * Resolve theme from app-level source
 * (Workspace cascading has been removed for simplicity)
 */
export function resolveTheme(
  app?: ThemeOverrides
): ThemeOverrides {
  return mergeThemes(undefined, app) || {};
}

/**
 * Convert hex color to RGB values string (e.g., "255, 128, 0")
 * Optionally darkens the color by a factor (0-1, where 0.7 = 70% brightness)
 * Returns null if not a valid hex color
 */
function hexToRgbValues(hex: string, darkenFactor: number = 1): string | null {
  let r: number, g: number, b: number;

  // Match 6 digit hex colors
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (match) {
    r = parseInt(match[1]!, 16);
    g = parseInt(match[2]!, 16);
    b = parseInt(match[3]!, 16);
  } else {
    // Try 3-digit hex
    const shortMatch = hex.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
    if (!shortMatch) return null;
    r = parseInt(shortMatch[1]! + shortMatch[1]!, 16);
    g = parseInt(shortMatch[2]! + shortMatch[2]!, 16);
    b = parseInt(shortMatch[3]! + shortMatch[3]!, 16);
  }

  // Apply darkening factor
  r = Math.round(r * darkenFactor);
  g = Math.round(g * darkenFactor);
  b = Math.round(b * darkenFactor);

  return `${r}, ${g}, ${b}`;
}

/**
 * Generate CSS variable declarations from theme
 * @param theme - Resolved theme object
 * @param isDark - Whether to apply dark mode overrides
 * @returns CSS string with variable declarations
 */
export function themeToCSS(theme: ThemeOverrides, isDark: boolean = false): string {
  const vars: string[] = [];

  // Get effective colors (merge dark overrides if in dark mode)
  const colors: ThemeColors & SurfaceColors =
    isDark && theme.dark ? { ...theme, ...theme.dark } : theme;

  // Semantic color variables
  if (colors.background) vars.push(`--background: ${colors.background};`);
  if (colors.foreground) {
    vars.push(`--foreground: ${colors.foreground};`);
    // Also output RGB version for shadow borders (only works with hex colors)
    const rgbValues = hexToRgbValues(colors.foreground);
    if (rgbValues) {
      vars.push(`--foreground-rgb: ${rgbValues};`);
    }
  }
  if (colors.accent) {
    vars.push(`--accent: ${colors.accent};`);
    // Also output darkened RGB version for shadow-tinted (only works with hex colors)
    // Use 70% brightness for a proper shadow effect
    const rgbValues = hexToRgbValues(colors.accent, 0.7);
    if (rgbValues) {
      vars.push(`--accent-rgb: ${rgbValues};`);
    }
  }
  if (colors.info) vars.push(`--info: ${colors.info};`);
  if (colors.success) vars.push(`--success: ${colors.success};`);
  if (colors.destructive) vars.push(`--destructive: ${colors.destructive};`);

  // Surface color variables (fall back to background if not set)
  // These enable fine-grained control over specific UI regions
  const bg = colors.background || 'var(--background)';
  vars.push(`--paper: ${colors.paper || bg};`);
  vars.push(`--navigator: ${colors.navigator || bg};`);
  vars.push(`--input: ${colors.input || bg};`);
  vars.push(`--popover: ${colors.popover || bg};`);
  // popoverSolid: guaranteed 100% opaque for scenic mode popovers
  // Falls back to popover, then background (should always be solid in scenic themes)
  vars.push(`--popover-solid: ${colors.popoverSolid || colors.popover || bg};`);

  // Theme mode (background image is set directly on document.documentElement.style
  // to avoid style sheet size limits with large data URLs)
  const mode = theme.mode || 'solid';
  vars.push(`--theme-mode: ${mode};`);

  return vars.join('\n  ');
}

/**
 * Hex equivalents of background colors for Electron BrowserWindow.
 * The main process cannot use CSS/oklch colors, so we provide hex values
 * that visually match the DEFAULT_THEME oklch colors.
 *
 * Vesper theme: Golden hour (light) to twilight (dark)
 */
export const BACKGROUND_HEX = {
  light: '#FDF8F3', // Warm cream - golden hour
  dark: '#2A2235', // Deep twilight purple
} as const;

/**
 * Get background color hex value for BrowserWindow backgroundColor.
 * Use this in the main process where CSS variables aren't available.
 */
export function getBackgroundColor(isDark: boolean): string {
  return isDark ? BACKGROUND_HEX.dark : BACKGROUND_HEX.light;
}

/**
 * Default theme values - Vesper: Golden Hour to Twilight
 *
 * Light mode: Warm golden amber accent with cream background
 * Dark mode: Soft twilight purple accent with deep purple background
 */
export const DEFAULT_THEME: ThemeOverrides = {
  background: 'oklch(0.98 0.01 55)', // Warm cream
  foreground: 'oklch(0.25 0.02 300)', // Deep purple-gray
  accent: 'oklch(0.68 0.16 55)', // Golden amber
  info: 'oklch(0.75 0.16 70)', // Amber (warnings)
  success: 'oklch(0.55 0.17 145)', // Green
  destructive: 'oklch(0.58 0.24 28)', // Red
  dark: {
    background: 'oklch(0.18 0.02 300)', // Deep twilight
    foreground: 'oklch(0.92 0.01 55)', // Warm light
    accent: 'oklch(0.65 0.18 300)', // Twilight purple
    info: 'oklch(0.78 0.14 70)', // Amber
    success: 'oklch(0.60 0.17 145)', // Green
    destructive: 'oklch(0.65 0.22 28)', // Red
  },
};

/**
 * Premium Theme Collection
 * Inspired by Monocle Magazine and AMAN Hotels (sophisticated luxury)
 * Plus one Dieter Rams functional minimalism theme
 */

// Theme 1: Ivory & Ebony - Classic Luxury
export const IVORY_EBONY_THEME: ThemeOverrides = {
  background: 'oklch(0.97 0.005 85)', // Warm ivory
  foreground: 'oklch(0.22 0.01 280)', // Deep charcoal
  accent: 'oklch(0.45 0.08 30)', // Cognac leather brown
  info: 'oklch(0.65 0.12 75)', // Burnished gold
  success: 'oklch(0.50 0.10 155)', // Forest green
  destructive: 'oklch(0.55 0.20 25)', // Deep burgundy
  dark: {
    background: 'oklch(0.15 0.01 280)', // Ebony black
    foreground: 'oklch(0.95 0.005 85)', // Soft ivory
    accent: 'oklch(0.55 0.10 35)', // Warm cognac
    info: 'oklch(0.70 0.14 75)', // Polished brass
    success: 'oklch(0.55 0.12 155)', // Sage green
    destructive: 'oklch(0.60 0.22 25)', // Ruby red
  },
};

// Theme 2: Sand & Stone - Natural Elements
export const SAND_STONE_THEME: ThemeOverrides = {
  background: 'oklch(0.93 0.02 70)', // Warm sand
  foreground: 'oklch(0.28 0.02 260)', // Cool stone gray
  accent: 'oklch(0.60 0.10 50)', // Terra cotta
  info: 'oklch(0.70 0.12 65)', // Desert amber
  success: 'oklch(0.55 0.12 140)', // Olive green
  destructive: 'oklch(0.58 0.18 30)', // Clay red
  dark: {
    background: 'oklch(0.20 0.02 260)', // Slate stone
    foreground: 'oklch(0.90 0.02 70)', // Light sand
    accent: 'oklch(0.65 0.12 50)', // Warm terra cotta
    info: 'oklch(0.72 0.14 65)', // Amber glow
    success: 'oklch(0.58 0.14 140)', // Muted olive
    destructive: 'oklch(0.62 0.20 30)', // Rust red
  },
};

// Theme 3: Jade & Midnight - Asian Luxury
export const JADE_MIDNIGHT_THEME: ThemeOverrides = {
  background: 'oklch(0.96 0.01 180)', // Pale jade
  foreground: 'oklch(0.25 0.02 250)', // Ink blue-black
  accent: 'oklch(0.58 0.12 165)', // Celadon jade
  info: 'oklch(0.68 0.10 80)', // Soft gold
  success: 'oklch(0.52 0.15 150)', // Bamboo green
  destructive: 'oklch(0.56 0.22 20)', // Cinnabar red
  dark: {
    background: 'oklch(0.16 0.03 250)', // Midnight blue
    foreground: 'oklch(0.92 0.01 180)', // Soft jade white
    accent: 'oklch(0.62 0.14 165)', // Luminous jade
    info: 'oklch(0.72 0.12 80)', // Lantern gold
    success: 'oklch(0.56 0.16 150)', // Deep jade
    destructive: 'oklch(0.60 0.24 20)', // Imperial red
  },
};

// Theme 4: Pure Function - Dieter Rams Aesthetic
export const PURE_FUNCTION_THEME: ThemeOverrides = {
  background: 'oklch(0.99 0 0)', // Pure white
  foreground: 'oklch(0.20 0 0)', // True black
  accent: 'oklch(0.50 0.01 0)', // Neutral gray (minimal color)
  info: 'oklch(0.75 0.10 85)', // Braun yellow (subtle nod)
  success: 'oklch(0.55 0.08 145)', // Muted green (barely there)
  destructive: 'oklch(0.55 0.15 25)', // Understated red
  dark: {
    background: 'oklch(0.12 0 0)', // Deep black
    foreground: 'oklch(0.95 0 0)', // Off-white
    accent: 'oklch(0.55 0.01 0)', // Lighter neutral gray
    info: 'oklch(0.78 0.12 85)', // Subtle Braun yellow
    success: 'oklch(0.58 0.10 145)', // Muted green
    destructive: 'oklch(0.60 0.18 25)', // Controlled red
  },
};

// ============================================
// Preset Themes
// ============================================

/**
 * Shiki theme configuration for syntax highlighting
 */
export interface ShikiThemeConfig {
  light?: string;
  dark?: string;
}

/**
 * Extended theme file format with metadata
 * Used for preset themes stored as JSON files
 */
export interface ThemeFile extends ThemeOverrides {
  name?: string;
  description?: string;
  author?: string;
  license?: string;
  source?: string;
  supportedModes?: ('light' | 'dark')[];
  shikiTheme?: ShikiThemeConfig;
}

/**
 * Preset theme with ID and path
 */
export interface PresetTheme {
  id: string; // filename without .json (e.g., 'dracula')
  path: string; // full path to theme.json
  theme: ThemeFile; // parsed theme data
}

/**
 * Default Shiki themes (used when no preset is selected)
 */
export const DEFAULT_SHIKI_THEME: ShikiThemeConfig = {
  light: 'github-light',
  dark: 'github-dark',
};

/**
 * Get Shiki theme name for current mode
 */
export function getShikiTheme(
  shikiConfig: ShikiThemeConfig | undefined,
  isDark: boolean
): string {
  const config = shikiConfig || DEFAULT_SHIKI_THEME;
  return isDark ? config.dark || 'github-dark' : config.light || 'github-light';
}
