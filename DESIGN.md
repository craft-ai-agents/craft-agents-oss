# Design System — Craft Agents

> Source: `/design-consultation` 2026-05-08. Approved variant A (Editorial-Industrial) after a three-direction visual comparison. Live preview: [`docs/design/preview.html`](./docs/design/preview.html) — open the file in any browser; tabs A/B/C compare the explored directions, A's top rail toggles light/dark, accent, and density.
>
> **Always read this file before making any visual or UI decision in the chat surface, settings panes, or any new screen.** Token deltas vs the current renderer theme are tracked in `docs/design/chat-surface-tokens.patch`.

## Product Context

- **What this is:** Document-centric agent workspace. The chat surface is the narrative spine of a working session — user prompts, agent prose, tool calls, plan acceptances, and inline executions all live in one composed transcript.
- **Who it's for:** Builders + writers using Claude Agent SDK and Pi SDK side by side; users of craft.do moving from notes-and-docs into agent-driven work.
- **Space / industry:** Agent-IDE category. Sits between Claude.ai (pure chat), Cursor (code-IDE chat), and craft.do (notes/documents).
- **Project type:** Cross-platform desktop app (Electron) + web UI (Vite/React) sharing components from `packages/ui`.

## Aesthetic Direction

- **Direction:** Editorial-Industrial hybrid. Reading-grade typography for prose; monospace precision for metadata and code. Hairline rules and typographic hierarchy carry layout, not card chrome.
- **Decoration level:** Intentional. No floating shadow cards on the chat surface. Subtle warmth lives in the paper-white background and code-block strip. Nothing decorative.
- **Mood:** Document being written, not chat being conducted. The reader (the user) is in a slow-thinking mode with a careful collaborator.
- **Reference points:** Cursor's own marketing previews (their agent panel uses a serif body), iA Writer (geometric sans + monospace body in a paper card), Substack reader (long-form serif + monospace code), Are.na (warm paper, restrained accent).

### First-principles insight (recorded so future hands don't drift)

Chat UIs assume Slack-style 50-word burst reading and pick burst-optimized fonts (Inter, system-ui, Helvetica). Craft Agents users read 500–2000-word agent transcripts. **The right reference class is long-form reading, not chat.** Reading-optimized typography (serif body with optical-size axes, monospace metadata) is appropriate to actual user behavior. This insight is the load-bearing reason for every typography decision below; do not silently revert it without naming a successor thesis.

## Typography

| Role | Family | Source | Variation axes used |
|---|---|---|---|
| Body / prose | **Newsreader** | Google Fonts | `opsz` 18 (body), 22 (user prompts); `wght` 400/500; `ital` 0/1 |
| Display / hero | **Fraunces** | Google Fonts | `opsz` 96, `SOFT` 30, `WONK` 1; `wght` 400 |
| Metadata / code | **JetBrains Mono** | Google Fonts (already installed) | `wght` 400/500; `font-variant-numeric: tabular-nums` |
| UI (buttons, labels) | Newsreader (regular) | Same as body | No separate UI sans |

### Loading strategy

- Self-host or load from `fonts.googleapis.com` with `display: swap`.
- **Subset Newsreader** to Latin + Latin-extended (~120 KB).
- **Subset Fraunces to display-only weights** (400/500, opsz 36+ only); ~80 KB.
- **JetBrains Mono variable** wght axis only (~60 KB).
- Combined initial load ~260 KB. Preload `Newsreader` and `JetBrains Mono` via `<link rel="preload" as="font" crossorigin>`. Lazy-load Fraunces (display-only is rarely the first paint).
- Add `font-display: swap` to all `@font-face` rules.

### Scale (px / rem / line-height)

| Step | px | rem | line-height | Use |
|---|---|---|---|---|
| hero | 64 | 4.0 | 1.05 | Splash / workspace welcome |
| h1 | 48 | 3.0 | 1.10 | Settings page titles |
| h2 | 32 | 2.0 | 1.20 | Section heads |
| h3 | 22 | 1.375 | 1.30 | Subsection / panel titles |
| body (reading) | 17 | 1.0625 | 1.62 | Default agent prose, user prompts |
| body (working) | 15 | 0.9375 | 1.50 | Density-toggle compact mode |
| meta | 11 | 0.6875 | 1.40 | Uppercase, letter-spacing 0.06–0.10em |
| micro | 10.5 | 0.656 | 1.35 | Pill labels, badge text |

## Color

### Approach

Restrained. One ink color. One accent (with three named alternatives, user-selectable). Semantic colors quieted toward foreground for legibility on warm paper. **No purple anywhere.**

### Light mode (default)

```css
--bg:        #FBF9F2;  /* warm paper white */
--bg-elev:   #F4F0E5;  /* slightly warmer for cards & strips */
--ink:       #1F1A14;  /* warm near-black, not pure black */
--ink-soft:  #4A413A;  /* sepia gray for de-emphasized prose */
--ink-mute:  #8C8175;  /* faded for metadata */
--surface:   #FFFEFA;  /* composer card */
--rule:      rgba(31, 26, 20, 0.10);  /* hairlines */
--code-bg:   #F2EDE0;
```

### Dark mode (warm walnut)

```css
--bg:        #181410;
--bg-elev:   #221C16;
--ink:       #ECE6D6;
--ink-soft:  #B8AE9C;
--ink-mute:  #7A7166;
--surface:   #231D17;
--rule:      rgba(236, 230, 214, 0.10);
--code-bg:   #110D09;
```

### Accents (user-selectable; default `oxblood`)

| Name | Light | Dark | Notes |
|---|---|---|---|
| **oxblood** | `#6B1818` | `#C77258` | **Canonical default.** Sibling-product family with the codex landing. |
| ink-indigo | `#1F2A55` | `#8190CE` | Differentiation; reads more "tool-screen". |
| moss | `#2D4A2B` | `#8FB58A` | Quietest; pairs well with serif. |

Dark-mode accents are deliberately lifted into a reading range — a darker oxblood disappears on a dark walnut background.

### Semantic colors

| Token | Light | Dark | Use |
|---|---|---|---|
| success | `#2D6A3E` | `#7FAE7A` | Tool-call OK, plan applied |
| destructive | `oklch(0.58 0.24 28)` | `oklch(0.65 0.22 28)` | Errors, failed runs (kept from current theme; minor desaturation) |
| warning | `#B5832A` | `#D7A858` | Replaces current `oklch(0.75 0.16 70)` amber — desaturated for serif body legibility |

### Removed (against the new system)

- `--accent: oklch(0.62 0.13 293)` — purple, the AI-slop default. Removed entirely.
- `--accent-rgb: 104, 78, 133` — removed.
- All chat-surface uses of `shadow-minimal` and `shadow-modal-small`. Replaced by `1px solid var(--rule)` hairlines. Shadow utilities remain available for popovers, modals, and floating menus.

## Spacing

- **Base unit:** 4 px (Tailwind default kept).
- **Density:** Auto. Reading mode (38 px between turns) for sessions ≤ 10 turns; Working mode (22 px) for > 10 turns. **Top-bar toggle exposes a manual override** so the auto behavior is never opaque to the user.
- **Scale:** `2xs 2 / xs 4 / sm 8 / md 16 / lg 24 / xl 32 / 2xl 48 / 3xl 64`.
- **Vertical rhythm in chat:**
  - turn-gap: 38 px (reading) / 22 px (working)
  - paragraph-gap inside agent prose: 14 px (constant)
  - line-height: 1.62 (reading) / 1.50 (working)

## Layout

- **Approach:** Centered single-column reading layout for the chat surface; grid-disciplined for sidebars and settings.
- **Chat column max-width:** 720 px. Optimal for serif body at 17 px (≈ 65–75 characters per line).
- **Page gutter:** `clamp(24px, 5vw, 96px)`.
- **Border radius:** 0 px on chat-surface containers (continues the current `--radius: 0rem` decision); 4 px on inline pills/chips for affordance; full radius (9999 px) on send button.
- **Removed:** all `shadow-minimal` and `shadow-modal-small` from chat-surface backgrounds. Hairline `1px` rules replace card chrome.

## Motion

- **Approach:** Minimal-functional. The page should feel like a document opening, not an app loading.
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` for standard transitions; linear for the streaming cursor.
- **Duration:**

| Tier | ms | Use |
|---|---|---|
| micro | 100 | hover, button press |
| short | 220 | tool-call expand/collapse, turn entry fade |
| medium | 380 | page transitions, settings drawer |
| long | 600 | splash → workspace fade |

- **Streaming cursor:** 1.1 s blink, 2 steps. Color: `var(--accent)`.
- **Removed:** any bouncy entry choreography, shadow-pulse animations, color-shift hover treatments.

## Implementation Map

| Concern | File | Action |
|---|---|---|
| Theme tokens (light + dark) | `apps/electron/src/renderer/index.css` | Replace `--accent`, font stacks, `--bg`, `--foreground`. See `docs/design/chat-surface-tokens.patch`. |
| Font loading | `apps/webui/src/index.css` + electron renderer | Add Google Fonts links (Newsreader, Fraunces, JetBrains Mono — wght variable axes); preload body + mono. |
| User prompt component | `packages/ui/src/components/chat/UserMessageBubble.tsx` | Strip the `bg-foreground/5` pill background. Add a `→` glyph + role label header (mono meta). Use serif body. |
| Turn header | `packages/ui/src/components/chat/TurnCard.tsx` | New `.turn-head` row: `§ NN  ROLE  TIMESTAMP` in JetBrains Mono uppercase, 11 px. |
| Tool-call row | `packages/ui/src/components/chat/InlineExecution.tsx` | Border + bg from `--bg-elev` and `--rule`; mono everywhere. |
| Density toggle | New: `apps/electron/src/renderer/components/density-toggle.tsx` | **Engineering item, not a CSS toggle.** Reactive turn-counter on the active session, attribute write to `<html data-density="…">`, manual override via top-bar switch, persistence keyed by session in `localStorage`. Scope ≈ ½ day; do not estimate as the same size as the patch. |
| Accent picker | `apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx` (new section) | User-selectable oxblood / indigo / moss. Persists via existing settings storage. |

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-08 | Initial design system created | `/design-consultation` ran a three-direction visual comparison (editorial-industrial / industrial-mono / brutally-minimal). Direction A approved after live preview comparison and one round of pressure-testing. |
| 2026-05-08 | Drop `--accent` purple `oklch(0.62 0.13 293)` | Recognized as the AI-slop default. Replaced with three named accents (oxblood / indigo / moss); user-selectable, default oxblood (matches `/codex` sibling product). |
| 2026-05-08 | Drop `system-ui` body | The "I gave up on typography" signal. Replaced with Newsreader (variable `opsz`). Aligns with the first-principles insight that agent transcripts are long-form reading, not Slack-style bursts. |
| 2026-05-08 | Auto-density (reading ≤ 10 turns / working > 10) + manual override | User chose auto with the explicit caveat that auto-only behavior is unpredictable. Top-bar toggle resolves the predictability concern. |
| 2026-05-08 | Light mode default (warm paper) | Honors the document thesis — serif sings on paper. Departs from the current Craft dark default. Existing dark users get a setting; system-following also available. |
| 2026-05-08 | Drop user-prompt italic + heavy left rule | Italic on long prompts is fatiguing; the rule was doing too much work. Replaced with a `→` glyph + role label in the turn-head. Roman serif body for prompts. |
| 2026-05-08 | Drop small-caps first-line on agent prose | Too precious for code-fix responses. Editorial language survives without it. |
