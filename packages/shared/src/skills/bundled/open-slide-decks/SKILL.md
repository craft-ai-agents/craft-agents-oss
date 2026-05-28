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

## 5. Show the deck in Canvas (Visual sidecar)

After every build, publish the export so the user sees the deck in-app:

1. Identify the deck artifact:
   - **Single HTML file** when possible: `dist/index.html`.
   - **Zipped folder** if multiple files are required: `zip -r dist.zip dist/` then publish `dist.zip`.
2. Call `create_output` with:
   - `kind: 'html'` for the static export (or `kind: 'document'` if the runtime expects it)
   - `showInCanvas: true`
   - `title: '<deck-id> — v<n>'`
   - `path: <absolute path to dist/index.html>`

Re-build and re-publish after each significant edit. Treat the latest output as the canonical preview.

## 6. Interactive editing (optional)

For tight live-edit loops, start the dev server in the background:

```bash
cd <workspace>/decks/<deck-id>
npx open-slide dev --port 5173
```

Tell the user the URL (`http://localhost:5173`). The Visual sidecar can load it as a browser surface. Stop the dev server when the user finishes editing — do not leave it running across sessions.

## 7. Export to PDF (when the user asks)

open-slide's static build is print-ready via the browser's print dialog. To produce a PDF programmatically:

1. Build the deck (`npx open-slide build`).
2. Start preview: `npx open-slide preview --port 4173`.
3. Use a headless browser (Playwright/Chromium if available) to print `http://localhost:4173/?print=true` to a PDF file in `<deck-id>/dist/<deck-id>.pdf`.
4. Stop the preview server.
5. Publish the PDF as an output with `showInCanvas: true`.

If Playwright/Chromium is not installed, tell the user and offer the browser-based print path instead.

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
