/**
 * Craft Pages — naming and path-safety rules.
 *
 * Deliberately PURE STRING LOGIC with no filesystem access, so the rules that
 * matter most on Windows can be unit-tested from any OS. WS0 could only be run
 * on macOS; this module is the mitigation for that gap (see ADR 0001, "Not yet
 * verified").
 *
 * These checks run BEFORE any path is joined or touched. The server-side
 * containment guard (canonicalise + reject symlinked components) is a second,
 * independent layer — neither replaces the other.
 */

/** Max page slug length. Windows MAX_PATH is 260 and the full prefix is long:
 *  {workspaceRoot}/sessions/{uuid}/data/pages/{slug}/revisions/{n}/public/... */
export const MAX_SLUG_LENGTH = 48;

/** Max length of any single path segment inside a page. */
export const MAX_SEGMENT_LENGTH = 64;

/** Max depth below public/ — keeps the total path bounded. */
export const MAX_PATH_DEPTH = 6;

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_COUNT = 100;

/** Files a page may contain. Anything executable-by-the-OS is absent on purpose. */
export const ALLOWED_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.json', '.svg',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.txt', '.md', '.webmanifest',
]);

/**
 * Windows reserved device names. `CON`, `NUL`, `COM1` etc. are devices at EVERY
 * directory level and remain reserved WITH an extension — `CON.txt` still opens
 * the console. Creating one is not a traversal, but it hangs or errors in ways
 * that look like corruption, so reject rather than discover in the field.
 */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface Rejection {
  ok: false;
  reason: string;
}
export type Check = { ok: true } | Rejection;

const ok: Check = { ok: true };
const no = (reason: string): Rejection => ({ ok: false, reason });

/**
 * Validate a page slug. Lowercase alphanumeric + internal hyphens only —
 * deliberately narrower than the path rules below, because the slug is chosen
 * by the model and ends up in a URL, a directory name, and a user-facing label.
 */
export function checkSlug(slug: string): Check {
  if (!slug) return no('slug is empty');
  if (slug.length > MAX_SLUG_LENGTH) {
    return no(`slug is ${slug.length} chars; max is ${MAX_SLUG_LENGTH} (Windows MAX_PATH headroom)`);
  }
  if (!SLUG_RE.test(slug)) {
    return no('slug must be lowercase a-z, 0-9 and hyphens, starting and ending alphanumeric');
  }
  if (WINDOWS_RESERVED.has(slug)) return no(`"${slug}" is a reserved device name on Windows`);
  return ok;
}

/**
 * Validate a page-relative file path (e.g. "assets/logo.png").
 *
 * Rejects, in order: absolute paths, backslashes, drive letters and ADS
 * suffixes, NUL and control characters, percent-encoding, `.`/`..` segments,
 * dotfiles, Windows reserved device names, trailing dot/space, over-length
 * segments, and excessive depth.
 */
export function checkRelPath(p: string): Check {
  if (!p) return no('path is empty');
  if (p.length > 255) return no(`path is ${p.length} chars; max is 255`);

  if (p.startsWith('/')) return no('path must be relative, not absolute');
  if (p.includes('\\')) return no('backslashes are not allowed; use "/" as the separator');
  // Drive-relative ("C:foo") and NTFS alternate data streams ("x.html::$DATA").
  if (p.includes(':')) return no('":" is not allowed (Windows drive-relative paths and alternate data streams)');
  if (p.includes('\0')) return no('NUL byte in path');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return no('control characters in path');
  // Percent-encoding must be resolved by the caller, never stored — otherwise
  // "%2e%2e" round-trips into ".." somewhere downstream.
  if (p.includes('%')) return no('"%" is not allowed; paths must be stored decoded');
  if (p.endsWith('/')) return no('path must reference a file, not a directory');

  const segments = p.split('/');
  if (segments.length > MAX_PATH_DEPTH) {
    return no(`path is ${segments.length} segments deep; max is ${MAX_PATH_DEPTH}`);
  }

  for (const seg of segments) {
    if (seg === '') return no('empty path segment (double slash)');
    if (seg === '.' || seg === '..') return no('"." and ".." segments are not allowed');
    if (seg.startsWith('.')) return no(`dotfiles are not allowed ("${seg}")`);
    if (seg.length > MAX_SEGMENT_LENGTH) {
      return no(`path segment "${seg.slice(0, 20)}…" is ${seg.length} chars; max is ${MAX_SEGMENT_LENGTH}`);
    }
    // Windows silently strips trailing dots and spaces, so "a " and "a" become
    // the same file — a collision that is invisible on POSIX.
    if (/[ .]$/.test(seg)) return no(`path segment "${seg}" ends with a space or dot (Windows strips these)`);
    const base = (seg.split('.')[0] ?? '').toLowerCase();
    if (WINDOWS_RESERVED.has(base)) return no(`"${seg}" uses a reserved device name on Windows`);
  }

  const last = segments[segments.length - 1] ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return no(`"${last}" has no file extension`);
  const ext = last.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return no(`extension "${ext}" is not allowed; permitted: ${[...ALLOWED_EXTENSIONS].sort().join(' ')}`);
  }

  return ok;
}

/**
 * Case-insensitive collision detection.
 *
 * macOS and Windows filesystems are typically case-insensitive; Linux is not.
 * Two files differing only in case therefore round-trip on Linux and silently
 * overwrite each other elsewhere. Caught here so behaviour is identical on all
 * three platforms.
 */
export function findCaseCollisions(paths: string[]): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const p of paths) {
    // Fold BOTH the ways a filesystem can merge two distinct names:
    //
    //   case         — "A.html" and "a.html" are one file on macOS/Windows
    //   normalisation — "café" as NFC and as NFD are one file on macOS,
    //                   two on Linux (measured on APFS and ext4)
    //
    // Normalisation is the worse of the two, because the colliding names are
    // visually IDENTICAL: a reviewer reading the file list cannot see it.
    const key = p.normalize('NFC').toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined && prev !== p) collisions.push(`${prev} vs ${p}`);
    else seen.set(key, p);
  }
  return collisions;
}

/** Validate a whole file set: paths, per-file size, total size, count, collisions. */
export function checkFileSet(files: Array<{ path: string; bytes: number }>): Check {
  if (files.length === 0) return no('a page must contain at least one file');
  if (files.length > MAX_FILE_COUNT) {
    return no(`${files.length} files; max is ${MAX_FILE_COUNT}`);
  }

  let total = 0;
  for (const f of files) {
    const c = checkRelPath(f.path);
    if (!c.ok) return no(`${f.path}: ${c.reason}`);
    if (f.bytes > MAX_FILE_BYTES) {
      return no(`${f.path} is ${f.bytes} bytes; per-file max is ${MAX_FILE_BYTES}`);
    }
    total += f.bytes;
  }
  if (total > MAX_TOTAL_BYTES) {
    return no(`total ${total} bytes; max is ${MAX_TOTAL_BYTES}`);
  }

  const collisions = findCaseCollisions(files.map(f => f.path));
  if (collisions.length > 0) {
    return no(
      'paths that differ only in case or in unicode normalisation collide as one '
      + `file on macOS/Windows: ${collisions.join(', ')}`,
    );
  }

  return ok;
}

/** A page must have an entry point, or there is nothing to serve. */
export function hasIndexHtml(paths: string[]): boolean {
  return paths.includes('index.html');
}
