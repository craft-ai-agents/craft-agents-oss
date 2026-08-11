/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
}

/** Source of a loaded skill */
/**
 * Where a skill was loaded from, in ascending priority.
 *
 * 'builtin' ships inside the app bundle and updates with it. It is loaded
 * first and overridden by every other tier, so a user who copies a shipped
 * skill into their own skills directory keeps their version.
 */
export type SkillSource = 'builtin' | 'global' | 'workspace' | 'project';

/**
 * Plugin name for project-level and global skills.
 *
 * The SDK derives plugin names from `path.basename()` of the registered plugin
 * directory. Both `{project}/.agents/` and `~/.agents/` share the basename
 * `.agents`, so skills from either tier resolve to `.agents:skillSlug`.
 */
export const AGENTS_PLUGIN_NAME = '.agents';

/**
 * A loaded skill with parsed content
 */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
}
