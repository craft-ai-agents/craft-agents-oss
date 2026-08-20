/**
 * Bundled Skill Packs (runtime-context-marketplace M3, plan §4)
 *
 * Ships pinned snapshots of curated open skill packs under
 * `apps/electron/resources/skills/<pack-slug>/` (see SKILLS.lock there for
 * origin/commit pins) and syncs them into the global skills tier
 * `~/.agents/skills/` on app startup, so agents know them out of the box.
 *
 * Layout: skills discovery (storage.ts loadSkillsFromDir) is FLAT — a skill is
 * `<skills-root>/<skill-slug>/SKILL.md` with no recursion. Therefore each pack
 * installs its skills as top-level directories of `~/.agents/skills/`, and a
 * per-pack state file under `~/.agents/skills/.bundled/<pack-slug>.json`
 * (dot-prefixed, ignored by discovery) records the sha256 of every file we
 * wrote ("last known bundle version").
 *
 * Hash-merge semantics (user edits are never overwritten):
 * - target missing                        → write bundle file
 * - target hash == state hash             → managed by us, free to overwrite (upgrade)
 * - target hash != state hash             → user-modified → keep, flag localModified
 * - file removed from newer bundle        → delete only if target still matches state
 * - target unknown to state               → overwrite only if identical to bundle
 * - skill dir owned by another pack       → conflict: whole skill skipped
 *
 * Atomicity: for every changed skill dir we stage the merged result under a
 * dot-prefixed tmp dir and swap via rename (existing dir moved to a dot-prefixed
 * backup first, restored on failure). Packs listed in
 * `config.bundledSkills.disabled` are skipped entirely — their files on disk
 * are left untouched (we never delete user data).
 *
 * The whole sync degrades gracefully: any failure is logged and reported in
 * the returned status, never thrown — app startup must not crash on skills.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, join, relative } from 'path';
import { GLOBAL_AGENT_SKILLS_DIR } from './storage.ts';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { safeJsonParse } from '../utils/files.ts';
import { loadStoredConfig } from '../config/storage.ts';

// ============================================================
// Types
// ============================================================

const SKILLS_LOCK_FILE = 'SKILLS.lock';
const STATE_DIR_NAME = '.bundled';

interface SkillsLockPack {
  slug: string;
  origin?: string;
  commit?: string;
  license?: string;
  upstream?: { origin?: string; path?: string; commit?: string; note?: string };
  skills?: string[];
}

interface SkillsLockFile {
  version?: number;
  packs?: SkillsLockPack[];
}

/** Per-pack sync state, persisted at `<skills-root>/.bundled/<pack-slug>.json`. */
interface BundledPackState {
  version: number;
  pack: string;
  commit: string | null;
  syncedAt: string;
  /** `<skill-slug>/<relative-path>` → sha256 of file content as shipped by the bundle. */
  files: Record<string, string>;
}

export interface BundledSkillPackStatus {
  /** Pack slug = bundle directory name (also the `bundledSkills.disabled` key). */
  slug: string;
  origin: string | null;
  /** Pinned upstream commit this pack was vendored from (SKILLS.lock). */
  commit: string | null;
  /** Pack is listed in config `bundledSkills.disabled` — sync skipped it entirely. */
  disabled: boolean;
  /** True when at least one user-modified or foreign-owned file was preserved instead of overwritten. */
  localModified: boolean;
  /** Skill slugs shipped by the bundle. */
  skills: string[];
  /** Skill slugs present on disk after the sync. */
  installed: string[];
  /** Skill slugs skipped because their target dir belongs to another pack. */
  conflicts: string[];
  /** Set when this pack failed to sync (status information only — not fatal). */
  error?: string;
}

export interface EnsureBundledSkillsOptions {
  /** Bundle root (default: getBundledAssetsDir('skills')). */
  bundleRoot?: string;
  /** Install target (default: GLOBAL_AGENT_SKILLS_DIR — `~/.agents/skills`). */
  targetRoot?: string;
  /** Disabled pack slugs (default: config `bundledSkills.disabled`). */
  disabled?: string[];
}

export interface EnsureBundledSkillsResult {
  packs: BundledSkillPackStatus[];
  bundleRoot: string | null;
  targetRoot: string;
}

// ============================================================
// Session guard (same pattern as initializeDocs/ensureDefaultPermissions)
// ============================================================

let bundledSkillsInitialized = false;

/** Test hook: reset the per-session init guard. */
export function resetBundledSkillsInitialized(): void {
  bundledSkillsInitialized = false;
}

// ============================================================
// Internals
// ============================================================

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Recursively list files of `dir` as relative paths. Dot entries are internal state, never content. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(current, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue; // dangling symlink — skip
        }
      }
      if (isDir) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

/** Direct child dirs of `packDir` that contain a SKILL.md (= installable skills). */
function listPackSkillDirs(packDir: string): string[] {
  const skills: string[] = [];
  for (const entry of readdirSync(packDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (existsSync(join(packDir, entry.name, 'SKILL.md'))) {
      skills.push(entry.name);
    }
  }
  return skills.sort();
}

function readSkillsLock(bundleRoot: string): Map<string, SkillsLockPack> {
  const map = new Map<string, SkillsLockPack>();
  const lockPath = join(bundleRoot, SKILLS_LOCK_FILE);
  if (!existsSync(lockPath)) return map;
  try {
    // Lock is a repo-maintained JSON file we control — a typed cast is enough here.
    const parsed = safeJsonParse(readFileSync(lockPath, 'utf-8')) as SkillsLockFile | null;
    for (const pack of parsed?.packs ?? []) {
      if (pack && typeof pack.slug === 'string') map.set(pack.slug, pack);
    }
  } catch {
    // Corrupt lock — fall back to directory scan with null metadata.
  }
  return map;
}

function readPackState(targetRoot: string, packSlug: string): BundledPackState | null {
  const path = join(targetRoot, STATE_DIR_NAME, `${packSlug}.json`);
  if (!existsSync(path)) return null;
  try {
    // State file is written by us below — validate shape minimally and bail on mismatch.
    const parsed = safeJsonParse(readFileSync(path, 'utf-8')) as BundledPackState | null;
    if (!parsed || parsed.pack !== packSlug || typeof parsed.files !== 'object' || parsed.files === null) {
      return null;
    }
    return parsed;
  } catch {
    return null; // corrupt state → unknown ownership → conservative sync
  }
}

function writePackState(targetRoot: string, state: BundledPackState): void {
  const dir = join(targetRoot, STATE_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${state.pack}.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/**
 * Build a manifest for a directory tree: `<skill>/<rel>` → { abs path, sha256 }.
 * Works for both the bundle pack dir and the skills target root (missing skill
 * dirs contribute nothing, which naturally models first-install and removals).
 */
function buildManifest(rootDir: string, skillSlugs: string[]): Map<string, { abs: string; sha: string }> {
  const manifest = new Map<string, { abs: string; sha: string }>();
  for (const skill of skillSlugs) {
    const skillDir = join(rootDir, skill);
    if (!existsSync(skillDir)) continue; // disk variant: skill absent → empty manifest
    for (const rel of listFilesRecursive(skillDir)) {
      const abs = join(skillDir, rel);
      manifest.set(`${skill}/${rel}`, { abs, sha: sha256OfFile(abs) });
    }
  }
  return manifest;
}

// ============================================================
// Public API
// ============================================================

/**
 * Sync all bundled skill packs into the global skills tier. Called once at app
 * startup from Electron main (next to initializeDocs). Never throws.
 */
export function ensureBundledSkills(options?: EnsureBundledSkillsOptions): EnsureBundledSkillsResult {
  // Per-session guard fires only for the ambient (no-options) startup call;
  // explicit option injection (tests, tools) always runs.
  if (!options) {
    if (bundledSkillsInitialized) {
      return { packs: [], bundleRoot: null, targetRoot: GLOBAL_AGENT_SKILLS_DIR };
    }
    bundledSkillsInitialized = true;
  }

  const targetRoot = options?.targetRoot ?? GLOBAL_AGENT_SKILLS_DIR;
  const result: EnsureBundledSkillsResult = { packs: [], bundleRoot: null, targetRoot };

  try {
    const bundleRoot = options?.bundleRoot ?? getBundledAssetsDir('skills');
    if (!bundleRoot || !existsSync(bundleRoot)) {
      debug('[bundled-skills] Bundle root not found — skipping sync');
      return result;
    }
    result.bundleRoot = bundleRoot;

    let disabled = options?.disabled;
    if (!disabled) {
      try {
        disabled = loadStoredConfig()?.bundledSkills?.disabled ?? [];
      } catch {
        disabled = []; // config unreadable — treat as "nothing disabled"
      }
    }
    const disabledSet = new Set(disabled);
    const lock = readSkillsLock(bundleRoot);
    const packSlugs = readdirSync(bundleRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();

    if (!existsSync(targetRoot)) {
      mkdirSync(targetRoot, { recursive: true });
    }

    // Ownership map: skill dir → owning pack, from previously written states.
    // Prevents one pack from clobbering another pack's same-named skill dir.
    const ownerOf = new Map<string, string>();
    const stateDir = join(targetRoot, STATE_DIR_NAME);
    if (existsSync(stateDir)) {
      for (const file of readdirSync(stateDir)) {
        if (!file.endsWith('.json')) continue;
        const state = readPackState(targetRoot, file.slice(0, -'.json'.length));
        if (!state) continue;
        for (const key of Object.keys(state.files)) {
          const slash = key.indexOf('/');
          if (slash > 0) ownerOf.set(key.slice(0, slash), state.pack);
        }
      }
    }

    for (const slug of packSlugs) {
      const meta = lock.get(slug);
      const status: BundledSkillPackStatus = {
        slug,
        origin: meta?.origin ?? null,
        commit: meta?.commit ?? meta?.upstream?.commit ?? null,
        disabled: disabledSet.has(slug),
        localModified: false,
        skills: [],
        installed: [],
        conflicts: [],
      };
      result.packs.push(status);

      if (status.disabled) {
        debug(`[bundled-skills] Pack "${slug}" disabled via config — skipped`);
        continue;
      }

      try {
        const bundleManifest = syncPack(bundleRoot, targetRoot, slug, status, ownerOf);
        writePackState(targetRoot, {
          version: 1,
          pack: slug,
          commit: status.commit,
          syncedAt: new Date().toISOString(),
          files: Object.fromEntries([...bundleManifest].map(([key, { sha }]) => [key, sha])),
        });
        for (const skill of status.skills) {
          if (!status.conflicts.includes(skill)) ownerOf.set(skill, slug);
        }
        debug(`[bundled-skills] Synced pack "${slug}": ${status.installed.length} skills${status.localModified ? ' (local modifications preserved)' : ''}`);
      } catch (error) {
        status.error = error instanceof Error ? error.message : String(error);
        debug(`[bundled-skills] Pack "${slug}" sync failed:`, status.error);
      }
    }
  } catch (error) {
    // Startup must never crash on skills sync — degrade to a debug log line.
    debug('[bundled-skills] ensureBundledSkills failed:', error instanceof Error ? error.message : error);
  }

  return result;
}

/**
 * Merge one pack into the target root. Returns the bundle manifest (used by the
 * caller to persist the pack state). Throws on hard IO errors — the caller
 * catches per-pack and reports via status.error.
 */
function syncPack(
  bundleRoot: string,
  targetRoot: string,
  slug: string,
  status: BundledSkillPackStatus,
  ownerOf: ReadonlyMap<string, string>,
): Map<string, { abs: string; sha: string }> {
  const packDir = join(bundleRoot, slug);
  const skills = listPackSkillDirs(packDir);
  status.skills = skills;
  const bundleManifest = buildManifest(packDir, skills);
  const stateFiles = readPackState(targetRoot, slug)?.files ?? {};

  const tmpRoot = join(targetRoot, `.bundled-tmp-${slug}-${process.pid}`);
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  try {
    for (const skill of skills) {
      // Foreign ownership: another pack previously installed this skill dir.
      const owner = ownerOf.get(skill);
      if (owner && owner !== slug) {
        status.conflicts.push(skill);
        debug(`[bundled-skills] Skill "${skill}" of pack "${slug}" skipped — owned by pack "${owner}"`);
        continue;
      }

      const disk = buildManifest(targetRoot, [skill]);
      const writes: { rel: string; from: string }[] = [];
      const deletes: string[] = [];

      // 1. Bundle files: decide per file whether the bundle version may land.
      for (const [key, { abs, sha }] of bundleManifest) {
        if (!key.startsWith(`${skill}/`)) continue;
        const rel = key.slice(skill.length + 1);
        const diskSha = disk.get(key)?.sha;

        if (diskSha === undefined) {
          writes.push({ rel, from: abs }); // new file
        } else if (diskSha === sha) {
          continue; // identical already
        } else if (stateFiles[key] !== undefined && diskSha === stateFiles[key]) {
          writes.push({ rel, from: abs }); // managed by us and unmodified → upgrade
        } else {
          status.localModified = true; // user-modified or foreign — preserve
        }
      }

      // 2. Bundle removals: file tracked by state but gone from the bundle.
      for (const key of Object.keys(stateFiles)) {
        if (!key.startsWith(`${skill}/`) || bundleManifest.has(key)) continue;
        const rel = key.slice(skill.length + 1);
        const diskSha = disk.get(key)?.sha;
        if (diskSha === undefined) continue; // user already deleted it
        if (diskSha === stateFiles[key]) {
          deletes.push(rel); // unmodified → safe to drop
        } else {
          status.localModified = true; // user edited a file the pack dropped — keep
        }
      }

      if (writes.length === 0 && deletes.length === 0) {
        if (disk.size > 0) status.installed.push(skill); // already in sync / preserved
        continue;
      }

      // Stage: start from the current target so user-added files survive, then
      // apply bundle ops and swap atomically via rename (dot-prefixed backup).
      const targetDir = join(targetRoot, skill);
      const stagedDir = join(tmpRoot, skill);
      const hadTarget = existsSync(targetDir);
      if (hadTarget) {
        cpSync(targetDir, stagedDir, { recursive: true });
      } else {
        mkdirSync(stagedDir, { recursive: true });
      }
      for (const { rel, from } of writes) {
        const dest = join(stagedDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(from, dest);
      }
      for (const rel of deletes) {
        rmSync(join(stagedDir, rel), { force: true });
      }

      const backupDir = join(targetRoot, `.craft-bak-${skill}-${process.pid}`);
      if (hadTarget) {
        renameSync(targetDir, backupDir);
      }
      try {
        renameSync(stagedDir, targetDir);
      } catch (error) {
        // Roll back: restore the previous dir so the user never loses content.
        if (hadTarget && existsSync(backupDir) && !existsSync(targetDir)) {
          try {
            renameSync(backupDir, targetDir);
          } catch {
            // leave backup on disk for manual recovery
          }
        }
        throw error;
      }
      if (hadTarget) {
        rmSync(backupDir, { recursive: true, force: true });
      }
      status.installed.push(skill);
    }

    // 3. Whole-skill removals: skill tracked by state but no longer in the bundle.
    const previouslyOwned = new Set<string>();
    for (const key of Object.keys(stateFiles)) {
      const slash = key.indexOf('/');
      if (slash > 0) previouslyOwned.add(key.slice(0, slash));
    }
    for (const skill of previouslyOwned) {
      if (skills.includes(skill)) continue;
      const targetDir = join(targetRoot, skill);
      if (!existsSync(targetDir)) continue;
      const disk = buildManifest(targetRoot, [skill]);
      const managedKeys = Object.keys(stateFiles).filter(key => key.startsWith(`${skill}/`));
      const allMatch = managedKeys.every(key => disk.get(key)?.sha === stateFiles[key]);
      const noExtras = [...disk.keys()].every(key => managedKeys.includes(key));
      if (allMatch && noExtras) {
        rmSync(targetDir, { recursive: true, force: true }); // entirely ours → remove
        debug(`[bundled-skills] Removed skill "${skill}" (dropped from pack "${slug}")`);
      } else {
        status.installed.push(skill);
        status.localModified = true; // user touched it — keep
      }
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  return bundleManifest;
}

/**
 * Read-only status of bundled packs without re-running a full disk sync.
 * Uses the same pack discovery as ensureBundledSkills; disabled flag comes
 * from config (or options). installed/localModified are best-effort from
 * on-disk .bundled state + target dirs.
 */
export function listBundledSkillPacks(options?: EnsureBundledSkillsOptions): BundledSkillPackStatus[] {
  const targetRoot = options?.targetRoot ?? GLOBAL_AGENT_SKILLS_DIR;
  const bundleRoot = options?.bundleRoot ?? getBundledAssetsDir('skills');
  if (!bundleRoot || !existsSync(bundleRoot)) return [];

  let disabled = options?.disabled;
  if (!disabled) {
    try {
      disabled = loadStoredConfig()?.bundledSkills?.disabled ?? [];
    } catch {
      disabled = [];
    }
  }
  const disabledSet = new Set(disabled);
  const lock = readSkillsLock(bundleRoot);
  const packSlugs = readdirSync(bundleRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();

  return packSlugs.map((slug) => {
    const meta = lock.get(slug);
    const packDir = join(bundleRoot, slug);
    const skills = listPackSkillDirs(packDir);
    const state = readPackState(targetRoot, slug);
    const installed: string[] = [];
    let localModified = false;
    for (const skill of skills) {
      const skillDir = join(targetRoot, skill);
      if (!existsSync(skillDir)) continue;
      installed.push(skill);
      if (state) {
        const keys = Object.keys(state.files).filter((k) => k.startsWith(`${skill}/`));
        for (const key of keys) {
          const rel = key.slice(skill.length + 1);
          const filePath = join(skillDir, rel);
          if (!existsSync(filePath)) {
            localModified = true;
            continue;
          }
          try {
            if (sha256OfFile(filePath) !== state.files[key]) localModified = true;
          } catch {
            localModified = true;
          }
        }
      }
    }
    return {
      slug,
      origin: meta?.origin ?? null,
      commit: meta?.commit ?? meta?.upstream?.commit ?? null,
      disabled: disabledSet.has(slug),
      localModified,
      skills,
      installed,
      conflicts: [],
    } satisfies BundledSkillPackStatus;
  });
}
