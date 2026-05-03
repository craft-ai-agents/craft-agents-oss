---
name: HyperFrames Video Creator
description: "When the user wants to create a video, animation, motion graphics, or animated composition using HTML/CSS/GSAP. Also use when they say 'make a video,' 'animate,' 'motion graphics,' 'GSAP animation,' 'HyperFrames,' 'animated explainer,' 'kinetic typography,' or describe visual movement they want rendered to video. HTML is the source of truth for the composition."
inputs: User's request for a video, animation, or motion graphics composition.
outputs: Valid HyperFrames composition (HTML+CSS+JS) ready to render.
tags: [video, motion-graphics, gsap, animation, hyperframes]
---

# HyperFrames Video Creator

Use this skill when the user wants to **create, edit, or plan video content** using the HyperFrames framework.

## What you're producing

A video composition defined in HTML, CSS, and GSAP. The output is a directory with:
- `index.html` — root composition with `data-composition-id` directly in `<body>` (no `<template>` at root)
- Optional sub-compositions as external HTML files loaded via `data-composition-src`
- `design.md` (if authored) as the brand style contract
- Assets next to `index.html` or in relative subdirectories

## Prerequisites

Check if `hyperframes` is installed locally: `npx hyperframes --version`.
If not, install it: `npm install -g hyperframes` or `npx hyperframes ...`.

## Discovery (exploratory requests only)

For open-ended requests ("make me a product launch video", "create something for our brand"), gather intent before composing:

- **Audience** — who watches? Developers? Executives? General consumers?
- **Platform** — social (15s), website hero, product demo, internal?
- **Priority** — motion quality? content accuracy? brand fidelity? speed?
- **Variations** — options or a single best shot?

For specific requests ("add a title card", "fix timing on scene 3"), skip discovery.

## Design System

1. If `design.md` or `DESIGN.md` exists in the project, read it first. It is the source of truth for brand colors, fonts, and constraints. Use exact values; don't invent colors or substitute fonts.
2. If no `design.md` exists, ask the user for: mood, light or dark, any brand colors/fonts.
3. When design.md names a font that isn't built-in and isn't found locally (no `fonts/` directory with `.woff2` files), warn the user and pick the closest built-in fallback.

## Prompt Expansion

Run prompt expansion on every composition (except single-scene pieces and trivial edits).
Read the user's vision, check against `design.md` and `house-style.md`, and produce a consistent intermediate spec.

## Planning

Before writing HTML, think at high level:

1. **What** — narrative arc, key moments, emotional beats.
2. **Structure** — how many compositions, sub-compositions vs inline, what tracks carry what.
3. **Rhythm** — declare scene rhythm before implementing. Which scenes are quick hits, holds, where does energy peak. Example: `fast-fast-SLOW-fast-SHADER-hold`.
4. **Timing** — which clips drive duration, where transitions land, pacing.
5. **Layout** — build the static end-state first. No GSAP yet.
6. **Animate** — add motion after layout is verified.

**Build exactly what was asked.** Don't add supporting scenes, ambient music, or captions unless requested or genuinely needed and proposed.

## Layout Before Animation

Position every element where it should be at its **most visible moment** — the "hero frame." Write static HTML+CSS first.

- `.scene-content` MUST use `width: 100%; height: 100%; padding: Npx; display: flex; flex-direction: column; gap: Npx; box-sizing: border-box`.
- Use padding to push content inward. Reserve `position: absolute` ONLY for decorative elements.
- Add entrances with `gsap.from()` — animate FROM offscreen/invisible TO the CSS position.
- Add exits with `gsap.to()` only on the **final scene**.
- In sub-compositions loaded via `data-composition-src`, prefer `gsap.fromTo()`.

## Composition Structure

### Root (standalone)

The main `index.html` does **NOT** use `<template>`.

```html
<div data-composition-id="root" data-width="1920" data-height="1080">
  <!-- clips -->
  <style></style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // ... tweens ...
    window.__timelines["root"] = tl;
  </script>
</div>
```

### Sub-composition (external file)

Use a `<template>` wrapper. Register the timeline on `window.__timelines["<composition-id>"]`.

```html
<template id="intro-template">
  <div data-composition-id="intro" data-width="1920" data-height="1080">
    <!-- content -->
  </div>
</template>
```

Load in root:
```html
<div id="el-1"
     data-composition-id="intro"
     data-composition-src="compositions/intro.html"
     data-start="0"
     data-duration="10"
     data-track-index="1"></div>
```

## Data Attributes

### All Clips
| Attribute | Required | Values |
|-----------|----------|--------|
| `id` | Yes | Unique identifier |
| `data-start` | Yes | Seconds or clip ID reference (`"el-1"`, `"intro + 2"`) |
| `data-duration` | Yes (img/div/comp) | Seconds. Video/audio default to media duration. |
| `data-track-index` | Yes | Integer. Same-track clips cannot overlap. |
| `data-media-start` | No | Trim offset (seconds) |
| `data-volume` | No | 0–1 (default 1) |

`data-track-index` does NOT affect visual layering — use CSS `z-index`.

### Composition Clips
| Attribute | Required | Values |
|-----------|----------|--------|
| `data-composition-id` | Yes | Unique composition ID |
| `data-width` / `data-height` | Yes | Pixel dimensions (e.g. 1920x1080 or 1080x1920) |
| `data-composition-src` | No | Path to external HTML file |

## Video and Audio

Video: `muted playsinline`.
Audio: always a separate `<audio>` element.

```html
<video id="el-v"
       data-start="0" data-duration="30" data-track-index="0"
       src="video.mp4"
       muted playsinline crossorigin="anonymous"></video>
<audio id="el-a"
       data-start="0" data-duration="30" data-track-index="2"
       src="video.mp4"
       data-volume="1"></audio>
```

## Timeline Contract

- All timelines start `{ paused: true }` — the player controls playback.
- Register every timeline: `window.__timelines["<id>"] = tl`.
- Framework auto-nests sub-timelines — do NOT manually add them.
- Duration comes from `data-duration`, not from GSAP timeline length.
- Never create empty tweens to set duration.

## Rules (Non-Negotiable)

1. **Deterministic:** No `Math.random()`, `Date.now()`, or time-based logic.
2. **GSAP only visual properties:** Animate `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, transforms. Do NOT animate `visibility`, `display`.
3. **Do NOT call** `video.play()`, `audio.play()`, `pause()`, or `seek()` on media.
4. **Animation conflicts:** Never animate the same property on the same element from multiple timelines simultaneously.
5. **No `repeat: -1`:** Use finite repeat count: `repeat: Math.ceil(duration / cycleDuration) - 1`.
6. **Synchronous construction:** Never build timelines inside `async`, `setTimeout`, or Promises.
7. **No `gsap.set()` on later-scene clips** from page load. Use `tl.set(selector, vars, timePosition)` inside the timeline at/after the clip's `data-start`.
8. **Never use `<br>` in content text.** Use `max-width` for natural wrapping. Exception: deliberate per-word titles where each word is its own line.

## Scene Transitions (Non-Negotiable)

Every multi-scene composition must:

1. **ALWAYS use transitions between scenes.** No jump cuts.
2. **ALWAYS use entrance animations on every scene.** Every element animates IN via `gsap.from()`. No element may appear fully-formed.
3. **NEVER use exit animations except on the final scene.** The transition IS the exit. The outgoing scene's content must be fully visible at the moment the transition starts.
4. **Final scene only:** the last scene may fade elements out (e.g. fade to black).

## Animation Guardrails

- Offset first animation 0.1–0.3s (not t=0).
- Vary eases across entrance tweens — use at least 3 different eases per scene.
- Don't repeat an entrance pattern within a scene.
- Avoid full-screen linear gradients on dark backgrounds (H.264 banding — use radial or solid + localized glow).
- `font-variant-numeric: tabular-nums` on number columns.
- For dynamic text overflow, use `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`.

## Quality Checks (run after authoring)

**Fast (blocking):**
- `npx hyperframes lint`
- `npx hyperframes validate`

**Slow (parallel):**
- `npx hyperframes inspect` — fix overflows, or mark intentional ones with `data-layout-allow-overflow`. Mark decorative elements with `data-layout-ignore`.
- Contrast warnings: adjust color until WCAG AA passes (4.5:1 normal text, 3:1 large text).
- Design adherence if `design.md` exists.

**Animation map** (on new compositions and significant changes, not trivial edits):
```bash
node skills/hyperframes/scripts/animation-map.mjs <composition-dir> \
  --out <composition-dir>/.hyperframes/anim-map
```

## Editing Existing Compositions

When editing: **Read the actual files. Don't guess.**
- Match existing fonts, colors, animation patterns.
- Only change what was requested.
- Preserve timing of unrelated clips.

## Escalation / References

Load these on demand when the composition requires them:

- **Multi-scene compositions** — read `references/beat-direction.md` (rhythm templates) and `references/transitions.md` (transition types, shader routing).
- **Captions synced to audio** — read `references/captions.md`.
- **TTS / voiceover** — read `references/tts.md` and `references/narration.md`.
- **Audio-reactive visuals** — read `references/audio-reactive.md`.
- **Text emphasis patterns** — read `references/css-patterns.md`.
- **Visual techniques** — read `references/techniques.md`.
- **Typography rules** — read `references/typography.md`.
- **Motion principles** — read `references/motion-principles.md`.
- **Video-medium rules** — always read `references/video-composition.md`; these override web instincts.
- **No design.md** — read `house-style.md` for defaults and `visual-styles.md` for named presets.
- **Create a design.md** — read `references/design-picker.md` or ask the user for mood/light-dark/brand colors.

If a full HyperFrames installation is available, the reference files are in:
- `<repo>/skills/hyperframes/` (this SKILL.md)
- `<repo>/skills/hyperframes/references/`
- `<repo>/skills/hyperframes/scripts/`
