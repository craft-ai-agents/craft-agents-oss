/**
 * Theme Configuration
 *
 * Cascading theme system with app → workspace → agent precedence.
 * Light mode is default, with optional dark mode overrides.
 *
 * Storage locations:
 * - App:       ~/.craft-agent/theme.json
 * - Workspace: ~/.craft-agent/workspaces/{id}/theme.json
 * - Agent:     ~/.craft-agent/workspaces/{id}/agents/{slug}/theme.json
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
 * Core theme colors (6-color system)
 */
export interface ThemeColors {
  background?: CSSColor;
  foreground?: CSSColor;
  accent?: CSSColor; // Brand purple (Auto mode)
  info?: CSSColor; // Amber (Ask mode, warnings)
  success?: CSSColor; // Green
  destructive?: CSSColor; // Red
}

/**
 * Theme overrides - light mode default, optional dark overrides
 * Cascades: app → workspace → agent (last wins)
 */
export interface ThemeOverrides extends ThemeColors {
  // Optional dark mode overrides
  dark?: ThemeColors;
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

function mergeThemes(
  base: ThemeOverrides | undefined,
  override: ThemeOverrides | undefined
): ThemeOverrides {
  if (!base) return override || {};
  if (!override) return base;

  const result: ThemeOverrides = { ...base };

  // Merge top-level color properties
  for (const key of COLOR_KEYS) {
    if (override[key] !== undefined) {
      result[key] = override[key];
    }
  }

  // Deep merge dark overrides
  if (override.dark) {
    result.dark = { ...base.dark };
    for (const key of COLOR_KEYS) {
      if (override.dark[key] !== undefined) {
        result.dark![key] = override.dark[key];
      }
    }
  }

  return result;
}

/**
 * Resolve theme from cascading sources (app → workspace → agent)
 * Later sources override earlier ones
 */
export function resolveTheme(
  app?: ThemeOverrides,
  workspace?: ThemeOverrides,
  agent?: ThemeOverrides
): ThemeOverrides {
  let result = mergeThemes(undefined, app);
  result = mergeThemes(result, workspace);
  result = mergeThemes(result, agent);
  return result;
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
  const colors: ThemeColors = isDark && theme.dark ? { ...theme, ...theme.dark } : theme;

  // Color variables
  if (colors.background) vars.push(`--background: ${colors.background};`);
  if (colors.foreground) vars.push(`--foreground: ${colors.foreground};`);
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

  return vars.join('\n  ');
}

/**
 * Default theme values (matches current index.css)
 */
export const DEFAULT_THEME: ThemeOverrides = {
  background: 'oklch(0.98 0.003 265)',
  foreground: 'oklch(0.185 0.01 270)',
  accent: 'oklch(0.58 0.22 293)',
  info: 'oklch(0.75 0.16 70)',
  success: 'oklch(0.55 0.17 145)',
  destructive: 'oklch(0.58 0.24 28)',
  dark: {
    background: 'oklch(0.145 0.015 270)',
    foreground: 'oklch(0.95 0.01 270)',
    accent: 'oklch(0.65 0.22 293)',
    info: 'oklch(0.78 0.14 70)',
    success: 'oklch(0.60 0.17 145)',
    destructive: 'oklch(0.65 0.22 28)',
  },
};
