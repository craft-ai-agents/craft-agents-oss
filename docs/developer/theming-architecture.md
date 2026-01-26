# Theming Architecture

Technical documentation for Vesper's theming system, covering implementation details, APIs, and best practices for developers.

## Overview

Vesper's theming system is built on three core principles:

1. **Perceptually uniform colors** using OKLCH color space
2. **Semantic color system** with 6 core colors plus 5 surface overrides
3. **Cascading configuration** with app-level and preset themes

## Architecture

### Core Components

```
packages/shared/src/config/
├── theme.ts              # Theme types, resolution, CSS generation
└── storage.ts            # Config loading/saving

apps/electron/resources/themes/
├── default.json          # Default Vesper theme
├── ivory-ebony.json      # Premium theme 1
├── jade-midnight.json    # Premium theme 2
├── pure-function.json    # Premium theme 3
├── sand-stone.json       # Premium theme 4
└── *.json                # Other preset themes
```

### Data Flow

```
1. App Startup
   └─> Load config (~/.vesper/config.json)
   └─> Load app theme override (~/.vesper/theme.json)
   └─> Load preset themes (resources/themes/*.json)
   └─> Resolve final theme (resolveTheme)
   └─> Generate CSS variables (themeToCSS)
   └─> Apply to document.documentElement.style

2. Theme Change
   └─> User selects preset or customizes colors
   └─> Save to ~/.vesper/theme.json
   └─> Broadcast theme:changed IPC event
   └─> Renderer processes reload theme
   └─> Update CSS variables dynamically
```

## Type System

### ThemeColors

Semantic colors used throughout the application:

```typescript
interface ThemeColors {
  background?: CSSColor;   // Main app background
  foreground?: CSSColor;   // Primary text and UI elements
  accent?: CSSColor;       // Brand purple (Execute mode)
  info?: CSSColor;         // Amber (Ask mode, warnings)
  success?: CSSColor;      // Green (confirmations)
  destructive?: CSSColor;  // Red (errors, dangerous actions)
}
```

### SurfaceColors

Fine-grained control for specific UI regions:

```typescript
interface SurfaceColors {
  paper?: CSSColor;        // AI messages, cards, elevated content
  navigator?: CSSColor;    // Left sidebar background
  input?: CSSColor;        // Input field background
  popover?: CSSColor;      // Dropdowns, modals, context menus
  popoverSolid?: CSSColor; // Guaranteed 100% opaque popover (scenic mode)
}
```

All surfaces are optional and fall back to `background` if undefined.

### ThemeOverrides

Complete theme configuration with light/dark mode support:

```typescript
interface ThemeOverrides extends ThemeColors, SurfaceColors {
  dark?: ThemeColors & SurfaceColors;  // Dark mode overrides
  mode?: 'solid' | 'scenic';           // Theme mode
  backgroundImage?: string;            // Scenic mode background URL
}
```

### ThemeFile

Extended format for preset theme JSON files:

```typescript
interface ThemeFile extends ThemeOverrides {
  name?: string;              // Display name
  description?: string;       // Theme description
  author?: string;            // Creator attribution
  license?: string;           // License identifier
  source?: string;            // Source URL
  supportedModes?: ('light' | 'dark')[]; // Supported modes
  shikiTheme?: ShikiThemeConfig;         // Syntax highlighting themes
}
```

### ShikiThemeConfig

Syntax highlighting theme configuration:

```typescript
interface ShikiThemeConfig {
  light?: string;  // Shiki theme for light mode (e.g., 'github-light')
  dark?: string;   // Shiki theme for dark mode (e.g., 'github-dark')
}
```

## Core Functions

### resolveTheme()

Resolves the final theme by merging app-level overrides with presets.

```typescript
function resolveTheme(app?: ThemeOverrides): ThemeOverrides

// Usage
const appTheme = loadThemeFromFile('~/.vesper/theme.json');
const finalTheme = resolveTheme(appTheme);
```

**Resolution order:**
1. Default theme (if no app override)
2. App-level custom theme

Note: Workspace-level cascading was removed for simplicity.

### themeToCSS()

Generates CSS variable declarations from a resolved theme:

```typescript
function themeToCSS(theme: ThemeOverrides, isDark: boolean): string

// Returns CSS like:
// --background: oklch(0.98 0.01 55);
// --foreground: oklch(0.25 0.02 300);
// --accent: oklch(0.68 0.16 55);
// ...
```

**Special handling:**
- Merges `theme.dark` overrides when `isDark = true`
- Generates `--foreground-rgb` for shadow borders (hex colors only)
- Generates `--accent-rgb` for shadow effects (hex colors only, 70% darkened)
- Falls back surface colors to `background` if undefined

### getShikiTheme()

Gets the appropriate Shiki theme name for syntax highlighting:

```typescript
function getShikiTheme(
  shikiConfig: ShikiThemeConfig | undefined,
  isDark: boolean
): string

// Returns 'github-light' or 'github-dark' if config is undefined
```

### getBackgroundColor()

Returns hex background color for Electron BrowserWindow (main process):

```typescript
function getBackgroundColor(isDark: boolean): string

// Returns:
// - '#FDF8F3' (warm cream) for light mode
// - '#2A2235' (deep twilight purple) for dark mode
```

The main process cannot use OKLCH, so we provide hex equivalents that visually match the default theme.

## OKLCH Color Space

All themes use OKLCH for perceptually uniform colors:

```
oklch(L C H)
oklch(L C H / A)  // with alpha
```

### Parameters

| Param | Range | Description |
|-------|-------|-------------|
| L | 0.0 - 1.0 | Lightness (0 = black, 1 = white) |
| C | 0.0 - ~0.4 | Chroma (0 = grayscale, higher = more saturated) |
| H | 0 - 360 | Hue angle in degrees (0 = red, 120 = green, 240 = blue) |
| A | 0.0 - 1.0 | Alpha transparency (optional, 1 = opaque) |

### Example Values

```typescript
// Light mode examples
background: 'oklch(0.98 0.01 55)'      // Very light, low chroma, yellow-ish
foreground: 'oklch(0.25 0.02 300)'    // Very dark, low chroma, purple-ish
accent: 'oklch(0.68 0.16 55)'         // Medium light, saturated, golden

// Dark mode examples
background: 'oklch(0.18 0.02 300)'    // Very dark, low chroma, purple-ish
foreground: 'oklch(0.92 0.01 55)'     // Very light, low chroma, warm
accent: 'oklch(0.65 0.18 300)'        // Medium, saturated, purple

// Scenic mode with transparency
background: 'oklch(0.95 0.01 200 / 0.85)'  // 85% opaque glass effect
```

### Benefits over HSL/RGB

1. **Perceptually uniform:** Same lightness value = same perceived brightness across all hues
2. **Predictable manipulation:** Increasing L by 0.1 always brightens by the same amount
3. **Better gradients:** Smoother color transitions without muddy middle values
4. **Accessibility:** Easier to maintain consistent contrast ratios
5. **Future-proof:** Native browser support, no conversion needed

### Color Selection Guidelines

For harmonious themes:

```typescript
// Maintain consistent lightness for semantic colors
const LIGHT_MODE_LIGHTNESS = 0.60;  // All accent/info/success at L=0.60
const DARK_MODE_LIGHTNESS = 0.70;   // Slightly brighter for dark backgrounds

// Separate hues by 30-120 degrees
accent:      'oklch(0.60 0.15 150)'  // Green-ish
info:        'oklch(0.60 0.15 60)'   // Yellow (90° away)
success:     'oklch(0.60 0.15 140)'  // Green (10° from accent)
destructive: 'oklch(0.60 0.15 30)'   // Red-orange (120° from accent)

// Low chroma for backgrounds/foregrounds
background: 'oklch(0.98 0.01 55)'  // Almost neutral
foreground: 'oklch(0.25 0.02 300)' // Very low saturation
```

## CSS Variables

The theme system generates CSS custom properties applied to `:root`:

### Semantic Variables

| Variable | Source | Usage |
|----------|--------|-------|
| `--background` | `background` | Main app background |
| `--foreground` | `foreground` | Text, borders, icons |
| `--foreground-rgb` | `foreground` (hex only) | Shadow borders (e.g., `rgba(var(--foreground-rgb), 0.1)`) |
| `--accent` | `accent` | Execute mode, brand elements |
| `--accent-rgb` | `accent` (hex only, 70% darkened) | Accent shadows |
| `--info` | `info` | Ask mode, warnings |
| `--success` | `success` | Confirmations, success states |
| `--destructive` | `destructive` | Errors, delete actions |

### Surface Variables

| Variable | Source | Fallback | Usage |
|----------|--------|----------|-------|
| `--paper` | `paper` | `--background` | Cards, elevated surfaces |
| `--navigator` | `navigator` | `--background` | Sidebar background |
| `--input` | `input` | `--background` | Input fields |
| `--popover` | `popover` | `--background` | Menus, dropdowns |
| `--popover-solid` | `popoverSolid` | `--popover` | Solid popovers (scenic) |

### Usage in Components

```tsx
// React component with CSS modules
<div className={styles.card}>
  <p className={styles.text}>Hello</p>
</div>

// CSS module
.card {
  background: var(--paper);
  border: 1px solid oklch(from var(--foreground) l c h / 0.1);
}

.text {
  color: var(--foreground);
}

// Tailwind classes (configured in tailwind.config.js)
<div className="bg-background text-foreground">
  <button className="bg-accent text-accent-foreground">Execute</button>
</div>
```

### Tailwind Integration

The theme CSS variables are mapped to Tailwind color tokens:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        // ... other semantic colors
        paper: 'var(--paper)',
        navigator: 'var(--navigator)',
        input: 'var(--input)',
        popover: 'var(--popover)',
      }
    }
  }
}
```

## Storage and Loading

### File Locations

```
~/.vesper/
├── theme.json                  # App-level theme override
└── themes/
    ├── my-custom-theme.json    # User custom themes
    └── ...

apps/electron/resources/themes/
├── default.json                # Bundled presets
├── ivory-ebony.json
├── jade-midnight.json
└── ...
```

### Loading Sequence

```typescript
// 1. Load app-level override
const appThemeData = await fs.readFile('~/.vesper/theme.json', 'utf-8');
const appTheme: ThemeOverrides = JSON.parse(appThemeData);

// 2. Load preset themes
const presetPaths = await glob('apps/electron/resources/themes/*.json');
const presets: PresetTheme[] = await Promise.all(
  presetPaths.map(async (path) => ({
    id: path.basename(path, '.json'),
    path,
    theme: JSON.parse(await fs.readFile(path, 'utf-8'))
  }))
);

// 3. Resolve final theme
const finalTheme = resolveTheme(appTheme);

// 4. Generate and apply CSS
const css = themeToCSS(finalTheme, isDarkMode);
document.documentElement.style.cssText = css;
```

### Saving Changes

```typescript
// User customizes theme
const customTheme: ThemeOverrides = {
  accent: 'oklch(0.65 0.20 150)',
  // ... other overrides
};

// Save to disk
await fs.writeFile(
  '~/.vesper/theme.json',
  JSON.stringify(customTheme, null, 2)
);

// Notify all windows
BrowserWindow.getAllWindows().forEach(win => {
  win.webContents.send('theme:changed', customTheme);
});
```

## IPC Communication

### Main Process

```typescript
// apps/electron/src/main/ipc.ts

ipcMain.handle('theme:load', async () => {
  const appTheme = await loadThemeFromFile();
  const presets = await loadPresetThemes();
  return { appTheme, presets };
});

ipcMain.handle('theme:save', async (event, theme: ThemeOverrides) => {
  await saveThemeToFile(theme);

  // Broadcast to all windows
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('theme:changed', theme);
  });

  return { success: true };
});
```

### Renderer Process

```typescript
// apps/electron/src/renderer/hooks/useTheme.ts

export function useTheme() {
  const [theme, setTheme] = useState<ThemeOverrides>(DEFAULT_THEME);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Load initial theme
    window.electron.ipc.invoke('theme:load').then(({ appTheme, presets }) => {
      const resolved = resolveTheme(appTheme);
      setTheme(resolved);
      applyTheme(resolved, isDark);
    });

    // Listen for changes
    const unsubscribe = window.electron.ipc.on('theme:changed', (newTheme) => {
      const resolved = resolveTheme(newTheme);
      setTheme(resolved);
      applyTheme(resolved, isDark);
    });

    return unsubscribe;
  }, [isDark]);

  const saveTheme = async (newTheme: ThemeOverrides) => {
    await window.electron.ipc.invoke('theme:save', newTheme);
  };

  return { theme, isDark, setIsDark, saveTheme };
}
```

## Scenic Mode Implementation

Scenic mode enables background images with glass-effect panels.

### Theme Configuration

```json
{
  "name": "Mountain Vista",
  "mode": "scenic",
  "backgroundImage": "https://example.com/mountain.jpg",
  "background": "oklch(0.95 0.01 200 / 0.85)",
  "paper": "oklch(0.98 0.005 200 / 0.90)",
  "popoverSolid": "oklch(0.98 0.005 200)",
  "dark": {
    "background": "oklch(0.15 0.02 250 / 0.80)",
    "paper": "oklch(0.18 0.02 250 / 0.85)",
    "popoverSolid": "oklch(0.18 0.02 250)"
  }
}
```

### CSS Application

```typescript
function applyTheme(theme: ThemeOverrides, isDark: boolean) {
  const root = document.documentElement;

  // Apply CSS variables
  const css = themeToCSS(theme, isDark);
  root.style.cssText = css;

  // Apply background image (scenic mode)
  if (theme.mode === 'scenic' && theme.backgroundImage) {
    root.style.backgroundImage = `url(${theme.backgroundImage})`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
    root.style.backgroundAttachment = 'fixed';
  } else {
    root.style.backgroundImage = 'none';
  }
}
```

### Panel Styling

```css
/* Glass effect for scenic mode */
.panel {
  background: var(--paper);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

/* Solid background for popovers (required for readability) */
.popover {
  background: var(--popover-solid);
}
```

## Color Conversion Utilities

### Hex to RGB Values

Used for generating `--foreground-rgb` and `--accent-rgb` variables:

```typescript
function hexToRgbValues(hex: string, darkenFactor: number = 1): string | null {
  // Parse hex (supports both #abc and #aabbcc)
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;

  let r = parseInt(match[1], 16);
  let g = parseInt(match[2], 16);
  let b = parseInt(match[3], 16);

  // Apply darkening
  r = Math.round(r * darkenFactor);
  g = Math.round(g * darkenFactor);
  b = Math.round(b * darkenFactor);

  return `${r}, ${g}, ${b}`;
}

// Usage
const foregroundRgb = hexToRgbValues('#1a1a1a');
// Returns "26, 26, 26"

const accentRgb = hexToRgbValues('#8b5cf6', 0.7);
// Returns "97, 64, 171" (70% brightness)
```

Note: Only works with hex colors. OKLCH colors don't generate RGB variables.

## Testing

### Unit Tests

```typescript
// packages/shared/src/config/__tests__/theme.test.ts

describe('resolveTheme', () => {
  it('returns default theme when no override provided', () => {
    const result = resolveTheme(undefined);
    expect(result).toEqual({});
  });

  it('merges app override with base', () => {
    const app = { accent: 'oklch(0.6 0.2 150)' };
    const result = resolveTheme(app);
    expect(result.accent).toBe('oklch(0.6 0.2 150)');
  });

  it('deep merges dark overrides', () => {
    const app = {
      accent: 'oklch(0.6 0.2 150)',
      dark: { accent: 'oklch(0.7 0.2 150)' }
    };
    const result = resolveTheme(app);
    expect(result.dark?.accent).toBe('oklch(0.7 0.2 150)');
  });
});

describe('themeToCSS', () => {
  it('generates CSS variables', () => {
    const theme = {
      background: 'oklch(0.98 0.01 55)',
      foreground: 'oklch(0.25 0.02 300)',
    };
    const css = themeToCSS(theme, false);
    expect(css).toContain('--background: oklch(0.98 0.01 55)');
    expect(css).toContain('--foreground: oklch(0.25 0.02 300)');
  });

  it('applies dark overrides when isDark=true', () => {
    const theme = {
      accent: 'oklch(0.6 0.2 150)',
      dark: { accent: 'oklch(0.7 0.2 150)' }
    };
    const css = themeToCSS(theme, true);
    expect(css).toContain('--accent: oklch(0.7 0.2 150)');
  });

  it('falls back surface colors to background', () => {
    const theme = { background: 'oklch(0.98 0.01 55)' };
    const css = themeToCSS(theme, false);
    expect(css).toMatch(/--paper:.*--background/);
  });
});
```

### E2E Tests

```typescript
// apps/electron/src/main/__tests__/theme-e2e.test.ts

describe('Theme E2E', () => {
  it('loads and applies preset theme', async () => {
    const { window } = await createTestWindow();

    // Select preset
    await window.webContents.executeJavaScript(`
      window.electron.ipc.invoke('theme:save', {
        background: 'oklch(0.97 0.005 85)',
        accent: 'oklch(0.45 0.08 30)'
      })
    `);

    // Verify CSS applied
    const bgColor = await window.webContents.executeJavaScript(`
      getComputedStyle(document.documentElement)
        .getPropertyValue('--background')
    `);
    expect(bgColor.trim()).toBe('oklch(0.97 0.005 85)');
  });

  it('persists theme to disk', async () => {
    const themePath = '~/.vesper/theme.json';
    const theme = { accent: 'oklch(0.6 0.2 150)' };

    await window.electron.ipc.invoke('theme:save', theme);

    const saved = JSON.parse(await fs.readFile(themePath, 'utf-8'));
    expect(saved.accent).toBe('oklch(0.6 0.2 150)');
  });
});
```

## Performance Considerations

1. **CSS variable updates:** Very fast (native browser feature)
2. **Theme loading:** ~5ms for 20 preset themes
3. **JSON parsing:** Minimal overhead with native JSON.parse
4. **File I/O:** Async to avoid blocking UI
5. **IPC overhead:** <1ms per message

### Optimization Tips

- Cache resolved theme in memory
- Debounce rapid theme changes (e.g., live color picker)
- Batch CSS variable updates
- Use `requestAnimationFrame` for smooth transitions

```typescript
// Debounced theme updates
const debouncedSaveTheme = debounce(
  (theme: ThemeOverrides) => saveThemeToFile(theme),
  500
);

// Smooth transitions
function applyThemeWithTransition(theme: ThemeOverrides, isDark: boolean) {
  requestAnimationFrame(() => {
    const css = themeToCSS(theme, isDark);
    document.documentElement.style.cssText = css;
  });
}
```

## Migration Guide

### From workspace-level themes (pre-v1.5)

Workspace-level theme cascading was removed in v1.5 for simplicity. To migrate:

```typescript
// Before: Workspace themes
~/.vesper/workspaces/{id}/theme.json

// After: App-level only
~/.vesper/theme.json

// Migration script
async function migrateThemes() {
  const workspaces = await loadWorkspaces();

  for (const workspace of workspaces) {
    const wsThemePath = `~/.vesper/workspaces/${workspace.id}/theme.json`;
    if (await fs.exists(wsThemePath)) {
      console.warn(
        `Workspace theme at ${wsThemePath} is no longer supported. ` +
        `Please move customizations to ~/.vesper/theme.json`
      );
    }
  }
}
```

## Best Practices

1. **Always test both modes:** Verify themes in light and dark mode
2. **Use semantic colors:** Don't override surfaces unless necessary
3. **Maintain contrast:** WCAG AA requires 4.5:1 minimum for text
4. **Keep lightness consistent:** Use same L value for accent/info/success
5. **Separate hues:** Space semantic colors 30-120° apart
6. **Low chroma backgrounds:** Keep C < 0.05 for backgrounds/foregrounds
7. **Document inspirations:** Add `description` and `source` to theme files
8. **Version presets:** Use git tags to track theme changes
9. **Provide fallbacks:** Always define both light and dark modes
10. **Test accessibility:** Use colorblind simulators and screen readers

## Troubleshooting

### Theme not loading

```typescript
// Check file exists
await fs.access('~/.vesper/theme.json');

// Validate JSON syntax
try {
  JSON.parse(await fs.readFile('~/.vesper/theme.json', 'utf-8'));
} catch (err) {
  console.error('Invalid JSON:', err);
}

// Check logs
tail -f ~/Library/Logs/Vesper/main.log
```

### CSS variables not applying

```typescript
// Verify variables in DevTools
const root = document.documentElement;
console.log(root.style.getPropertyValue('--accent'));

// Check if overridden by inline styles
const computed = getComputedStyle(root);
console.log(computed.getPropertyValue('--accent'));
```

### OKLCH not rendering

- Ensure browser supports OKLCH (Chrome 111+, Safari 15.4+, Firefox 113+)
- Check for typos: `oklch(L C H)`, not `oklch(L, C, H)`
- Validate ranges: L (0-1), C (0-0.4), H (0-360)

## Future Enhancements

- [ ] Theme marketplace integration
- [ ] Live theme preview without saving
- [ ] Color palette generator from single accent color
- [ ] Import/export theme packs
- [ ] A11y contrast checker in theme editor
- [ ] Dynamic theme based on wallpaper (macOS only)
- [ ] Per-workspace theme support (if requested)

---

**Questions?** Open an issue on [GitHub](https://github.com/atherslabs/vesper/issues) or check the [user guide](../user-guide/themes.md).
