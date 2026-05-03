/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata, SkillSource } from './types.ts';
import {
  classifySkillCategory,
  normalizeSkillTags,
} from './categories.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Agent Skills Paths (Issue #171)
// ============================================================

/** Global agent skills directory: ~/.agents/skills/ */
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** Project-level agent skills relative directory name */
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills';

/** Workspace manifest that records which global library skills are enabled here. */
const WORKSPACE_GLOBAL_SKILLS_MANIFEST = '.global-skills.json';

interface WorkspaceGlobalSkillsManifest {
  enabledGlobalSkills?: unknown;
}

function getWorkspaceGlobalSkillsManifestPath(workspaceRoot: string): string {
  return join(getWorkspaceSkillsPath(workspaceRoot), WORKSPACE_GLOBAL_SKILLS_MANIFEST);
}

function normalizeSkillSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((slug): slug is string => typeof slug === 'string')
      .map(slug => slug.trim())
      .filter(Boolean)
  )).sort();
}

function readWorkspaceGlobalSkillsManifest(workspaceRoot: string): WorkspaceGlobalSkillsManifest {
  const manifestPath = getWorkspaceGlobalSkillsManifestPath(workspaceRoot);
  if (!existsSync(manifestPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as WorkspaceGlobalSkillsManifest;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeWorkspaceGlobalSkillsManifest(workspaceRoot: string, enabledGlobalSkills: string[]): void {
  const manifestPath = getWorkspaceGlobalSkillsManifestPath(workspaceRoot);
  mkdirSync(getWorkspaceSkillsPath(workspaceRoot), { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ enabledGlobalSkills: normalizeSkillSlugs(enabledGlobalSkills) }, null, 2)}\n`,
    'utf-8'
  );
}

export function listEnabledGlobalSkillSlugs(workspaceRoot: string): string[] {
  return normalizeSkillSlugs(readWorkspaceGlobalSkillsManifest(workspaceRoot).enabledGlobalSkills);
}

export function setGlobalSkillEnabled(workspaceRoot: string, slug: string, enabled: boolean): string[] {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) return listEnabledGlobalSkillSlugs(workspaceRoot);

  const current = new Set(listEnabledGlobalSkillSlugs(workspaceRoot));
  if (enabled) {
    current.add(normalizedSlug);
  } else {
    current.delete(normalizedSlug);
  }

  const next = Array.from(current).sort();
  writeWorkspaceGlobalSkillsManifest(workspaceRoot, next);
  invalidateSkillsCache();
  return next;
}

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string, slug: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');
    const name = parsed.data.name as string;
    const description = parsed.data.description as string;
    const tags = normalizeSkillTags(parsed.data.tags);

    return {
      metadata: {
        name,
        description,
        category: classifySkillCategory({
          slug,
          name,
          description,
          tags,
          category: parsed.data.category,
        }),
        tags,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param slug - Skill directory name
 * @param source - Where this skill is loaded from
 */
function loadSkillFromDir(skillsDir: string, slug: string, source: SkillSource): LoadedSkill | null {
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content, slug);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
    source,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(skillsDir: string, source: SkillSource): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkillFromDir(skillsDir, entry.name, source);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillFromDir(skillsDir, slug, 'workspace');
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillsFromDir(skillsDir, 'workspace');
}

export function loadGlobalSkills(): LoadedSkill[] {
  return loadSkillsFromDir(GLOBAL_AGENT_SKILLS_DIR, 'global');
}

// ── Skills cache ────────────────────────────────────────────────────────
// loadAllSkills reads from up to 3 directories on every call (~100ms).
// The result rarely changes during a session, so we cache it per
// (workspaceRoot, projectRoot) pair with a 5-minute safety TTL.

const skillsCache = new Map<string, { skills: LoadedSkill[]; ts: number }>();
const SKILLS_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the skills cache (call on working dir change or skill file events). */
export function invalidateSkillsCache(): void {
  skillsCache.clear();
}

/**
 * Load all skills from all sources (global, workspace, project)
 * Skills with the same slug are overridden by higher-priority sources.
 * Priority: global (lowest) < workspace < project (highest)
 *
 * Results are cached per (workspaceRoot, projectRoot) pair. Call
 * invalidateSkillsCache() on working directory changes or skill file events.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param projectRoot - Optional project root (working directory) for project-level skills
 */
export function loadAllSkills(workspaceRoot: string, projectRoot?: string): LoadedSkill[] {
  const enabledGlobalSlugs = listEnabledGlobalSkillSlugs(workspaceRoot);
  const cacheKey = `${workspaceRoot}::${projectRoot ?? ''}::global=${enabledGlobalSlugs.join(',')}`;
  const now = Date.now();
  const cached = skillsCache.get(cacheKey);
  if (cached && now - cached.ts < SKILLS_CACHE_TTL) {
    return cached.skills;
  }

  const skillsBySlug = new Map<string, LoadedSkill>();

  // 1. Enabled global skills (lowest priority): ~/.agents/skills/
  for (const slug of enabledGlobalSlugs) {
    const skill = loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, slug, 'global');
    if (skill) skillsBySlug.set(skill.slug, skill);
  }

  // 2. Workspace skills (medium priority)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 3. Project skills (highest priority): {projectRoot}/.agents/skills/
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    for (const skill of loadSkillsFromDir(projectSkillsDir, 'project')) {
      skillsBySlug.set(skill.slug, skill);
    }
  }

  const result = Array.from(skillsBySlug.values());
  skillsCache.set(cacheKey, { skills: result, ts: now });
  return result;
}

/**
 * Load a single skill by slug from all sources (project > workspace > global).
 * Unlike loadAllSkills(), this only reads the specific slug directory — O(1) not O(N).
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug to load
 * @param projectRoot - Optional project root for project-level skills
 */
export function loadSkillBySlug(workspaceRoot: string, slug: string, projectRoot?: string): LoadedSkill | null {
  // Highest priority: project-level
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    const skill = loadSkillFromDir(projectSkillsDir, slug, 'project');
    if (skill) return skill;
  }

  // Medium priority: workspace
  const workspaceSkill = loadSkillFromDir(getWorkspaceSkillsPath(workspaceRoot), slug, 'workspace');
  if (workspaceSkill) return workspaceSkill;

  // Lowest priority: enabled global library skill
  if (!listEnabledGlobalSkillSlugs(workspaceRoot).includes(slug)) {
    return null;
  }
  return loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, slug, 'global');
}

export function loadGlobalSkillBySlug(slug: string): LoadedSkill | null {
  return loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, slug, 'global');
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return null;
  }

  return findIconFile(skillDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return false;
  }

  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        return existsSync(skillFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';

// ============================================================
// Workspace → Global mirror
// ============================================================
// Workspaces used to be the only home for user-authored skills. Now skills are
// promoted to first-class globals so they're visible in the Global Library and
// can be activated in other workspaces. We mirror by COPY (not move): the
// workspace copy stays as a same-slug override, and the slug is added to the
// workspace's `.global-skills.json` so the UI surfaces it as "activated here".
//
// Conflict policy: if `~/.agents/skills/<slug>/` already exists, we DO NOT
// overwrite by default — different workspaces may legitimately have different
// skills under the same slug, and a user may have hand-edited the global. The
// workspace copy continues to override at load time via priority order.

export interface MirrorSkillResult {
  /** True if files were copied to the global library on this call. */
  mirrored: boolean;
  /** Reason the copy was skipped, if any (still activates the slug when applicable). */
  skipReason?: 'already-exists' | 'workspace-missing' | 'invalid-skill';
}

/**
 * Copy a workspace skill into the global skills library and activate it in the
 * workspace's enabled-globals manifest. Idempotent.
 *
 * Writes are atomic: the skill is staged in a sibling temp directory and then
 * `renameSync`d into place, so concurrent mirrors of the same slug from
 * different workspaces (or a crash mid-copy) cannot leave a partial directory
 * visible to readers.
 *
 * @param workspaceRoot Absolute path to workspace root.
 * @param slug Skill directory name in `<workspaceRoot>/skills/<slug>/`.
 * @param options.overwrite If true, replace any existing global skill with the same slug.
 */
export function mirrorSkillToGlobal(
  workspaceRoot: string,
  slug: string,
  options: { overwrite?: boolean } = {},
): MirrorSkillResult {
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return { mirrored: false, skipReason: 'invalid-skill' };
  }

  const workspaceSkillDir = join(getWorkspaceSkillsPath(workspaceRoot), normalizedSlug);
  const workspaceSkillFile = join(workspaceSkillDir, 'SKILL.md');
  if (!existsSync(workspaceSkillFile)) {
    return { mirrored: false, skipReason: 'workspace-missing' };
  }

  // Validate parseable before copying so we don't pollute global with garbage.
  try {
    const parsed = parseSkillFile(readFileSync(workspaceSkillFile, 'utf-8'), normalizedSlug);
    if (!parsed) {
      return { mirrored: false, skipReason: 'invalid-skill' };
    }
  } catch {
    return { mirrored: false, skipReason: 'invalid-skill' };
  }

  mkdirSync(GLOBAL_AGENT_SKILLS_DIR, { recursive: true });
  const globalSkillDir = join(GLOBAL_AGENT_SKILLS_DIR, normalizedSlug);
  const globalExists = existsSync(globalSkillDir);

  let mirrored = false;
  if (!globalExists || options.overwrite) {
    // Stage to a sibling temp dir, then rename atomically. This keeps the final
    // directory either absent or fully populated — never partial — and lets
    // concurrent mirrors race the rename instead of clobbering each other's
    // half-written files.
    const stagingDir = join(
      GLOBAL_AGENT_SKILLS_DIR,
      `.tmp-${normalizedSlug}-${process.pid}-${randomUUID().slice(0, 8)}`,
    );

    try {
      cpSync(workspaceSkillDir, stagingDir, { recursive: true });

      // Re-validate after staging in case the source changed mid-copy.
      const stagedSkillFile = join(stagingDir, 'SKILL.md');
      if (!existsSync(stagedSkillFile)) {
        rmSync(stagingDir, { recursive: true, force: true });
        return { mirrored: false, skipReason: 'invalid-skill' };
      }

      if (globalExists) {
        // overwrite: true path. Move the existing global aside, rename
        // staging into place, then drop the displaced copy. This shrinks the
        // window where readers see no global skill at all.
        const displacedDir = join(
          GLOBAL_AGENT_SKILLS_DIR,
          `.old-${normalizedSlug}-${process.pid}-${randomUUID().slice(0, 8)}`,
        );
        try {
          renameSync(globalSkillDir, displacedDir);
        } catch {
          // Existing global vanished between existsSync and rename — fine,
          // the rename below will land into an empty target.
        }
        try {
          renameSync(stagingDir, globalSkillDir);
          mirrored = true;
        } finally {
          if (existsSync(displacedDir)) {
            rmSync(displacedDir, { recursive: true, force: true });
          }
        }
      } else {
        // Non-overwrite path. Race with another concurrent mirror is possible:
        // if the target appeared between our existsSync and our rename, drop
        // our staging copy and treat as "they got there first" (skipReason
        // will reflect already-exists below).
        try {
          renameSync(stagingDir, globalSkillDir);
          mirrored = true;
        } catch {
          if (existsSync(stagingDir)) {
            rmSync(stagingDir, { recursive: true, force: true });
          }
          if (!existsSync(join(globalSkillDir, 'SKILL.md'))) {
            throw new Error(`mirrorSkillToGlobal: failed to rename staging dir for ${normalizedSlug}`);
          }
          // Another writer won the race. Fall through to activate below.
        }
      }
    } catch (err) {
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  // Activate in the workspace manifest regardless of whether the copy ran —
  // this is what makes the skill show up as "from global" in the UI.
  setGlobalSkillEnabled(workspaceRoot, normalizedSlug, true);

  // skipReason reflects the post-condition: if we didn't write but a global
  // exists now (either pre-existing or won by a racing writer), report
  // already-exists. Otherwise undefined.
  const skipReason: MirrorSkillResult['skipReason'] = mirrored
    ? undefined
    : existsSync(join(globalSkillDir, 'SKILL.md'))
      ? 'already-exists'
      : undefined;

  return { mirrored, skipReason };
}

export interface BackfillResult {
  mirrored: string[];
  alreadyInGlobal: string[];
  failed: Array<{ slug: string; reason: string }>;
}

/**
 * Mirror every workspace skill into the global library. Idempotent — safe to
 * run on every startup. Existing global skills with conflicting slugs are
 * preserved (the workspace copy still overrides via priority order).
 */
export function backfillWorkspaceSkillsToGlobal(workspaceRoot: string): BackfillResult {
  const result: BackfillResult = { mirrored: [], alreadyInGlobal: [], failed: [] };
  for (const slug of listSkillSlugs(workspaceRoot)) {
    const r = mirrorSkillToGlobal(workspaceRoot, slug);
    if (r.mirrored) {
      result.mirrored.push(slug);
    } else if (r.skipReason === 'already-exists') {
      result.alreadyInGlobal.push(slug);
    } else if (r.skipReason) {
      result.failed.push({ slug, reason: r.skipReason });
    }
  }
  if (result.mirrored.length > 0) {
    invalidateSkillsCache();
  }
  return result;
}

// ============================================================
// Global skills seeding (built-in load-bearing skills)
// ============================================================

/**
 * Ensure built-in skill files exist in the global skills library.
 *
 * Idempotent: existing files are NEVER overwritten so user edits survive
 * across upgrades. Per-file (not per-skill) idempotence — a user who has
 * SKILL.md but is missing `references/foo.md` will get the missing file
 * seeded without disturbing their SKILL.md.
 *
 * Returns the count of FILES written.
 */
export function ensureRequiredGlobalSkills(
  required: ReadonlyArray<{ slug: string; files: { path: string; content: string }[] }>,
): { ensured: number } {
  mkdirSync(GLOBAL_AGENT_SKILLS_DIR, { recursive: true });
  let ensured = 0;
  for (const s of required) {
    for (const file of s.files) {
      const target = join(GLOBAL_AGENT_SKILLS_DIR, s.slug, file.path);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, 'utf-8');
      ensured += 1;
    }
  }
  return { ensured };
}
