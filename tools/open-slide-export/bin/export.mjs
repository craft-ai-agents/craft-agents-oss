#!/usr/bin/env node
/**
 * open-slide-export — export built open-slide decks to distributable formats.
 *
 * Pipeline:
 *   1. Verify the deck has been built (`open-slide build`).
 *   2. For HTML: just return the path to dist/index.html.
 *   3. For PDF/PNG: spin up a tiny static server on dist/, drive it with
 *      headless Chromium (Playwright), and capture each slide via the
 *      framework's keyboard navigation (ArrowRight).
 *
 * Slide count is derived from the source `slides/` folder (one folder per
 * slide). This is the most reliable signal across open-slide versions —
 * no DOM fingerprinting required.
 *
 * Usage:
 *   node bin/export.mjs doctor
 *   node bin/export.mjs export <deck-path> --format html|pdf|png [--out-dir dist]
 *
 * Output: JSON receipt to stdout with absolute file paths the agent can
 * pass to create_output() for canvas display.
 */

import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Utilities ───────────────────────────────────────────────────────────────

function emit(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function fail(message, extra = {}) {
  emit({ success: false, error: message, ...extra });
  process.exit(1);
}

async function findFreePort(start = 18100, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    const ok = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.listen(port, '127.0.0.1', () => {
        s.close(() => res(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + attempts}`);
}

async function startStaticServer(rootDir, port) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };

  const server = createServer(async (req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    } catch {
      res.writeHead(400); res.end(); return;
    }
    if (pathname === '/') pathname = '/index.html';

    let filePath = join(rootDir, decodeURIComponent(pathname));

    // SPA fallback — if the file doesn't exist, serve index.html so the
    // client-side router can handle it.
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(rootDir, 'index.html');
    }

    if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
      res.writeHead(404); res.end(); return;
    }

    try {
      const buf = await readFile(filePath);
      const contentType = mime[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(buf);
    } catch {
      res.writeHead(500); res.end();
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

async function loadPlaywright() {
  try {
    const pw = await import('playwright');
    return pw;
  } catch {
    return null;
  }
}

/**
 * Count source slides by inspecting <deck>/slides/<id>/index.{tsx,jsx,ts,js}.
 * This is the canonical truth open-slide uses internally.
 */
function countSourceSlides(deckPath) {
  const slidesDir = join(deckPath, 'slides');
  if (!existsSync(slidesDir)) return 0;

  let count = 0;
  for (const entry of readdirSync(slidesDir)) {
    const entryPath = join(slidesDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const candidates = ['index.tsx', 'index.jsx', 'index.ts', 'index.js'];
    if (candidates.some((f) => existsSync(join(entryPath, f)))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Each slide module default-exports an array of Page components, so the
 * total page count = sum of that array length per slide module.
 *
 * We can't safely execute TSX; instead, we count `Page` array entries by
 * looking for the default export pattern. As a conservative fallback we
 * return the source slide count — better to under-count than to crash.
 */
function estimatePageCount(deckPath) {
  // Reliable upper bound: source slide count × pages-per-slide.
  // For decks where each slide module has multiple pages we still capture
  // them through ArrowRight navigation until the page stops advancing.
  return countSourceSlides(deckPath);
}

/**
 * Drive open-slide's keyboard navigation through every page and run the
 * provided async callback once per page, in order.
 *
 * Detection model: we step ArrowRight, then check whether the visible
 * content changed (using a stable hash of the slide container's text or
 * data-slide attribute). If content stops changing, we've reached the end.
 */
async function forEachSlide(page, sourceSlideCount, perPage) {
  const MAX_PAGES_HARD_CAP = Math.max(200, sourceSlideCount * 50);
  let captured = 0;
  let lastFingerprint = '';

  for (let i = 0; i < MAX_PAGES_HARD_CAP; i++) {
    // Wait for any transition to settle before reading state.
    await page.waitForTimeout(150);

    const fingerprint = await page.evaluate(() => {
      // Prefer explicit slide markers when the framework exposes them.
      const explicit = document.querySelector('[data-slide-index], [data-page-index]');
      if (explicit) {
        return (
          explicit.getAttribute('data-slide-index') ||
          explicit.getAttribute('data-page-index') ||
          ''
        );
      }
      // Fallback: hash visible text + first bounding rect of the slide root.
      const root =
        document.querySelector('[data-slide], [data-page], main, body > div') || document.body;
      const text = (root.innerText || '').slice(0, 4000);
      return `${text.length}:${text.slice(0, 200)}`;
    });

    if (i > 0 && fingerprint === lastFingerprint) {
      // Reached the end — content didn't advance.
      break;
    }
    lastFingerprint = fingerprint;

    await perPage(captured);
    captured += 1;

    await page.keyboard.press('ArrowRight');
  }

  return captured;
}

// ── Doctor ─────────────────────────────────────────────────────────────────

async function doctor() {
  const info = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  const pw = await loadPlaywright();
  info.playwright = pw ? 'available' : 'NOT installed';
  info.playwrightInstall = pw
    ? null
    : 'cd <deck>; npm i -D playwright; npx playwright install chromium';

  emit({ success: true, status: 'ok', info });
}

// ── HTML export ────────────────────────────────────────────────────────────

async function exportHtml(deckPath, outDir) {
  const distPath = resolve(deckPath, outDir);
  const indexPath = join(distPath, 'index.html');

  if (!existsSync(indexPath)) {
    fail(
      `dist/index.html not found at ${distPath}. Run \`open-slide build\` in the deck first.`,
      { distPath }
    );
  }

  emit({
    success: true,
    format: 'html',
    file: indexPath,
    distDir: distPath,
    count: 1,
    canvasKind: 'html',
  });
}

// ── PDF export ─────────────────────────────────────────────────────────────

async function exportPdf(deckPath, outDir) {
  const pw = await loadPlaywright();
  if (!pw) {
    fail(
      'Playwright not installed. Install it inside the deck folder:\n' +
        '  npm install -D playwright\n' +
        '  npx playwright install chromium',
      { needs: 'playwright' }
    );
  }

  const distPath = resolve(deckPath, outDir);
  if (!existsSync(join(distPath, 'index.html'))) {
    fail(`dist/index.html not found at ${distPath}. Run \`open-slide build\` first.`);
  }

  const sourceSlideCount = countSourceSlides(deckPath) || 1;
  const port = await findFreePort();
  const server = await startStaticServer(distPath, port);

  let browser;
  let captured = 0;
  const screenshots = [];
  const pdfPath = join(distPath, 'slides.pdf');

  try {
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // Try the dedicated present route first, then fall back to root.
    const presentUrl = `${server.url}/present`;
    const rootUrl = `${server.url}/`;
    const tryUrls = [presentUrl, rootUrl];

    let loaded = false;
    for (const url of tryUrls) {
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        if (resp && resp.ok()) { loaded = true; break; }
      } catch {
        // try next
      }
    }
    if (!loaded) {
      await page.goto(rootUrl, { waitUntil: 'load' });
    }

    // Hide any UI chrome so the PDF is pure slide content.
    await page.addStyleTag({
      content: `
        nav, header, footer, [data-thumbnail-rail], [data-toolbar],
        [data-slide-overlay], [data-debug] { display: none !important; }
      `,
    });

    await forEachSlide(page, sourceSlideCount, async (idx) => {
      const shotPath = join(distPath, `.export-tmp-${String(idx + 1).padStart(3, '0')}.png`);
      await page.screenshot({
        path: shotPath,
        fullPage: false,
        omitBackground: false,
      });
      screenshots.push(shotPath);
      captured = idx + 1;
    });

    if (screenshots.length === 0) {
      fail('No slides captured — deck appears empty.');
    }

    // Build a single multi-page PDF from the captured PNGs by writing an
    // intermediate HTML with one image per page, then printing it to PDF.
    const stitchHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 1920px 1080px; margin: 0; }
  html, body { margin: 0; padding: 0; background: black; }
  .slide { width: 1920px; height: 1080px; page-break-after: always; }
  .slide:last-child { page-break-after: auto; }
  .slide img { display: block; width: 1920px; height: 1080px; }
</style></head><body>
${screenshots.map((p, i) => `<div class="slide"><img src="file://${p}" alt="slide ${i + 1}"></div>`).join('\n')}
</body></html>`;

    const stitchPath = join(distPath, '.export-stitch.html');
    await writeFile(stitchPath, stitchHtml, 'utf8');

    const stitchPage = await context.newPage();
    await stitchPage.goto(`file://${stitchPath}`, { waitUntil: 'load' });
    await stitchPage.pdf({
      path: pdfPath,
      width: '1920px',
      height: '1080px',
      printBackground: true,
      pageRanges: '',
      preferCSSPageSize: true,
    });
    await stitchPage.close();
  } finally {
    if (browser) await browser.close();
    await server.stop();
    // Best-effort cleanup of stitch HTML; keep PNGs available so the agent
    // can also use them as PNG outputs if it wants.
    try {
      const { rm } = await import('node:fs/promises');
      await rm(join(distPath, '.export-stitch.html'), { force: true });
    } catch {
      // ignore
    }
  }

  emit({
    success: true,
    format: 'pdf',
    file: pdfPath,
    distDir: distPath,
    count: captured,
    canvasKind: 'pdf',
  });
}

// ── PNG export ─────────────────────────────────────────────────────────────

async function exportPng(deckPath, outDir) {
  const pw = await loadPlaywright();
  if (!pw) {
    fail(
      'Playwright not installed. Install it inside the deck folder:\n' +
        '  npm install -D playwright\n' +
        '  npx playwright install chromium',
      { needs: 'playwright' }
    );
  }

  const distPath = resolve(deckPath, outDir);
  if (!existsSync(join(distPath, 'index.html'))) {
    fail(`dist/index.html not found at ${distPath}. Run \`open-slide build\` first.`);
  }

  const exportDir = join(distPath, 'png');
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });

  const sourceSlideCount = countSourceSlides(deckPath) || 1;
  const port = await findFreePort();
  const server = await startStaticServer(distPath, port);

  const files = [];
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    await page.goto(`${server.url}/`, { waitUntil: 'networkidle' });
    await page.addStyleTag({
      content: `
        nav, header, footer, [data-thumbnail-rail], [data-toolbar],
        [data-slide-overlay], [data-debug] { display: none !important; }
      `,
    });

    await forEachSlide(page, sourceSlideCount, async (idx) => {
      const file = join(exportDir, `slide-${String(idx + 1).padStart(3, '0')}.png`);
      await page.screenshot({ path: file, fullPage: false });
      files.push(file);
    });
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }

  if (files.length === 0) {
    fail('No slides captured — deck appears empty.');
  }

  emit({
    success: true,
    format: 'png',
    files,
    distDir: distPath,
    count: files.length,
    canvasKind: 'png',
  });
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(
      `Usage:\n` +
        `  node bin/export.mjs doctor\n` +
        `  node bin/export.mjs export <deck-path> --format html|pdf|png [--out-dir dist]\n`
    );
    process.exit(command ? 0 : 1);
  }

  if (command === 'doctor') {
    await doctor();
    return;
  }

  if (command === 'export') {
    const deckPath = resolve(args[1] || '.');
    if (!existsSync(deckPath)) {
      fail(`Deck path does not exist: ${deckPath}`);
    }

    let format = 'html';
    let outDir = 'dist';

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--format' || args[i] === '-f') {
        format = args[++i];
      } else if (args[i] === '--out-dir' || args[i] === '-o') {
        outDir = args[++i];
      }
    }

    if (!['html', 'pdf', 'png'].includes(format)) {
      fail(`Unknown format: ${format}. Use html, pdf, or png.`);
    }

    if (format === 'html') return exportHtml(deckPath, outDir);
    if (format === 'pdf') return exportPdf(deckPath, outDir);
    if (format === 'png') return exportPng(deckPath, outDir);
  }

  fail(`Unknown command: ${command}`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err), { stack: err?.stack });
});
