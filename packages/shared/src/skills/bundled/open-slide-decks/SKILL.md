---
name: open-slide-decks
description: "Use when creating, editing, exporting, or presenting slide decks with the open-slide framework. Triggers on requests like 'make a slide deck', 'build a presentation', 'add a slide about X', 'export the deck to HTML/PDF', 'open the deck in canvas', or any deck-authoring task. Built for the @open-slide-agent and the bundled `open-slide` source."
tags: [slides, presentation, deck, open-slide, html, pdf]
metadata:
  version: 1.0.0
  last_verified: 2026-05-28
---

# Open Slide Decks

Use this skill to author and ship React-based slide decks with the open-slide framework. Decks live per-workspace at `<workspace>/decks/<deck-id>/`. The agent runs everything locally — no API keys, no external services.

## Lifecycle

```
scaffold → install → author → build → publish-to-canvas → iterate
```

## 1. Scaffold a new deck

From `<workspace>/decks/`:

```bash
npx -y @open-slide/cli@latest init <deck-id> --name <deck-id>
```

Rules for `<deck-id>`:
- kebab-case
- short and topical (e.g. `q3-launch`, `pricing-overview`, `internal-okrs`)
- unique within the workspace's `decks/` folder

If the user did not provide a name, ask once before scaffolding. Do not invent a generic name like `slides` or `new-deck`.

## 2. Install dependencies (per deck, once)

```bash
cd <workspace>/decks/<deck-id>
pnpm install   # preferred
# fallback:
npm install
```

Wait for install to complete before authoring slides. The `open-slide` bin is provided by `@open-slide/core` and is only available after install.

## 3. Author slides

Each slide is a file at `slides/<page-id>/index.tsx` that default-exports an array of `Page` components.

Layout contract:
- **Fixed canvas: 1920 x 1080.** The framework scales it to the viewport.
- Slides use Tailwind classes (the scaffold ships with Tailwind preconfigured).
- Do not import Vite, React, or tsconfig — they live inside `@open-slide/core`.

Minimal example:

```tsx
import type { Page } from '@open-slide/core';

const Cover: Page = () => (
  <div className="flex h-full w-full items-center justify-center bg-black text-white">
    <h1 className="text-[140px] font-bold">Hello, Deck</h1>
  </div>
);

const pages: Page[] = [Cover];
export default pages;
export const meta = { title: 'Hello Deck' };
```

For longer authoring sessions, read the scaffolded `.claude/skills/slide-authoring/` reference once before designing slide layouts. It documents the type scale, palette, and density rules.

## 4. Build a static site

```bash
cd <workspace>/decks/<deck-id>
npx open-slide build --out-dir dist
```

This produces a self-contained `dist/` folder with `index.html`. No server required.

## 5. Export — use the bundled export tool

The `open-slide` source guide exposes the absolute path to the bundled export tool. The tool has three formats:

```bash
# Always start with a health check.
node "<export-tool>/bin/export.mjs" doctor

# HTML — uses the existing dist/. Best for fast iteration and in-app preview.
node "<export-tool>/bin/export.mjs" export <workspace>/decks/<deck-id> --format html

# PDF — multi-page 1920x1080 PDF via headless Chromium. Best for sharing.
node "<export-tool>/bin/export.mjs" export <workspace>/decks/<deck-id> --format pdf

# PNG — one PNG per slide at 1920x1080 @2x. Best for thumbnails / social.
node "<export-tool>/bin/export.mjs" export <workspace>/decks/<deck-id> --format png
```

Each command prints a JSON receipt with the absolute output path(s). Example:

```json
{
  "success": true,
  "format": "pdf",
  "file": "/abs/path/decks/<deck-id>/dist/slides.pdf",
  "distDir": "/abs/path/decks/<deck-id>/dist",
  "count": 12,
  "canvasKind": "pdf"
}
```

Use the `file` (or `files` for PNG) value as the input to `create_output`.

If `doctor` reports `playwright: NOT installed`, PDF/PNG export will fail. Tell the user to run inside the deck:

```bash
npm install -D playwright
npx playwright install chromium
```

…then retry. HTML export does not require Playwright.

## 6. Show the deck in Canvas (Visual sidecar)

After every export, publish the artifact:

1. Pick the artifact based on intent:
   - HTML → `dist/index.html` (live preview, smallest file, fast)
   - PDF → `dist/slides.pdf` (shareable, one file)
   - PNG → array of `dist/png/slide-NNN.png` (thumbnails, social)
2. Call `create_output` with:
   - `kind: 'html' | 'pdf' | 'png'` matching the format
   - `showInCanvas: true`
   - `title: '<deck-id> — v<n>'`
   - `path: <absolute artifact path from the export receipt>`

Re-export and re-publish after each significant edit. Treat the latest output as the canonical preview.

## 7. Interactive editing (optional)

For tight live-edit loops, start the dev server in the background:

```bash
cd <workspace>/decks/<deck-id>
npx open-slide dev --port 5173
```

Tell the user the URL (`http://localhost:5173`). The Visual sidecar can load it as a browser surface. Stop the dev server when the user finishes editing — do not leave it running across sessions.

## Approval gates

These actions need explicit user approval before running:

- **Deploy to external hosts** (Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.) — confirm the target domain/account.
- **Bulk edits across more than 3 slides** without an explicit instruction list — confirm the scope.
- **Deleting slides or the deck folder.**
- **Adding new dependencies** to a deck's `package.json`. Open-slide's runtime is intentionally minimal; prefer Tailwind utility classes and built-in HTML elements before pulling in extra packages.

## Don'ts

- Don't touch `node_modules/` files.
- Don't edit Vite or tsconfig files — they live in `@open-slide/core` and the workspace doesn't expose them.
- Don't paste credentials, API tokens, or analytics IDs into slide source.
- Don't claim the deck is "done" until a successful build exists and the latest `dist/` is published as a Canvas output.

## Receipt format

When you finish a deck action, return:

```text
Deck:        <deck-id>
Slides:      <n>
Build:       success | failed
Artifact:    <absolute path to dist/index.html or PDF>
Canvas:      published | not published
Next:        <one-line suggestion: add slides, refine layout, export PDF, deploy>
```
