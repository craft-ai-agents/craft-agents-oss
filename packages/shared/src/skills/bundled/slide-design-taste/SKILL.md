---
name: slide-design-taste
description: "Use whenever designing or refining slide layouts inside an open-slide deck. Triggers on requests like 'make the deck look better', 'design a hero slide', 'redesign this layout', 'pick a palette', 'make this look like a Stripe/Linear/Apple deck', 'improve typography', 'tighten the visual hierarchy', or any aesthetic/visual judgment call. Pairs with the @open-slide-agent and the open-slide-decks skill — that one handles the lifecycle (scaffold, build, publish), this one handles taste (typography, color, hierarchy, composition)."
tags: [design, taste, typography, color, layout, slides, visual-hierarchy]
metadata:
  version: 1.0.0
  last_verified: 2026-05-28
---

# Slide Design Taste (open-slide)

Use this skill to make slides look **deliberate** instead of generic. open-slide already locks the canvas (1920 × 1080) and the stack (React + Tailwind). This skill governs the visual decisions inside that frame: **typography, color, hierarchy, composition, restraint**.

The job is not "decorate". The job is to **make one decision per slide so confidently that nothing else needs to fight for attention**.

---

## Operating principle: one focal point per slide

Every slide must answer: **what is the single thing the eye lands on first?**

- Cover → the headline.
- Section divider → the section number + name.
- Data slide → the number.
- Quote slide → the quote.
- Concept slide → the concept name.
- List slide → the heading; list items are second-class.

If two elements compete for first attention, you have not designed the slide. Shrink one, recolor it, push it down the type scale, or remove it.

**Hierarchy rule:** the focal element is at minimum **2× the visual weight** of the next element. Visual weight = font size × weight × contrast vs background.

---

## Pick one of four design moods, then stay there

Do not mix moods inside one deck. Pick one at the start; let every slide reinforce it.

### 1. Editorial (default for most decks)

- **Vibe:** New York Times Magazine, Stripe Press, Pentagram annual report.
- **Palette:** warm off-white background (`#F7F3EC` / `#FAF7F1`), near-black ink (`#0A0A0A`), one accent (deep ink-blue `#1E3A8A`, or oxblood `#7F1D1D`).
- **Type:** serif display + sans body. Or a single neo-grotesque used at one weight at multiple sizes.
- **Density:** generous whitespace, hairline rules (1px), small caps for meta lines.
- **Don't:** drop shadows, gradients, emoji headers, more than one accent color.

### 2. Modern minimal (best for product/tech)

- **Vibe:** Linear changelog, Vercel marketing, Apple keynote.
- **Palette:** pure black or pure white background, one neutral mid-tone, one accent (electric violet, lime, soft pink, or no accent at all — pure tonal).
- **Type:** Inter / Geist / SF Pro Display, mostly Medium and Semibold. Avoid Regular for display sizes.
- **Density:** tight, deliberate, lots of negative space, anchored grids.
- **Don't:** corporate clipart, "tech blue" gradients, every-slide drop-shadow cards.

### 3. Brutalist / industrial (best for contrarian, attention-grabbing decks)

- **Vibe:** Bloomberg terminal, tactical dashboards, Swiss industrial print.
- **Palette:** charcoal `#111111` or newsprint `#F4EFE6`, monolithic black grotesque type, hazard-red accent for emphasis only.
- **Type:** display grotesque at HUGE sizes (200px+), monospace for meta (specs, captions, footers).
- **Density:** numerals bleed into edges, ASCII bars/dots as decoration, hairline grid lines.
- **Don't:** soft corners, pastels, polished marketing tone.

### 4. Print magazine (best for narrative, conceptual, long-arc decks)

- **Vibe:** Aperture, Wallpaper, a coffee-table monograph.
- **Palette:** parchment background, ink-blue, one tertiary muted (sage / dusty rose / mustard).
- **Type:** italic display serif at oversized scale, grotesque body, pull-quotes set in italic with hairline rule above.
- **Density:** asymmetric margins, columns of different widths, full-bleed photography on transition slides.
- **Don't:** centered everything; magazine layouts almost always use asymmetric grids.

When the user just says "make it look good", default to **Editorial** unless the topic is product/tech (use Modern minimal) or finance/ops (use Brutalist).

---

## Typography

### Pick TWO faces total. Maximum.

- One display face, one body face. Or use a single face at multiple weights.
- Tailwind classes assume `font-sans` and `font-serif` are configured by the deck. Default to the deck's existing setup before adding fonts.
- **Reliable pairings:**
  - `Fraunces` (display) + `Inter` (body) — editorial
  - `Playfair Display` + `Inter` — magazine
  - `Geist` + `Geist Mono` — modern tech
  - `Inter` alone, weights 400 / 600 / 800 — minimal
  - `JetBrains Mono` + `Inter` — brutalist / terminal

### Type scale (1920×1080 canvas)

| Role | Size (px) | Weight | Tracking |
|------|-----------|--------|----------|
| Hero display | 160–240 | 600–800 | -0.02em |
| Section title | 120–160 | 600–800 | -0.015em |
| Slide title | 72–96 | 600–700 | -0.01em |
| Subtitle / lede | 36–48 | 400–500 | normal |
| Body | 28–32 | 400 | normal |
| Caption / meta | 18–22 | 400–500 (often uppercase, +0.08em tracking) | wide |

If a body line wraps to more than ~70 characters per line at the chosen size, **the text is too small or the column is too wide**. Fix the column, not the user's content.

### Italic and bold

- Use **italic for emphasis on one word per slide, max**. Italic + serif inside a phrase is a magazine signature.
- Bold within body copy is for keywords only, never whole phrases.
- Never set entire headlines in italic unless the whole deck does it.

---

## Color

### One palette, four roles

| Role | Definition |
|------|------------|
| Surface | Background |
| Ink | Primary text |
| Muted | Captions, hairlines, secondary UI |
| Accent | The single color that draws the eye — used on ≤ 5% of pixels per slide |

That's it. No "secondary accent". No "tertiary highlight". One accent.

### Tested palettes (paste into Tailwind config or use as inline values)

**Editorial cream:**
- surface `#F7F3EC` · ink `#0E0E0E` · muted `#A8A39B` · accent `#1E3A8A` (ink-blue)

**Modern minimal (light):**
- surface `#FFFFFF` · ink `#0A0A0A` · muted `#6B7280` · accent `#7C3AED` (violet)

**Modern minimal (dark):**
- surface `#0A0A0A` · ink `#F5F5F5` · muted `#6B7280` · accent `#A3E635` (lime)

**Brutalist newsprint:**
- surface `#F4EFE6` · ink `#111111` · muted `#888888` · accent `#B91C1C` (hazard-red)

**Print magazine parchment:**
- surface `#FAF6EE` · ink `#1A1A1A` · muted `#9C9485` · accent `#7F1D1D` (oxblood)

Do not invent a new palette mid-deck. If the user wants color variation, vary saturation/lightness of the existing accent — not hue.

---

## Layout & composition

### Asymmetry beats centering

Centered title + centered body is the visual grammar of a default Keynote template — and the reason every default deck looks the same. Anchor headlines to the **left edge** with a strong gutter, leave whitespace on the right (or vice versa). Center alignment is reserved for cover slides, section markers, and one-line statements.

### The 12-column mental grid

- Page padding: 96–128px on the outside.
- Inside that, think 12 columns with 32px gutters.
- Hero slides: headline lives in cols 1–8 or 5–12; the rest is whitespace, not filler.
- Two-column slides: 5/7 split (asymmetric) reads more deliberate than 6/6 (symmetric).

### Whitespace is content

- A slide with one sentence and a small caption is **stronger** than a slide with three bullet points and a chart.
- If a slide feels empty, the headline is not large enough, **not** the slide is not full enough.
- Never fill empty space with stock illustration, decorative shapes, or "oh, let's add a logo here".

### Hairlines and rules

- 1px hairlines (`border-zinc-300`, `border-stone-300`) are the most underused tool in a deck.
- Use hairlines to separate meta from content, to mark section transitions, and to underscore a single key word.
- **Never** use 3px+ borders unless the mood is brutalist.

---

## What to put on each slide type

### Cover

- Deck title (hero display size).
- One-line subtitle / kicker (caption size, all-caps, tracked +0.08em).
- Author + date in the bottom corner, in muted ink.
- Optional: a single hairline accent (vertical line in accent color, or a 1ch-tall accent dot).

### Section divider

- Big numeral (`01`, `02`) in display size, with the section name beside or below.
- Tiny meta line: total sections (`/ 04`).
- Background flips: cover/dividers can be ink-on-surface; content slides flip to surface-on-ink. This is the magazine signature.

### Concept slide

- One headline (≤ 8 words).
- One sentence of body (≤ 25 words).
- That's the whole slide.

### Data / stat slide

- The big number (200–280px, accent or ink).
- Caption: what the number is, in one short line (≤ 40 chars).
- Source/year line in muted, smallest size.

### Quote slide

- Open quote glyph in display size.
- The quote (italic if serif, regular if grotesque), max 2 lines.
- — Attribution, in caption size, em-dash before name.

### List slide

- Title (slide-title size).
- 3–5 items max. If you need more, split into two slides.
- Number them (01., 02.) in muted color; the item text is ink. Numbered lists out-design bulleted lists 90% of the time.
- Never use mixed-length items. Either every item fits on one line, or every item gets two lines — not a mix.

### Comparison / two-column

- 5/7 split. Headline spans full width.
- Left column: the "before / against / they / old way".
- Right column: the "after / for / us / new way".
- One hairline divider between them. No background-color blocks.

### Closing / thank-you / CTA

- One sentence (≤ 12 words).
- Contact info or next step in caption size, muted.
- Resist the urge to recap the whole deck on the last slide.

---

## Iconography & decoration

- **Default to none.** A great deck rarely needs icons.
- If icons are required, use **one stroke weight, one corner radius, one source library** (Lucide is a safe choice in React).
- Icons should be the same color as ink or muted — never a separate icon palette.
- Emoji belong in chat, not on slides. The single exception: a single emoji used as a decorative motif on the cover, by deliberate choice.
- Drop shadows: no.
- Gradients: only if they are the deliberate aesthetic motif (e.g., one full-bleed gradient on the cover); never as decoration on cards or buttons.

---

## Motion

- open-slide animates between slides; do not write per-element CSS animations unless the slide requires kinetic typography on purpose.
- If a slide must animate (e.g., a number counting up, a word appearing), it should animate **once on enter**, then settle. Looping ambient motion is noise.

---

## Quality bar — the 60-second test

Before declaring a deck "done", review every slide and ask:

1. **One focal point** — what is it?
2. **Two faces, max** — am I using more?
3. **One accent** — is anything else using color?
4. **Asymmetric** — or is this just centered defaults?
5. **Whitespace** — does this slide breathe, or is it stuffed?
6. **Hierarchy** — is the second element clearly subordinate?
7. **Type scale** — does anything sit between two scale steps (looks accidental)?
8. **Color contrast** — is body text at least AA against the surface?

If the answer to any of these is "no" or "I'm not sure", fix it before publishing to the canvas.

---

## Anti-patterns (do not do)

- Rounded corners on every card "to look modern" — looks dated.
- Background blur / glassmorphism cards — looks dated.
- "Hero gradient + glow + drop-shadow card stack" — looks dated.
- 5+ color palette — always looks amateur.
- Stock business clipart — kill it.
- Center-align everything — kills hierarchy.
- "And here are some bullet points…" — write a sentence instead.
- Speaker notes baked into the slide as small text — use real speaker notes.
- Identical layout repeated for every content slide — alternate slide types to give the eye rhythm.

---

## When in doubt

Default recipe — start every new deck with this and only deviate when there's a reason:

- **Mood:** Editorial.
- **Surface:** `#F7F3EC` (cream).
- **Ink:** `#0E0E0E`.
- **Muted:** `#A8A39B`.
- **Accent:** `#1E3A8A` (ink-blue).
- **Display face:** Fraunces, weight 600, tracking -0.02em.
- **Body face:** Inter, weight 400.
- **Hero size:** 200px.
- **Title size:** 88px.
- **Body size:** 32px.
- **Caption size:** 20px, uppercase, +0.08em tracking.
- **Padding:** 128px outer.
- **Hairline color:** `#D8D2C7` at 1px.
- **One accent dot or line per slide as a motif.**

This recipe alone produces decks that look better than 90% of what gets shipped. Vary it deliberately, never randomly.
