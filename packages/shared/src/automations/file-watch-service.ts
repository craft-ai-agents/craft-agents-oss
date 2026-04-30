/**
 * FileWatch Service — fires `FileWatch` automations when files change.
 *
 * Each FileWatch matcher specifies:
 *   - watchPath  (directory to watch, defaults to workspace root)
 *   - watchGlob  (path pattern, e.g. "**\/*.md")
 *   - watchChangeTypes  (subset of add/change/remove)
 *   - watchDebounceMs  (coalesce rapid successive events)
 *
 * Routing is per-matcher: each emitted event carries the originating
 * matcher's ID, so the event-bus matcher iteration dispatches to exactly
 * one automation per change.
 *
 * Implementation:
 *   - One node:fs.watch per unique watchPath, shared across matchers that
 *     watch the same directory tree.
 *   - On 'rename' events we stat() the path to disambiguate add vs remove.
 *   - On 'change' events we stat() to skip directories.
 *   - Per-matcher debounce buckets (matcherId|relPath → timer).
 */

import { watch, statSync, type FSWatcher } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import type { AutomationMatcher, FileWatchChangeType } from './types.ts';
import type { FileWatchPayload } from './event-bus.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('file-watch');

const DEFAULT_DEBOUNCE_MS = 500;
const ALL_CHANGE_TYPES: FileWatchChangeType[] = ['add', 'change', 'remove'];

/**
 * Simple glob-to-regex compiler. Supports:
 *   - `*`  (any chars except path separator)
 *   - `**` (any chars including path separator)
 *   - `?`  (single char)
 *   - `[abc]` / `[a-z]` character classes
 *   - everything else literal
 *
 * Always anchors start+end. Always uses POSIX path separators (we normalize
 * relative paths to forward slashes before matching).
 */
export function globToRegex(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** — matches across path separators
        re += '.*';
        i += 2;
        // Optional trailing slash after ** to match "a/**/b" → "a/b"
        if (glob[i] === '/') i += 1;
      } else {
        // * — matches within a single path segment
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
        i += 1;
      } else {
        re += glob.slice(i, close + 1);
        i = close + 1;
      }
    } else if ('\\^$.|+(){}'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else if (c === '/') {
      re += '/';
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

export interface FileWatchServiceOptions {
  /** Resolves a matcher's watchPath against this base when it is relative. */
  workspaceRootPath: string;
  /** Workspace ID stamped into emitted payloads. */
  workspaceId: string;
  /** Called once per fired event — typically forwards into the event bus. */
  onEvent: (payload: FileWatchPayload) => void | Promise<void>;
}

export class FileWatchService {
  private readonly options: FileWatchServiceOptions;
  /** dir absolute path → { watcher, matcherIds linked to this dir } */
  private readonly watchers = new Map<string, { watcher: FSWatcher; matchers: WatchedMatcher[] }>();
  /** Per-matcher debounce timers keyed by `${matcherId}|${relPath}` */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(options: FileWatchServiceOptions) {
    this.options = options;
  }

  /**
   * (Re)configure the watcher set from the current FileWatch matchers.
   * Closes any obsolete watchers and opens new ones as needed.
   */
  applyMatchers(matchers: AutomationMatcher[]): void {
    if (this.disposed) return;

    // Bucket matchers by absolute watch directory
    const byDir = new Map<string, WatchedMatcher[]>();
    for (const m of matchers) {
      if (!m.id) continue; // Should be backfilled by AutomationSystem; skip if missing
      const dir = m.watchPath
        ? resolve(this.options.workspaceRootPath, m.watchPath)
        : this.options.workspaceRootPath;
      const compiled: WatchedMatcher = {
        matcherId: m.id,
        watchPathAbs: dir,
        regex: m.watchGlob ? globToRegex(m.watchGlob) : null,
        changeTypes: m.watchChangeTypes ?? ALL_CHANGE_TYPES,
        debounceMs: m.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS,
      };
      const list = byDir.get(dir) ?? [];
      list.push(compiled);
      byDir.set(dir, list);
    }

    // Close watchers for dirs that are no longer used
    for (const [dir, entry] of this.watchers) {
      if (!byDir.has(dir)) {
        try { entry.watcher.close(); } catch { /* ignore */ }
        this.watchers.delete(dir);
      }
    }

    // Open or refresh watchers for current dirs
    for (const [dir, dirMatchers] of byDir) {
      const existing = this.watchers.get(dir);
      if (existing) {
        existing.matchers = dirMatchers;
        continue;
      }
      try {
        // Recursive watch — supported on macOS/Windows natively, and on
        // Linux with Node 20+ (and Bun). If unsupported, the watcher will
        // throw and we degrade to no-op.
        const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
          this.handleRawEvent(dir, eventType, filename);
        });
        watcher.on('error', (err) => log.warn(`[file-watch] watcher error for ${dir}:`, err));
        this.watchers.set(dir, { watcher, matchers: dirMatchers });
        log.debug(`[file-watch] Watching ${dir} (${dirMatchers.length} matcher(s))`);
      } catch (err) {
        log.warn(`[file-watch] Failed to watch ${dir}:`, err);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    for (const [, entry] of this.watchers) {
      try { entry.watcher.close(); } catch { /* ignore */ }
    }
    this.watchers.clear();
  }

  // -------------------------------------------------------------------------

  private handleRawEvent(dir: string, eventType: string, filename: Buffer | string | null): void {
    if (this.disposed) return;
    if (filename == null) return;

    const fname = typeof filename === 'string' ? filename : filename.toString('utf8');
    const absPath = resolve(dir, fname);

    // Determine change type. fs.watch reports 'rename' for both add and remove —
    // disambiguate by stat()ing the path.
    let changeType: FileWatchChangeType;
    let size = 0;
    let isDirectory = false;
    if (eventType === 'rename') {
      try {
        const stat = statSync(absPath);
        size = Number(stat.size) || 0;
        isDirectory = stat.isDirectory();
        changeType = 'add';
      } catch {
        changeType = 'remove';
      }
    } else {
      // 'change' — file was modified
      try {
        const stat = statSync(absPath);
        size = Number(stat.size) || 0;
        isDirectory = stat.isDirectory();
      } catch {
        // Stat failed but we got a change event; treat as remove
        changeType = 'remove';
        this.dispatch(dir, absPath, fname, changeType, 0, false);
        return;
      }
      changeType = 'change';
    }

    this.dispatch(dir, absPath, fname, changeType, size, isDirectory);
  }

  private dispatch(
    dir: string,
    absPath: string,
    rawRelative: string,
    changeType: FileWatchChangeType,
    size: number,
    isDirectory: boolean,
  ): void {
    const entry = this.watchers.get(dir);
    if (!entry) return;

    // Normalize relative path to forward slashes for glob matching
    const relPath = rawRelative.split(sep).join(posix.sep);

    for (const m of entry.matchers) {
      if (!m.changeTypes.includes(changeType)) continue;
      if (m.regex && !m.regex.test(relPath)) continue;

      const debounceKey = `${m.matcherId}|${relPath}`;
      const existing = this.debounceTimers.get(debounceKey);
      if (existing) clearTimeout(existing);

      const fire = () => {
        this.debounceTimers.delete(debounceKey);
        const payload: FileWatchPayload = {
          workspaceId: this.options.workspaceId,
          timestamp: Date.now(),
          matcherId: m.matcherId,
          path: absPath,
          relativePath: relPath,
          changeType,
          size,
          isDirectory,
        };
        Promise.resolve(this.options.onEvent(payload)).catch((err) => {
          log.warn(`[file-watch] onEvent failed for ${m.matcherId}:`, err);
        });
      };

      if (m.debounceMs > 0) {
        this.debounceTimers.set(debounceKey, setTimeout(fire, m.debounceMs));
      } else {
        fire();
      }
    }
  }
}

interface WatchedMatcher {
  matcherId: string;
  watchPathAbs: string;
  regex: RegExp | null;
  changeTypes: FileWatchChangeType[];
  debounceMs: number;
}
