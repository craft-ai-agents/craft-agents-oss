/**
 * Craft Pages — on-disk store.
 *
 * Layout:
 *
 *   {pagesRoot}/{slug}/
 *     page.json                 manifest — NEVER served
 *     revisions/
 *       1/public/index.html …
 *       2/public/index.html …
 *
 * DEVIATION FROM plan.md §2.3, deliberate: there is **no `current.json`
 * pointer**. The current revision is the highest-numbered complete revision
 * directory.
 *
 * The plan proposed writing a revision then atomically swapping a small pointer
 * file, because a directory cannot be renamed over an existing non-empty
 * directory. That reasoning is right, but the pointer reintroduces the same
 * class of problem one level down: replacing an existing FILE by rename is not
 * reliably atomic on Windows either (`fs.rename` can fail with EPERM when the
 * target is open), which is exactly why
 * packages/shared/src/sessions/persistence-queue.ts:159 unlinks first and
 * accepts a gap.
 *
 * Renaming a directory onto a name that does NOT yet exist is atomic on both
 * POSIX and Windows. So a revision is staged at `revisions/.staging-{n}` and
 * renamed to `revisions/{n}` as the single commit step. A crash leaves either a
 * complete revision or a `.staging-` directory that is ignored on read and
 * cleaned up on the next write. No pointer, no gap, one fewer failure mode.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { checkFileSet, checkRelPath, checkSlug, hasIndexHtml } from './naming.ts';

export interface PageManifest {
  id: string;
  slug: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Queries the agent has REQUESTED for this page. A proposal that the approval
   * UI reads — never an authorization record. Grants live in an app-controlled
   * store outside any agent-writable directory (ADR 0001 D6 / WS7).
   */
  requestedQueries: string[];
}

export interface PageFileInput {
  path: string;
  /** UTF-8 text, or base64 when `encoding` is 'base64'. */
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  rev: number;
  files: string[];
  updatedAt: number;
}

export class PageStoreError extends Error {}

const STAGING_PREFIX = '.staging-';

function pageDir(pagesRoot: string, slug: string): string {
  return join(pagesRoot, slug);
}
function manifestPath(pagesRoot: string, slug: string): string {
  return join(pageDir(pagesRoot, slug), 'page.json');
}
function revisionsDir(pagesRoot: string, slug: string): string {
  return join(pageDir(pagesRoot, slug), 'revisions');
}
function revisionPublicDir(pagesRoot: string, slug: string, rev: number): string {
  return join(revisionsDir(pagesRoot, slug), String(rev), 'public');
}

function readManifest(pagesRoot: string, slug: string): PageManifest | null {
  const p = manifestPath(pagesRoot, slug);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PageManifest;
  } catch {
    return null;
  }
}

function writeManifest(pagesRoot: string, slug: string, m: PageManifest): void {
  writeFileSync(manifestPath(pagesRoot, slug), JSON.stringify(m, null, 2), 'utf-8');
}

/**
 * Highest complete revision, or 0 when none exists.
 * `.staging-*` directories are skipped: they are, by construction, incomplete.
 */
export function currentRev(pagesRoot: string, slug: string): number {
  const dir = revisionsDir(pagesRoot, slug);
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(STAGING_PREFIX)) continue;
    if (!/^\d+$/.test(name)) continue;
    const n = Number(name);
    if (n > max && existsSync(join(dir, name, 'public'))) max = n;
  }
  return max;
}

/** Remove leftover staging directories from an interrupted write. */
function sweepStaging(pagesRoot: string, slug: string): void {
  const dir = revisionsDir(pagesRoot, slug);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    try { rmSync(join(dir, name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function listFilesRecursive(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const abs = join(root, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else out.push(rel);
  }
  return out.sort();
}

function decode(f: PageFileInput): Buffer {
  return f.encoding === 'base64'
    ? Buffer.from(f.content, 'base64')
    : Buffer.from(f.content, 'utf-8');
}

/**
 * Write a new revision by staging then renaming. The rename target never
 * pre-exists, which is what makes the commit atomic on every platform.
 */
function commitRevision(
  pagesRoot: string,
  slug: string,
  rev: number,
  files: Array<{ path: string; data: Buffer }>,
): void {
  const revs = revisionsDir(pagesRoot, slug);
  mkdirSync(revs, { recursive: true });
  sweepStaging(pagesRoot, slug);

  const staging = join(revs, `${STAGING_PREFIX}${rev}`);
  const stagingPublic = join(staging, 'public');
  mkdirSync(stagingPublic, { recursive: true });

  try {
    for (const f of files) {
      const abs = join(stagingPublic, f.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, f.data);
    }
    renameSync(staging, join(revs, String(rev))); // ← the commit
  } catch (err) {
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function assertValidFiles(files: PageFileInput[]): Array<{ path: string; data: Buffer }> {
  const decoded = files.map(f => ({ path: f.path, data: decode(f) }));
  const check = checkFileSet(decoded.map(f => ({ path: f.path, bytes: f.data.length })));
  if (!check.ok) throw new PageStoreError(check.reason);
  return decoded;
}

export function createPage(
  pagesRoot: string,
  input: { slug: string; title: string; files: PageFileInput[] },
): { pageId: string; rev: number; files: string[] } {
  const slugCheck = checkSlug(input.slug);
  if (!slugCheck.ok) throw new PageStoreError(slugCheck.reason);
  if (existsSync(pageDir(pagesRoot, input.slug))) {
    throw new PageStoreError(`page "${input.slug}" already exists; use command "update"`);
  }
  const decoded = assertValidFiles(input.files);
  if (!hasIndexHtml(decoded.map(f => f.path))) {
    throw new PageStoreError('a page must contain index.html at its root');
  }

  mkdirSync(pageDir(pagesRoot, input.slug), { recursive: true });
  commitRevision(pagesRoot, input.slug, 1, decoded);

  const now = Date.now();
  // pageId is minted HERE, app-side. The agent never supplies it — a
  // model-chosen id could collide with or impersonate another page.
  const manifest: PageManifest = {
    id: randomUUID(),
    slug: input.slug,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    requestedQueries: [],
  };
  writeManifest(pagesRoot, input.slug, manifest);

  return { pageId: manifest.id, rev: 1, files: decoded.map(f => f.path).sort() };
}

export function updatePage(
  pagesRoot: string,
  input: {
    slug: string;
    files: PageFileInput[];
    /** Replace the whole tree instead of patching named files. */
    replaceAll?: boolean;
    /** Optimistic concurrency: fail if the current revision is not this. */
    expectedRev?: number;
    title?: string;
  },
): { pageId: string; rev: number; files: string[] } {
  const manifest = readManifest(pagesRoot, input.slug);
  if (!manifest) throw new PageStoreError(`page "${input.slug}" not found`);

  const cur = currentRev(pagesRoot, input.slug);
  if (input.expectedRev !== undefined && input.expectedRev !== cur) {
    throw new PageStoreError(
      `expectedRev ${input.expectedRev} but the page is at revision ${cur}. ` +
      'Re-read the page and reapply your change.',
    );
  }

  const incoming = assertValidFiles(input.files);

  // Patch mode copies the previous revision forward, so an update that names
  // only styles.css does not silently delete every other file. Full replacement
  // has to be asked for explicitly.
  const merged = new Map<string, Buffer>();
  if (!input.replaceAll && cur > 0) {
    const prev = revisionPublicDir(pagesRoot, input.slug, cur);
    for (const rel of listFilesRecursive(prev)) {
      merged.set(rel, readFileSync(join(prev, rel)));
    }
  }
  for (const f of incoming) merged.set(f.path, f.data);

  const finalFiles = [...merged.entries()].map(([path, data]) => ({ path, data }));
  const finalCheck = checkFileSet(finalFiles.map(f => ({ path: f.path, bytes: f.data.length })));
  if (!finalCheck.ok) throw new PageStoreError(finalCheck.reason);
  if (!hasIndexHtml(finalFiles.map(f => f.path))) {
    throw new PageStoreError('the resulting page would have no index.html at its root');
  }

  const next = cur + 1;
  commitRevision(pagesRoot, input.slug, next, finalFiles);

  manifest.updatedAt = Date.now();
  if (input.title) manifest.title = input.title;
  writeManifest(pagesRoot, input.slug, manifest);

  return { pageId: manifest.id, rev: next, files: finalFiles.map(f => f.path).sort() };
}

export function readPage(
  pagesRoot: string,
  slug: string,
  filePath?: string,
): { manifest: PageManifest; rev: number; files: string[]; content?: string } {
  const manifest = readManifest(pagesRoot, slug);
  if (!manifest) throw new PageStoreError(`page "${slug}" not found`);
  const rev = currentRev(pagesRoot, slug);
  const pub = revisionPublicDir(pagesRoot, slug, rev);
  const files = listFilesRecursive(pub);

  if (filePath === undefined) return { manifest, rev, files };

  const c = checkRelPath(filePath);
  if (!c.ok) throw new PageStoreError(`${filePath}: ${c.reason}`);
  if (!files.includes(filePath)) throw new PageStoreError(`"${filePath}" is not in page "${slug}"`);
  return { manifest, rev, files, content: readFileSync(join(pub, filePath), 'utf-8') };
}

export function listPages(pagesRoot: string): PageSummary[] {
  if (!existsSync(pagesRoot)) return [];
  const out: PageSummary[] = [];
  for (const slug of readdirSync(pagesRoot)) {
    if (slug.startsWith('.')) continue;
    const manifest = readManifest(pagesRoot, slug);
    if (!manifest) continue;
    const rev = currentRev(pagesRoot, slug);
    out.push({
      id: manifest.id,
      slug: manifest.slug,
      title: manifest.title,
      rev,
      files: listFilesRecursive(revisionPublicDir(pagesRoot, slug, rev)),
      updatedAt: manifest.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deletePage(pagesRoot: string, slug: string): { pageId: string } {
  const manifest = readManifest(pagesRoot, slug);
  if (!manifest) throw new PageStoreError(`page "${slug}" not found`);
  rmSync(pageDir(pagesRoot, slug), { recursive: true, force: true });
  return { pageId: manifest.id };
}
