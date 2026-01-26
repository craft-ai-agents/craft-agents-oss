# Themes Guide

Vesper includes a sophisticated theming system with a collection of carefully crafted preset themes, plus full customization capabilities. All themes use the modern OKLCH color space for perceptually uniform colors and support both light and dark modes.

## Quick Start

### Selecting a Theme

1. Open Settings (Cmd+, or click the gear icon in the sidebar)
2. Navigate to the "Appearance" section
3. Choose from the preset themes dropdown or create your own custom theme
4. Toggle between light and dark mode using your system preferences or the theme toggle

### Available Themes

Vesper ships with 20+ carefully curated themes, including 4 premium themes inspired by luxury design and minimalism:

## Premium Theme Collection

### Ivory & Ebony

**Classic Luxury with Cognac Leather Accents**

Inspired by the timeless elegance of AMAN Hotels, this theme combines warm ivory and deep ebony with rich cognac leather brown accents.

**Light Mode:**
- Background: Warm ivory (oklch 0.97/0.005/85)
- Foreground: Deep charcoal (oklch 0.22/0.01/280)
- Accent: Cognac leather brown (oklch 0.45/0.08/30)
- Info: Burnished gold (oklch 0.65/0.12/75)
- Success: Forest green (oklch 0.50/0.10/155)
- Destructive: Deep burgundy (oklch 0.55/0.20/25)

**Dark Mode:**
- Background: Ebony black (oklch 0.15/0.01/280)
- Foreground: Soft ivory (oklch 0.95/0.005/85)
- Accent: Warm cognac (oklch 0.55/0.10/35)
- Info: Polished brass (oklch 0.70/0.14/75)
- Success: Sage green (oklch 0.55/0.12/155)
- Destructive: Ruby red (oklch 0.60/0.22/25)

**Best for:** Professional environments, documentation work, long reading sessions. The warm cognac accents provide visual interest without distraction.

### Sand & Stone

**Natural Elements with Terra Cotta Warmth**

Inspired by the sophisticated editorial design of Monocle Magazine, this theme embraces natural earth tones with warm sand backgrounds and cool stone grays.

**Light Mode:**
- Background: Warm sand (oklch 0.93/0.02/70)
- Foreground: Cool stone gray (oklch 0.28/0.02/260)
- Accent: Terra cotta (oklch 0.60/0.10/50)
- Info: Desert amber (oklch 0.70/0.12/65)
- Success: Olive green (oklch 0.55/0.12/140)
- Destructive: Clay red (oklch 0.58/0.18/30)

**Dark Mode:**
- Background: Slate stone (oklch 0.20/0.02/260)
- Foreground: Light sand (oklch 0.90/0.02/70)
- Accent: Warm terra cotta (oklch 0.65/0.12/50)
- Info: Amber glow (oklch 0.72/0.14/65)
- Success: Muted olive (oklch 0.58/0.14/140)
- Destructive: Rust red (oklch 0.62/0.20/30)

**Best for:** Creative work, writing, design tasks. The natural palette reduces eye strain while maintaining excellent contrast.

### Jade & Midnight

**Asian-Inspired Refinement with Celadon Jade Aesthetics**

Drawing from traditional Asian ceramics and ink-wash painting, this theme features pale jade greens with deep midnight blue backgrounds and celadon accents.

**Light Mode:**
- Background: Pale jade (oklch 0.96/0.01/180)
- Foreground: Ink blue-black (oklch 0.25/0.02/250)
- Accent: Celadon jade (oklch 0.58/0.12/165)
- Info: Soft gold (oklch 0.68/0.10/80)
- Success: Bamboo green (oklch 0.52/0.15/150)
- Destructive: Cinnabar red (oklch 0.56/0.22/20)

**Dark Mode:**
- Background: Midnight blue (oklch 0.16/0.03/250)
- Foreground: Soft jade white (oklch 0.92/0.01/180)
- Accent: Luminous jade (oklch 0.62/0.14/165)
- Info: Lantern gold (oklch 0.72/0.12/80)
- Success: Deep jade (oklch 0.56/0.16/150)
- Destructive: Imperial red (oklch 0.60/0.24/20)

**Best for:** Focused work sessions, meditation-like coding, late-night work. The serene jade tones promote calm and concentration.

### Pure Function

**Dieter Rams Minimalism - Less, But Better**

Inspired by legendary designer Dieter Rams and his "less, but better" philosophy, this theme features near-zero chroma colors with subtle Braun yellow accents.

**Light Mode:**
- Background: Pure white (oklch 0.99/0/0)
- Foreground: True black (oklch 0.20/0/0)
- Accent: Neutral gray (oklch 0.50/0.01/0)
- Info: Braun yellow (oklch 0.75/0.10/85) - subtle nod to Rams' iconic work
- Success: Muted green (oklch 0.55/0.08/145)
- Destructive: Understated red (oklch 0.55/0.15/25)

**Dark Mode:**
- Background: Deep black (oklch 0.12/0/0)
- Foreground: Off-white (oklch 0.95/0/0)
- Accent: Lighter neutral gray (oklch 0.55/0.01/0)
- Info: Subtle Braun yellow (oklch 0.78/0.12/85)
- Success: Muted green (oklch 0.58/0.10/145)
- Destructive: Controlled red (oklch 0.60/0.18/25)

**Best for:** Distraction-free environments, keyboard-driven workflows, users who value function over ornamentation. Maximum clarity with minimal visual noise.

## Other Preset Themes

Vesper also includes these popular community themes:

- **Default (Vesper)** - Golden hour to twilight, warm and inviting
- **Catppuccin** - Soothing pastel theme for the high-spirited
- **Dracula** - Dark theme with carefully chosen vibrant colors
- **GitHub** - Clean and familiar GitHub aesthetic
- **Ghostty** - Mitchell Hashimoto's terminal theme
- **Gruvbox** - Retro groove warm theme with earthy tones
- **Haze** - Soft, muted colors for reduced eye strain
- **Night Owl** - Sarah Drasner's theme for night owls
- **Nord** - Arctic, north-bluish color palette
- **One Dark Pro** - Atom's iconic One Dark theme
- **Pierre** - Elegant and sophisticated dark theme
- **Rose Pine** - All natural pine, faux fur and a bit of soho vibes
- **Solarized** - Precision colors for machines and people
- **Tokyo Night** - Clean, dark theme inspired by Tokyo's nighttime skyline
- **Vitesse** - Speed-inspired theme with vibrant colors

## Theme Structure

### Color System

Vesper uses a 6-color semantic system for consistent theming:

| Color | Purpose |
|-------|---------|
| `background` | Main app background color |
| `foreground` | Primary text and UI elements |
| `accent` | Brand color (Execute mode, primary actions) |
| `info` | Warnings, Ask mode, informational states |
| `success` | Confirmations, completed actions |
| `destructive` | Errors, dangerous actions, delete operations |

### Surface Colors

For fine-grained control, themes can override specific UI regions:

| Surface | Purpose |
|---------|---------|
| `paper` | AI messages, cards, elevated content |
| `navigator` | Left sidebar background |
| `input` | Input field background |
| `popover` | Dropdowns, modals, context menus |
| `popoverSolid` | Guaranteed opaque popover (for scenic mode) |

All surfaces are optional and fall back to `background` if not specified.

### OKLCH Color Space

All themes use OKLCH (Oklab Lightness Chroma Hue) for perceptually uniform colors:

```
oklch(L C H)
```

- **L** (Lightness): 0.0 (black) to 1.0 (white)
- **C** (Chroma): 0.0 (grayscale) to ~0.4 (highly saturated)
- **H** (Hue): 0-360 degrees (color wheel position)

Benefits:
- Perceptually uniform brightness across all hues
- Predictable color manipulation
- Better accessibility with consistent contrast ratios
- Future-proof (supported in all modern browsers)

## Creating Custom Themes

### Method 1: Settings UI

1. Go to Settings > Appearance
2. Click "Create Custom Theme"
3. Use the color pickers to customize each semantic color
4. Toggle between light and dark mode to set both palettes
5. Save your theme with a descriptive name

### Method 2: JSON File

Create a theme file in `~/.vesper/themes/my-theme.json`:

```json
{
  "name": "My Custom Theme",
  "description": "A theme tailored to my preferences",
  "author": "Your Name",
  "license": "MIT",
  "supportedModes": ["light", "dark"],
  "shikiTheme": {
    "light": "github-light",
    "dark": "github-dark"
  },
  "background": "oklch(0.98 0.01 120)",
  "foreground": "oklch(0.20 0.02 120)",
  "accent": "oklch(0.60 0.15 150)",
  "info": "oklch(0.70 0.12 60)",
  "success": "oklch(0.55 0.15 140)",
  "destructive": "oklch(0.60 0.22 30)",
  "dark": {
    "background": "oklch(0.15 0.02 120)",
    "foreground": "oklch(0.95 0.01 120)",
    "accent": "oklch(0.65 0.18 150)",
    "info": "oklch(0.75 0.14 60)",
    "success": "oklch(0.60 0.17 140)",
    "destructive": "oklch(0.65 0.24 30)"
  }
}
```

### Theme File Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name in theme picker |
| `description` | No | Theme description shown in settings |
| `author` | No | Theme creator attribution |
| `license` | No | License identifier (MIT, Apache 2.0, etc.) |
| `source` | No | URL to theme source/repository |
| `supportedModes` | No | Array: `["light"]`, `["dark"]`, or `["light", "dark"]` |
| `shikiTheme` | No | Syntax highlighting theme names (see below) |
| `background` through `destructive` | Yes | Light mode colors (OKLCH format) |
| `dark` | No | Dark mode color overrides |
| `mode` | No | `"solid"` (default) or `"scenic"` (background image) |
| `backgroundImage` | No | URL for scenic mode background |

### Syntax Highlighting (Shiki)

Code blocks use [Shiki](https://shiki.style/) for syntax highlighting. You can specify different themes for light and dark modes:

```json
"shikiTheme": {
  "light": "github-light",
  "dark": "github-dark"
}
```

Popular Shiki themes:
- `github-light`, `github-dark`
- `one-dark-pro`
- `nord`
- `dracula`
- `tokyo-night`
- `catppuccin-latte`, `catppuccin-mocha`

See [Shiki themes](https://shiki.style/themes) for the full list.

## Scenic Mode (Advanced)

Scenic mode enables full-window background images with translucent glass panels. This feature is in beta.

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

Notes:
- Use semi-transparent OKLCH colors for glass effect (e.g., `oklch(0.95 0.01 200 / 0.85)`)
- Always provide `popoverSolid` for readability in menus and dropdowns
- Remote images (HTTPS URLs) recommended for performance
- JPEG/WebP formats with 1920x1080+ resolution work best

## Storage Locations

- **App-level override:** `~/.vesper/theme.json`
- **Preset themes:** `~/.vesper/themes/*.json` or app bundle
- **Workspace override:** Removed for simplicity (app-level only)

## Developer Reference

### Theme Resolution

Themes cascade in this order:

1. Default theme (Vesper golden hour/twilight)
2. Selected preset theme (if any)
3. App-level custom overrides (`~/.vesper/theme.json`)

### CSS Variable Mapping

The theme system generates CSS variables that power the entire UI:

| Theme Color | CSS Variable | Usage |
|-------------|--------------|-------|
| `background` | `--background` | Main app background |
| `foreground` | `--foreground` | Text, borders, icons |
| `accent` | `--accent` | Execute mode, brand elements |
| `info` | `--info` | Ask mode, warnings |
| `success` | `--success` | Confirmations, success states |
| `destructive` | `--destructive` | Errors, delete actions |
| `paper` | `--paper` | Cards, elevated surfaces |
| `navigator` | `--navigator` | Sidebar background |
| `input` | `--input` | Input fields |
| `popover` | `--popover` | Menus, dropdowns, modals |

### API Functions

```typescript
import {
  resolveTheme,
  themeToCSS,
  getShikiTheme,
  type ThemeOverrides
} from '@vesper/shared/config/theme';

// Resolve final theme from app override
const theme: ThemeOverrides = resolveTheme(appTheme);

// Generate CSS variables
const css: string = themeToCSS(theme, isDarkMode);

// Get Shiki theme name
const shikiTheme: string = getShikiTheme(theme.shikiTheme, isDarkMode);
```

## Tips and Best Practices

1. **Test both modes:** Always verify your theme looks good in both light and dark mode
2. **Check contrast:** Ensure sufficient contrast between background/foreground (WCAG AA: 4.5:1 minimum)
3. **Use the color wheel:** Keep accent/info/success hues separated by 30+ degrees for visual clarity
4. **Match your environment:** Choose light themes for bright rooms, dark themes for low-light conditions
5. **Consider colorblindness:** Test themes with colorblind simulators for accessibility
6. **Start from presets:** Clone an existing theme and modify it rather than starting from scratch
7. **OKLCH benefits:** Use consistent lightness values (L) for harmonious palettes
8. **Surface overrides:** Only override surfaces when you need fine-grained control

## Troubleshooting

### Theme not applying

1. Check JSON syntax in custom theme files
2. Verify file is in `~/.vesper/themes/` directory
3. Restart Vesper to reload theme files
4. Check logs at `~/Library/Logs/Vesper/main.log` for parse errors

### Colors look wrong

1. Confirm OKLCH values are in valid ranges (L: 0-1, C: 0-0.4, H: 0-360)
2. Check browser DevTools for CSS variable values
3. Verify no browser extensions are modifying colors
4. Try switching between light/dark mode to isolate the issue

### Syntax highlighting not working

1. Verify `shikiTheme` field uses valid theme names
2. Check that code language is specified in markdown (```typescript, not just ```)
3. Update Vesper to latest version for newest Shiki themes

## Contributing Themes

We welcome community theme contributions! To submit a theme:

1. Create a JSON file following the structure above
2. Test thoroughly in both light and dark modes
3. Include high-quality screenshots
4. Submit a pull request to the Vesper repository
5. Add your theme to `apps/electron/resources/themes/`

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed guidelines.

---

**Questions or Issues?** Open an issue on [GitHub](https://github.com/atherslabs/vesper/issues) or join our community discussions.
