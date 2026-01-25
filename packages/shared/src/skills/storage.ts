/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata, SkillSource } from './types.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { GLOBAL_SKILLS_DIR, TEAM_SKILLS_DIR, CLAUDE_CODE_SKILLS_DIR, CLAUDE_CODE_COMMANDS_DIR } from '../config/paths.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
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
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
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

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
  };
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkill(workspaceRoot, entry.name);
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
 * Load a single skill from any directory (not workspace-specific)
 * @param skillDir - Absolute path to the skill directory containing SKILL.md
 */
export function loadSkillFromDir(skillDir: string): LoadedSkill | null {
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

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  // Extract slug from directory name
  const slug = skillDir.split('/').pop() || skillDir.split('\\').pop() || '';

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to a directory containing skill subdirectories
 * @param source - The source type to assign to loaded skills
 */
export function loadSkillsFromDir(skillsDir: string, source: SkillSource): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden directories
      if (entry.name.startsWith('.')) continue;

      const skillDir = join(skillsDir, entry.name);
      const skill = loadSkillFromDir(skillDir);
      if (skill) {
        skills.push({ ...skill, source });
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

/**
 * Load Claude Code commands from ~/.claude/commands/ and convert them to skills.
 * Commands are markdown files with YAML frontmatter (name, description, argument-hint).
 * Searches recursively to include commands in subdirectories like workflows/.
 */
function loadCommandsAsSkills(): LoadedSkill[] {
  if (!existsSync(CLAUDE_CODE_COMMANDS_DIR)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  /**
   * Recursively scan a directory for .md files and convert them to skills
   */
  function scanDirectory(dirPath: string): void {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Process markdown file as command
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const parsed = matter(content);

            // Commands must have name and description in frontmatter
            if (!parsed.data.name || !parsed.data.description) {
              continue;
            }

            // Generate slug from the command name (e.g., "workflows:plan" → "workflows-plan")
            // Or from the file path if no name (e.g., "workflows/plan.md" → "workflows-plan")
            const slug = parsed.data.name
              ? (parsed.data.name as string).replace(/:/g, '-')
              : fullPath
                  .replace(CLAUDE_CODE_COMMANDS_DIR + '/', '')
                  .replace(/\.md$/, '')
                  .replace(/\//g, '-');

            skills.push({
              slug,
              metadata: {
                name: parsed.data.name as string,
                description: parsed.data.description as string,
                icon: '⚡', // Default icon for commands
              },
              content: parsed.content,
              path: fullPath,
              source: 'claude-code',
            });
          } catch {
            // Skip files that can't be parsed
          }
        }
      }
    } catch {
      // Ignore errors scanning directories
    }
  }

  scanDirectory(CLAUDE_CODE_COMMANDS_DIR);
  return skills;
}

/**
 * Load team skills from ~/.vesper/team-skills/.
 * Team skills are synced from a private GitHub repository.
 */
export function loadTeamSkills(): LoadedSkill[] {
  return loadSkillsFromDir(TEAM_SKILLS_DIR, 'team');
}

/**
 * Load global skills from ~/.vesper/global-skills/, ~/.claude/skills/,
 * and ~/.claude/commands/ (auto-converted to skills).
 * Claude Code skills and commands are read-only, global skills are user-installed.
 */
export function loadGlobalSkills(): LoadedSkill[] {
  const skills: LoadedSkill[] = [];

  // Load from ~/.vesper/global-skills/ (user-installed)
  const globalSkills = loadSkillsFromDir(GLOBAL_SKILLS_DIR, 'global');
  skills.push(...globalSkills);

  // Load from ~/.claude/skills/ (Claude Code CLI standalone skills)
  const claudeCodeSkills = loadSkillsFromDir(CLAUDE_CODE_SKILLS_DIR, 'claude-code');
  skills.push(...claudeCodeSkills);

  // Load from ~/.claude/commands/ (Claude Code slash commands auto-converted to skills)
  const commandSkills = loadCommandsAsSkills();
  skills.push(...commandSkills);

  return skills;
}

/**
 * Load all skills for a workspace, merging skills from all sources.
 * Precedence order (first wins): workspace > team > global > claude-code
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadAllSkills(workspaceRoot: string): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  const seenSlugs = new Set<string>();

  // 1. Workspace skills (highest priority - local overrides)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skills.push({ ...skill, source: 'workspace' as SkillSource });
    seenSlugs.add(skill.slug);
  }

  // 2. Team skills (from private GitHub repo)
  for (const skill of loadTeamSkills()) {
    if (!seenSlugs.has(skill.slug)) {
      skills.push(skill);
      seenSlugs.add(skill.slug);
    }
  }

  // 3. Global + Claude Code skills
  for (const skill of loadGlobalSkills()) {
    if (!seenSlugs.has(skill.slug)) {
      skills.push(skill);
      seenSlugs.add(skill.slug);
    }
  }

  return skills;
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
