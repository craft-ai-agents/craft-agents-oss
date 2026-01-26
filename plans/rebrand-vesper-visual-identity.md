# Rebrand: Vesper Visual Identity

> **The golden hour where AI Companions work tirelessly into the night while Humans do the Orchestration and Creative Thinking**

## Overview

Visual-only rebrand from "Craft Agents" to "Vesper" - updating logo, colors, icons, and UI text while preserving all code identifiers and package names. The new identity embraces a sunset-to-twilight color palette representing the transition from human orchestration (golden hour) to AI companion work (twilight).

## Problem Statement / Motivation

The current "Craft Agents" branding needs to evolve to "Vesper" to better represent the product's philosophy:
- **Vesper** = Evening/twilight, the golden hour
- **Human role**: Orchestration and creative thinking (the warm golden light)
- **AI role**: Tireless work into the night (the deep twilight)

This visual rebrand maintains code stability while transforming the user-facing identity.

## Proposed Solution

Update all visual branding touchpoints:
1. Logo components and icon assets
2. Color system (sunset-to-twilight palette)
3. UI text labels and menu items
4. Electron app configuration
5. Platform-specific icons (macOS, Windows, Linux)

**Explicitly out of scope**: Package names (`@craft-agent/*`), directory paths (`~/.craft-agent/`), code identifiers.

> **Note**: The deep link scheme has been updated from `craftagents://` to `vesper://` in a subsequent change.

---

## Technical Approach

### Phase 1: Color System Update

Update the 6-color semantic system with Vesper's sunset-to-twilight palette.

#### 1.1 Define New Color Palette

**Light Mode (Golden Hour)**:
```css
--accent: oklch(0.68 0.16 55);    /* Warm amber gold */
```

**Dark Mode (Twilight)**:
```css
--accent: oklch(0.65 0.18 300);   /* Soft twilight purple */
```

**Recommended full palette** (OKLCH for perceptual uniformity):

| Token | Light Mode | Dark Mode | Hex Approximation |
|-------|------------|-----------|-------------------|
| `--accent` | `oklch(0.68 0.16 55)` | `oklch(0.65 0.18 300)` | #E8A850 / #A478C8 |
| `--background` | `oklch(0.98 0.01 55)` | `oklch(0.18 0.02 300)` | #FDF8F3 / #2A2235 |
| `--foreground` | `oklch(0.25 0.02 300)` | `oklch(0.92 0.01 55)` | #3D2F45 / #F8F4ED |

#### 1.2 Files to Update

| File | Line(s) | Change |
|------|---------|--------|
| `packages/shared/src/config/theme.ts` | 248-263 | Update `DEFAULT_THEME` accent colors |
| `packages/shared/src/config/theme.ts` | 232-235 | Update `BACKGROUND_HEX` light/dark values |
| `apps/electron/src/renderer/index.css` | 76-77, 214-215 | Update `--accent` and `--accent-rgb` |
| `apps/electron/src/renderer/index.css` | 99 | Update `@property --accent` initial-value |
| `packages/ui/src/styles/index.css` | ~180 | Update shared UI accent colors |

#### 1.3 Pseudo-code: theme.ts update

```typescript
// packages/shared/src/config/theme.ts

export const BACKGROUND_HEX = {
  light: '#FDF8F3',  // Warm cream (golden hour)
  dark: '#2A2235',   // Deep twilight purple
}

export const DEFAULT_THEME: ResolvedTheme = {
  // ... existing structure
  accent: 'oklch(0.68 0.16 55)',      // Golden amber (light)
  dark: {
    accent: 'oklch(0.65 0.18 300)',   // Twilight purple (dark)
  }
}
```

---

### Phase 2: Logo and Icon Assets

#### 2.1 Create New Logo Components

| Current File | New File | Description |
|--------------|----------|-------------|
| `CraftAgentsLogo.tsx` | `VesperLogo.tsx` | Full branding logo with text |
| `CraftAgentsSymbol.tsx` | `VesperSymbol.tsx` | Symbol-only icon |
| `CraftAppIcon.tsx` | `VesperAppIcon.tsx` | App icon component |

**Location**: `apps/electron/src/renderer/components/icons/`

#### 2.2 Update All Logo Imports

Files importing logo components (31 files identified):

```
apps/electron/src/renderer/components/SplashScreen.tsx:39
apps/electron/src/renderer/components/AppMenu.tsx:54
apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx:25
apps/electron/src/renderer/components/onboarding/CompletionStep.tsx
apps/electron/src/renderer/components/onboarding/ReauthScreen.tsx
apps/electron/src/renderer/playground/registry/icons.tsx
apps/viewer/src/components/Header.tsx:8
```

#### 2.3 Replace Static Icon Assets

| Asset | Location | Required Sizes |
|-------|----------|----------------|
| `icon.icns` | `apps/electron/resources/` | 16-1024px (macOS) |
| `icon.ico` | `apps/electron/resources/` | 16-256px (Windows) |
| `icon.png` | `apps/electron/resources/` | 512px (Linux) |
| `icon.svg` | `apps/electron/resources/` | Vector |
| `craft_app_icon.png` | `apps/electron/resources/craft-logos/` | Light theme |
| `craft_app_icon_dark.png` | `apps/electron/resources/craft-logos/` | Dark theme |
| `craft_logo_black.png` | `apps/electron/resources/craft-logos/` | Monochrome |
| `craft_logo_white.png` | `apps/electron/resources/craft-logos/` | Monochrome inverted |
| `craft_logo_c.svg` | `apps/electron/src/renderer/assets/` | Inline SVG |

#### 2.4 Icon Generation Process

```bash
# From 1024x1024 source PNG, generate all sizes
# Using electron-builder's icon generation or manual tools

# macOS .icns (requires iconutil on macOS)
mkdir vesper.iconset
sips -z 16 16 vesper-1024.png --out vesper.iconset/icon_16x16.png
sips -z 32 32 vesper-1024.png --out vesper.iconset/icon_16x16@2x.png
# ... all sizes through 512x512@2x
iconutil -c icns vesper.iconset -o icon.icns

# Windows .ico (requires ImageMagick or similar)
convert vesper-1024.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

---

### Phase 3: UI Text and Labels

#### 3.1 Application Menu (macOS)

**File**: `apps/electron/src/main/menu.ts`

| Line | Current | New |
|------|---------|-----|
| 53 | `label: 'Craft Agents'` | `label: 'Vesper'` |
| 55 | `label: 'About Craft Agents'` | `label: 'About Vesper'` |
| 64 | `label: 'Hide Craft Agents'` | `label: 'Hide Vesper'` |
| 68 | `label: 'Quit Craft Agents'` | `label: 'Quit Vesper'` |

#### 3.2 App Name Registration

**File**: `apps/electron/src/main/index.ts`

```typescript
// Line 45
app.setName(process.env.CRAFT_APP_NAME || 'Vesper')
```

#### 3.3 Onboarding Screens

| File | Line | Change |
|------|------|--------|
| `WelcomeStep.tsx` | 28 | `'Welcome to Vesper'` |
| `ReauthScreen.tsx` | ~15 | `'continue using Vesper'` |
| `CompletionStep.tsx` | Various | Update any Craft Agents text |

#### 3.4 Splash Screen

**File**: `apps/electron/src/renderer/components/SplashScreen.tsx`

```typescript
// Line 39 - Update import
import { VesperSymbol } from './icons/VesperSymbol'
```

---

### Phase 4: Electron Builder Configuration

**File**: `electron-builder.yml`

| Line | Current | New |
|------|---------|-----|
| 2 | `productName: Craft Agents` | `productName: Vesper` |
| 3 | `copyright: Copyright © 2025 Craft Docs Ltd.` | Update if company changes |
| 75 | `artifactName: "Craft-Agent-${arch}.dmg"` | `artifactName: "Vesper-${arch}.dmg"` |
| 94 | `artifactName: "Craft-Agent-${arch}.${ext}"` | `artifactName: "Vesper-${arch}.${ext}"` |
| 130 | `artifactName: "Craft-Agent-${arch}.${ext}"` | `artifactName: "Vesper-${arch}.${ext}"` |

**Note**: Keep `appId` as `com.lukilabs.craft-agent` to preserve:
- macOS Keychain access
- User preferences
- Auto-update continuity

---

### Phase 5: Branding Module

**File**: `packages/shared/src/branding.ts`

#### 5.1 Update ASCII Logo

```typescript
// Lines 6-12
export const VESPER_LOGO = `
██╗   ██╗███████╗███████╗██████╗ ███████╗██████╗
██║   ██║██╔════╝██╔════╝██╔══██╗██╔════╝██╔══██╗
██║   ██║█████╗  ███████╗██████╔╝█████╗  ██████╔╝
╚██╗ ██╔╝██╔══╝  ╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
 ╚████╔╝ ███████╗███████║██║     ███████╗██║  ██║
  ╚═══╝  ╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝
`
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] New Vesper logo renders correctly at all sizes (16px through 1024px)
- [ ] Logo maintains visual clarity in both light and dark modes
- [ ] All platform icons updated: `.icns` (macOS), `.ico` (Windows), `.png` (Linux)
- [ ] macOS menu shows "About Vesper", "Hide Vesper", "Quit Vesper"
- [ ] Splash screen displays new Vesper symbol
- [ ] Welcome screen shows "Welcome to Vesper"
- [ ] Color transitions animate smoothly between themes
- [ ] Accent color uses golden tone in light mode, twilight purple in dark mode

### Non-Functional Requirements

- [ ] All text/background combinations meet WCAG 2.1 AA contrast (4.5:1 minimum)
- [ ] Colors render correctly with system vibrancy (macOS) and Mica (Windows 11)
- [ ] Scenic mode maintains readability with new color palette
- [ ] No visual regression in existing UI components

### Quality Gates

- [ ] Visual regression tests pass on macOS, Windows, Linux
- [ ] Accessibility audit passes (contrast, focus indicators)
- [ ] Build artifacts correctly named "Vesper-*"
- [ ] App displays as "Vesper" in system task managers/docks

---

## Edge Cases and Mitigations

### Dark Mode
- **Risk**: Twilight purple may not provide enough contrast
- **Mitigation**: Test all text combinations, adjust lightness if needed

### Scenic Mode
- **Risk**: Glass panels may reduce readability with warm backgrounds
- **Mitigation**: Test with 5+ scenic backgrounds, adjust blur/opacity

### Accessibility
- **Risk**: Golden tones difficult for colorblind users
- **Mitigation**: Ensure luminance contrast, not just hue difference

### Platform Differences
- **Risk**: macOS vibrancy alters perceived colors
- **Mitigation**: Test on multiple wallpapers, verify with vibrancy enabled/disabled

---

## Files to Modify

### High Priority (Core Branding)

| File | Changes |
|------|---------|
| `packages/shared/src/config/theme.ts` | Update colors, BACKGROUND_HEX |
| `apps/electron/src/renderer/index.css` | Update CSS variables |
| `packages/ui/src/styles/index.css` | Update shared styles |
| `apps/electron/src/renderer/components/icons/CraftAgentsLogo.tsx` | Rename + new SVG |
| `apps/electron/src/renderer/components/icons/CraftAgentsSymbol.tsx` | Rename + new SVG |
| `apps/electron/resources/icon.*` | Replace all icon files |
| `electron-builder.yml` | Update productName, artifactNames |

### Medium Priority (UI Text)

| File | Changes |
|------|---------|
| `apps/electron/src/main/menu.ts` | Menu labels |
| `apps/electron/src/main/index.ts` | app.setName() |
| `apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx` | Welcome text |
| `apps/electron/src/renderer/components/onboarding/ReauthScreen.tsx` | Reauth text |
| `apps/electron/src/renderer/components/SplashScreen.tsx` | Symbol import |
| `apps/electron/src/renderer/components/AppMenu.tsx` | Logo import |
| `packages/shared/src/branding.ts` | ASCII logo |

### Low Priority (Documentation)

| File | Changes |
|------|---------|
| `README.md` | Update product name mentions |
| `CONTRIBUTING.md` | Update product name |
| `apps/electron/README.md` | Update product name |

---

## Testing Plan

### Visual Regression
1. Screenshot comparison: splash, onboarding, main app, settings
2. Both light and dark modes
3. Scenic mode with multiple backgrounds

### Cross-Platform
- macOS: 13+, Intel and Apple Silicon
- Windows: 10 and 11
- Linux: Ubuntu 22.04

### Accessibility
- WCAG contrast verification
- Color blindness simulation
- Keyboard navigation focus visibility

---

## Implementation Checklist

### Phase 1: Colors
- [ ] Update `DEFAULT_THEME` in theme.ts
- [ ] Update `BACKGROUND_HEX` in theme.ts
- [ ] Update `--accent` in index.css (electron)
- [ ] Update `--accent-rgb` values
- [ ] Update `@property --accent` initial-value
- [ ] Update shared UI styles

### Phase 2: Logos
- [ ] Create VesperLogo.tsx component
- [ ] Create VesperSymbol.tsx component
- [ ] Update all imports (31 files)
- [ ] Replace craft_logo_c.svg
- [ ] Generate icon.icns (macOS)
- [ ] Generate icon.ico (Windows)
- [ ] Generate icon.png (Linux)
- [ ] Replace craft_app_icon variants

### Phase 3: Text
- [ ] Update menu.ts labels
- [ ] Update app.setName()
- [ ] Update WelcomeStep.tsx
- [ ] Update ReauthScreen.tsx
- [ ] Update SplashScreen.tsx import

### Phase 4: Build Config
- [ ] Update electron-builder.yml productName
- [ ] Update artifact naming

### Phase 5: Branding
- [ ] Update ASCII logo in branding.ts

### Phase 6: Validation
- [ ] Run visual regression tests
- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Accessibility audit
- [ ] Build and verify artifacts

---

## References

### Internal Files
- Theme system: `packages/shared/src/config/theme.ts:248-263`
- CSS variables: `apps/electron/src/renderer/index.css:71-206`
- Logo components: `apps/electron/src/renderer/components/icons/`
- Menu config: `apps/electron/src/main/menu.ts:53-68`
- Build config: `electron-builder.yml:2-130`

### External Resources
- [OKLCH Color Picker](https://oklch.com)
- [Electron Builder Icons](https://www.electron.build/icons.html)
- [WCAG Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Accessible Palette Generator](https://accessiblepalette.com/)

---

*Plan created: 2026-01-22*
