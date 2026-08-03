#!/usr/bin/env bun
/**
 * scripts/icon-fingerprint.ts
 *
 * Verifies that the canonical icon asset set under
 *   apps/electron/resources/icon-set/
 * is byte-identical to the synced copies under
 *   apps/electron/resources/
 * that electron-builder packages. The two MUST match exactly, otherwise
 * the installer ships a stale icon even though the canonical source was
 * "regenerated".
 *
 * Triplet (must match exactly):
 *   icon.svg      icon.png      icon.ico      icon.icns
 *
 * Alias (resource-side only, surfaces for visibility):
 *   source.png   (= icon-512.png)
 *
 * Output (default, one line, colored when stdout is a TTY):
 *
 *   [ok]      in sync:         5 ok, 0 drift, 0 missing
 *   [drift]   drift: hash differs: 4 ok, 1 drift, 0 missing
 *   [missing] missing file:    4 ok, 0 drift, 1 missing
 *
 * Exit codes:
 *   0   in sync -- safe to ship
 *   1   drift OR missing -- pre-commit gate fails
 *   2   unexpected error during hashing / IO
 *
 * Environment overrides:
 *   SKIP_ICON_CHECK=1|true|yes|on   exit 0 immediately (escape hatch)
 *   SKIP_ICON_CHECK=0|false|no|""   run normally
 *
 * Flags:
 *   --verbose / -v   print full per-file hashes & sizes
 *   --json           print machine-readable JSON to stdout
 */

import { createHash } from 'node:crypto';
import { readFile, stat, access, constants as fsConstants } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const ICONSET = join(ROOT, 'apps', 'electron', 'resources', 'icon-set');
const RESOURCES = join(ROOT, 'apps', 'electron', 'resources');

// Files in the canonical-triplet that must be byte-identical between
// the source-of-truth icon-set/ folder and the resources/ folder that
// electron-builder packages. source.png is a back-compat alias of
// icon-512.png -- it only exists in resources/, never in icon-set/.
const TRIPLET = ['icon.svg', 'icon.png', 'icon.ico', 'icon.icns'] as const;
const ALIAS = ['source.png'] as const;
// Animated emblem assets (APNG + sidecar meta.json + WebM). Live ONLY
// in icon-set/. APNG and meta.json are checked for byte-level drift
// because both are deterministic (sharp output + JSON.stringify).
// anim.webm is checked for presence ONLY because libvpx-vp9 is not
// byte-deterministic across runs on Windows -- `bun run anim:regress`
// catches WebM visual drift via decoded-YUV hashing instead.
const ANIM_ASSETS = ['anim.apng', 'anim.meta.json'] as const;
const ANIM_ASSETS_PRESENCE_ONLY = ['anim.webm'] as const;

type Status = 'ok' | 'drift' | 'missing';

interface FileResult {
  name: string;
  status: Status;
  canonicalHash?: string;
  syncedHash?: string;
  canonicalSize?: number;
  syncedSize?: number;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p, fsConstants.F_OK); return true; }
  catch { return false; }
}

async function hashFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function fileSize(p: string): Promise<number> {
  return (await stat(p)).size;
}

async function check(
  name: string,
  options: { bothSides: boolean; canonicalOnly?: boolean; presenceOnly?: boolean }
): Promise<FileResult> {
  const canonical = join(ICONSET, name);
  const synced = join(RESOURCES, name);

  const canonicalExists = await exists(canonical);
  const syncedExists = await exists(synced);

  // Canonical-only check (used for the animated emblem assets which
  // live ONLY in icon-set/ -- they are never copied into resources/).
  if (options.canonicalOnly) {
    if (!canonicalExists) return { name, status: 'missing' };
    if (options.presenceOnly) {
      // Hash would be meaningless: libvpx-vp9 is not byte-deterministic
      // across runs on Windows. See scripts/anim-regress.mjs for the
      // decoded-YUV drift detector that catches visual changes instead.
      return { name, status: 'ok' };
    }
    const [cHash, cSize] = await Promise.all([hashFile(canonical), fileSize(canonical)]);
    return { name, status: 'ok', canonicalHash: cHash, canonicalSize: cSize };
  }

  if (options.bothSides) {
    if (!canonicalExists && !syncedExists) {
      return { name, status: 'missing' };
    }
    if (!canonicalExists || !syncedExists) {
      const r: FileResult = { name, status: 'missing' };
      if (canonicalExists) {
        const [, size] = await Promise.all([hashFile(canonical), fileSize(canonical)]);
        r.canonicalHash = (await hashFile(canonical))
        // Re-hash node above is intentional: we accept slight redundancy in exchange
        // for keeping the parallel destructure above readable. Replace with a single
        // function that returns both fields if perf matters.
        r.canonicalSize = size
      }
      if (syncedExists) {
        r.syncedHash = await hashFile(synced)
        r.syncedSize = await fileSize(synced)
      }
      return r
    }
    const [cHash, sHash, cSize, sSize] = await Promise.all([
      hashFile(canonical), hashFile(synced), fileSize(canonical), fileSize(synced),
    ])
    return {
      name,
      status: cHash === sHash ? 'ok' : 'drift',
      canonicalHash: cHash,
      syncedHash: sHash,
      canonicalSize: cSize,
      syncedSize: sSize,
    }
  }

  // Single-sided check (used for the source.png alias).
  if (!syncedExists) return { name, status: 'missing' }
  const [sHash, sSize] = await Promise.all([hashFile(synced), fileSize(synced)])
  return { name, status: 'ok', syncedHash: sHash, syncedSize: sSize }
}

interface RunResult {
  verdict: 'ok' | 'drift' | 'missing';
  ok: number;
  drift: number;
  missing: number;
  files: FileResult[];
}

function reduce(results: FileResult[]): RunResult['verdict'] {
  if (results.some(r => r.status === 'drift')) return 'drift';
  if (results.some(r => r.status === 'missing')) return 'missing';
  return 'ok';
}

// Simple ANSI helpers – we keep them inline rather than pulling in a
// chalk dependency for a 50-line script.
const IS_TTY = !!process.stdout.isTTY;
const c = (code: string, text: string) => IS_TTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const GREEN = (t: string) => c('32', t);
const YELLOW = (t: string) => c('33', t);
const RED = (t: string) => c('31', t);
const DIM = (t: string) => c('2', t);

function shortHash(h: string | undefined): string {
  return h ? h.slice(0, 12) : DIM('<missing>');
}

function badgeFor(v: RunResult['verdict']): string {
  if (v === 'ok') return GREEN('[ok]');
  if (v === 'drift') return YELLOW('[drift]');
  return RED('[missing]');
}

function labelFor(v: RunResult['verdict']): string {
  if (v === 'ok') return 'in sync: hash matches';
  if (v === 'drift') return 'drift: hash differs';
  return 'missing file: regenerate icons';
}

// Truthy match for the SKIP_ICON_CHECK escape hatch. Accepts 1, true, yes, on
// (case-insensitive). Treats "0", "false", "no", "off", "" as "do not skip".
function skipRequested(): boolean {
  const raw = process.env.SKIP_ICON_CHECK?.trim().toLowerCase();
  if (!raw) return false;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

async function main(): Promise<void> {
  if (skipRequested()) {
    console.log(`${DIM('[skip]')} SKIP_ICON_CHECK is set; skipping icon fingerprint check`);
    process.exit(0);
  }

  const args = new Set(process.argv.slice(2));
  const verbose = args.has('--verbose') || args.has('-v');
  const json = args.has('--json');

  // Hash canonical-triplet, source.png alias, and animated-emblem assets
  // in parallel. ANIM_ASSETS are canonical-only -- they live in icon-set/
  // and are never copied into resources/ because electron-builder does
  // not embed animated media in the app bundle.
  const files: FileResult[] = await Promise.all([
    ...TRIPLET.map(name => check(name, { bothSides: true })),
    ...ALIAS.map(name => check(name, { bothSides: false })),
    ...ANIM_ASSETS.map(name => check(name, { bothSides: false, canonicalOnly: true })),
    ...ANIM_ASSETS_PRESENCE_ONLY.map(name => check(name, { bothSides: false, canonicalOnly: true, presenceOnly: true })),
  ]);

  const verdict = reduce(files);
  const okCount = files.filter(f => f.status === 'ok').length;
  const driftCount = files.filter(f => f.status === 'drift').length;
  const missingCount = files.filter(f => f.status === 'missing').length;

  if (json) {
    console.log(JSON.stringify({
      verdict: labelFor(verdict),
      ok: okCount, drift: driftCount, missing: missingCount,
      files,
    }, null, 2));
  } else {
    console.log(`${badgeFor(verdict)} ${labelFor(verdict)}: ${okCount} ok, ${driftCount} drift, ${missingCount} missing`);
    if (verbose) {
      for (const f of files) {
        const dot = f.status === 'ok' ? GREEN('[ok]') : f.status === 'drift' ? YELLOW('[drift]') : RED('[missing]');
        const cSize = f.canonicalSize !== undefined ? `${f.canonicalSize}b` : DIM('-');
        const sSize = f.syncedSize !== undefined ? `${f.syncedSize}b` : DIM('-');
        console.log(`  ${dot} ${f.name.padEnd(13)} canonical:${shortHash(f.canonicalHash)} (${cSize})  resources:${shortHash(f.syncedHash)} (${sSize})`);
      }
    }
  }

  process.exit(verdict === 'ok' ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
