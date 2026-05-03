/**
 * Tests for Skills Storage
 *
 * Verifies the three-tier skill loading system:
 * 1. Global skills: ~/.agents/skills/ (lowest priority)
 * 2. Workspace skills: {workspaceRoot}/skills/ (medium priority)
 * 3. Project skills: {projectRoot}/.agents/skills/ (highest priority)
 *
 * Uses real temp directories to test actual filesystem operations.
 *
 * Note: The global skills directory (~/.agents/skills/) is a module-level constant
 * that cannot be mocked reliably when tests run in parallel with other test files.
 * The loadAllSkills tests account for any pre-existing global skills by capturing a
 * baseline count and validating relative to it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import {
  loadAllSkills,
  loadGlobalSkills,
  loadWorkspaceSkills,
  loadSkill,
  listEnabledGlobalSkillSlugs,
  setGlobalSkillEnabled,
  skillExists,
  listSkillSlugs,
  deleteSkill,
  mirrorSkillToGlobal,
  backfillWorkspaceSkillsToGlobal,
  ensureRequiredGlobalSkills,
  GLOBAL_AGENT_SKILLS_DIR,
} from '../storage.ts';
import { statSync, unlinkSync } from 'fs';

// ============================================================
// Temp Directory Setup
// ============================================================

let tempDir: string;
let workspaceRoot: string;
let projectRoot: string;

// The real global skills directory — we cannot mock this reliably.
const REAL_GLOBAL_SKILLS_DIR = join(homedir(), '.agents', 'skills');
const TEST_PREFIX = '_test_storage_';

// ============================================================
// Helpers
// ============================================================

/** Create a valid SKILL.md file in a skill directory */
function createSkill(
  skillsDir: string,
  slug: string,
  opts: {
    name?: string;
    description?: string;
    category?: string;
    tags?: string[] | string;
    globs?: string[];
    content?: string;
    icon?: string;
    requiredSources?: string[];
  } = {}
): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });

  const name = opts.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const description = opts.description ?? `A ${slug} skill`;
  const content = opts.content ?? `Instructions for ${slug}`;
  const category = opts.category ? `\ncategory: "${opts.category}"` : '';
  const tags = opts.tags
    ? typeof opts.tags === 'string'
      ? `\ntags: ${opts.tags}`
      : `\ntags:\n${opts.tags.map(tag => `  - "${tag}"`).join('\n')}`
    : '';
  const globs = opts.globs ? `\nglobs:\n${opts.globs.map(g => `  - "${g}"`).join('\n')}` : '';
  const icon = opts.icon ? `\nicon: "${opts.icon}"` : '';
  const requiredSources = opts.requiredSources
    ? `\nrequiredSources:\n${opts.requiredSources.map(source => `  - "${source}"`).join('\n')}`
    : '';

  const skillMd = `---
name: "${name}"
description: "${description}"${category}${tags}${globs}${icon}${requiredSources}
---

${content}
`;
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
  return skillDir;
}

/** Create an invalid SKILL.md (missing required fields) */
function createInvalidSkill(skillsDir: string, slug: string): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\ntitle: "No name or description"\n---\nContent');
  return skillDir;
}

/** Create a directory without SKILL.md */
function createEmptySkillDir(skillsDir: string, slug: string): string {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });
  return skillDir;
}

/** Get the set of slugs currently in the real global skills directory */
function getExistingGlobalSlugs(): Set<string> {
  const emptyWs = mkdtempSync(join(tmpdir(), 'skills-baseline-'));
  mkdirSync(join(emptyWs, 'skills'), { recursive: true });
  try {
    const skills = loadAllSkills(emptyWs);
    // These are all global skills since the workspace is empty
    return new Set(skills.map(s => s.slug));
  } finally {
    rmSync(emptyWs, { recursive: true, force: true });
  }
}

// ============================================================
// Test Setup
// ============================================================

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'skills-test-'));
  workspaceRoot = join(tempDir, 'workspace');
  projectRoot = join(tempDir, 'project');

  // Create base directories
  mkdirSync(join(workspaceRoot, 'skills'), { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  if (existsSync(GLOBAL_AGENT_SKILLS_DIR)) {
    for (const entry of readdirSync(GLOBAL_AGENT_SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name.startsWith(TEST_PREFIX) ||
        // Sweep any abandoned mirror staging dirs that referenced our prefix.
        ((entry.name.startsWith('.tmp-') || entry.name.startsWith('.old-')) && entry.name.includes(TEST_PREFIX))
      ) {
        rmSync(join(GLOBAL_AGENT_SKILLS_DIR, entry.name), { recursive: true, force: true });
      }
    }
  }

  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ============================================================
// Tests: loadSkill (single workspace skill)
// ============================================================

describe('loadSkill', () => {
  it('should load a valid skill from workspace', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'commit', {
      name: 'Git Commit',
      description: 'Helps with git commits',
      content: 'Run git commit with a good message',
    });

    const skill = loadSkill(workspaceRoot, 'commit');

    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('commit');
    expect(skill!.metadata.name).toBe('Git Commit');
    expect(skill!.metadata.description).toBe('Helps with git commits');
    expect(skill!.content).toContain('Run git commit with a good message');
    expect(skill!.source).toBe('workspace');
    expect(skill!.path).toBe(join(skillsDir, 'commit'));
  });

  it('should return null for non-existent skill slug', () => {
    const skill = loadSkill(workspaceRoot, 'nonexistent');
    expect(skill).toBeNull();
  });

  it('should return null for directory without SKILL.md', () => {
    createEmptySkillDir(join(workspaceRoot, 'skills'), 'empty-skill');

    const skill = loadSkill(workspaceRoot, 'empty-skill');
    expect(skill).toBeNull();
  });

  it('should return null for invalid SKILL.md (missing required fields)', () => {
    createInvalidSkill(join(workspaceRoot, 'skills'), 'bad-skill');

    const skill = loadSkill(workspaceRoot, 'bad-skill');
    expect(skill).toBeNull();
  });

  it('should load skill with optional globs', () => {
    createSkill(join(workspaceRoot, 'skills'), 'frontend', {
      globs: ['*.tsx', '*.css'],
    });

    const skill = loadSkill(workspaceRoot, 'frontend');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.globs).toEqual(['*.tsx', '*.css']);
  });

  it('should load explicit skill category from frontmatter', () => {
    createSkill(join(workspaceRoot, 'skills'), 'launch-copy', {
      name: 'Launch Copy',
      description: 'Writes launch campaign copy',
      category: 'marketing',
    });

    const skill = loadSkill(workspaceRoot, 'launch-copy');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.category).toBe('marketing');
  });

  it('should infer category when frontmatter category is invalid', () => {
    createSkill(join(workspaceRoot, 'skills'), 'git-review', {
      name: 'Git Review',
      description: 'Reviews code, pull requests, and TypeScript tests',
      category: 'not-a-category',
    });

    const skill = loadSkill(workspaceRoot, 'git-review');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.category).toBe('developer');
  });

  it('should fall back to uncategorized when invalid category has no keyword match', () => {
    createSkill(join(workspaceRoot, 'skills'), 'misc-helper', {
      name: 'Misc Helper',
      description: 'General reusable guidance',
      category: 'not-a-category',
    });

    const skill = loadSkill(workspaceRoot, 'misc-helper');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.category).toBe('uncategorized');
  });

  it('should parse and normalize skill tags', () => {
    createSkill(join(workspaceRoot, 'skills'), 'tagged', {
      tags: ['Research', ' analysis ', 'Research', 'Design Systems'],
    });

    const skill = loadSkill(workspaceRoot, 'tagged');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.tags).toEqual(['research', 'analysis', 'design-systems']);
  });

  it('should parse comma-separated skill tags', () => {
    createSkill(join(workspaceRoot, 'skills'), 'comma-tags', {
      tags: 'Video, Publish, social media, video',
    });

    const skill = loadSkill(workspaceRoot, 'comma-tags');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.tags).toEqual(['video', 'publish', 'social-media']);
  });

  it('should infer category from slug, description, and tags when category is missing', () => {
    createSkill(join(workspaceRoot, 'skills'), 'canva-presentation', {
      name: 'Presentation Builder',
      description: 'Creates slide deck visuals and design assets',
      tags: ['slides'],
    });

    const skill = loadSkill(workspaceRoot, 'canva-presentation');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.category).toBe('media-design');
  });

  it('should load skill with normalized requiredSources', () => {
    createSkill(join(workspaceRoot, 'skills'), 'with-sources', {
      requiredSources: ['linear', ' github ', 'linear'],
    });

    const skill = loadSkill(workspaceRoot, 'with-sources');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear', 'github']);
  });

  it('should normalize single-string requiredSources into an array', () => {
    const skillDir = join(workspaceRoot, 'skills', 'single-source');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: "Single Source"
description: "Skill with scalar requiredSources"
requiredSources: linear
---

Use linear tools.
`);

    const skill = loadSkill(workspaceRoot, 'single-source');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear']);
  });

  it('should ignore invalid requiredSources entries', () => {
    const skillDir = join(workspaceRoot, 'skills', 'invalid-sources');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: "Invalid Sources"
description: "Skill with mixed requiredSources values"
requiredSources:
  - linear
  - 123
  - true
  - "  "
---

Use linear tools.
`);

    const skill = loadSkill(workspaceRoot, 'invalid-sources');

    expect(skill).not.toBeNull();
    expect(skill!.metadata.requiredSources).toEqual(['linear']);
  });

  it('should set iconPath when icon file exists', () => {
    const skillDir = createSkill(join(workspaceRoot, 'skills'), 'with-icon');
    writeFileSync(join(skillDir, 'icon.svg'), '<svg></svg>');

    const skill = loadSkill(workspaceRoot, 'with-icon');

    expect(skill).not.toBeNull();
    expect(skill!.iconPath).toBe(join(skillDir, 'icon.svg'));
  });

  it('should not set iconPath when no icon file exists', () => {
    createSkill(join(workspaceRoot, 'skills'), 'no-icon');

    const skill = loadSkill(workspaceRoot, 'no-icon');

    expect(skill).not.toBeNull();
    expect(skill!.iconPath).toBeUndefined();
  });
});

// ============================================================
// Tests: loadWorkspaceSkills (all skills from workspace)
// ============================================================

describe('loadWorkspaceSkills', () => {
  it('should load multiple skills from workspace', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'commit');
    createSkill(skillsDir, 'review');
    createSkill(skillsDir, 'deploy');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(3);
    const slugs = skills.map(s => s.slug).sort();
    expect(slugs).toEqual(['commit', 'deploy', 'review']);
    // All should be workspace source
    for (const skill of skills) {
      expect(skill.source).toBe('workspace');
    }
  });

  it('should return empty array for empty skills directory', () => {
    // workspaceRoot/skills/ exists but has no subdirectories
    const skills = loadWorkspaceSkills(workspaceRoot);
    expect(skills).toEqual([]);
  });

  it('should return empty array for non-existent workspace root', () => {
    const skills = loadWorkspaceSkills(join(tempDir, 'nonexistent'));
    expect(skills).toEqual([]);
  });

  it('should skip directories without SKILL.md', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'valid-skill');
    createEmptySkillDir(skillsDir, 'no-skill-md');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('valid-skill');
  });

  it('should skip invalid SKILL.md files', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'valid');
    createInvalidSkill(skillsDir, 'invalid');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('valid');
  });

  it('should skip non-directory entries', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'real-skill');
    // Create a plain file in the skills directory (not a subdirectory)
    writeFileSync(join(skillsDir, 'readme.txt'), 'This is not a skill');

    const skills = loadWorkspaceSkills(workspaceRoot);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe('real-skill');
  });
});

// ============================================================
// Tests: loadAllSkills (three-tier loading)
//
// These tests account for pre-existing global skills at ~/.agents/skills/.
// We capture a baseline and verify our test skills appear with correct sources.
// ============================================================

describe('loadAllSkills', () => {
  const getWorkspaceSkillsDir = () => join(workspaceRoot, 'skills');
  const getProjectSkillsDir = () => join(projectRoot, '.agents', 'skills');

  it('should load workspace and project skills alongside any existing global skills', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });

    createSkill(wsDir, `${TEST_PREFIX}ws`, { name: 'Workspace Skill', description: 'From workspace' });
    createSkill(projDir, `${TEST_PREFIX}proj`, { name: 'Project Skill', description: 'From project' });

    const skills = loadAllSkills(workspaceRoot, projectRoot);

    // Should have baseline global skills + our 2 test skills
    expect(skills.length).toBe(baselineGlobal.size + 2);

    const wsSkill = skills.find(s => s.slug === `${TEST_PREFIX}ws`);
    const projSkill = skills.find(s => s.slug === `${TEST_PREFIX}proj`);

    expect(wsSkill).toBeDefined();
    expect(wsSkill!.source).toBe('workspace');

    expect(projSkill).toBeDefined();
    expect(projSkill!.source).toBe('project');

    // All baseline global skills should still be present with source 'global'
    for (const globalSlug of baselineGlobal) {
      const skill = skills.find(s => s.slug === globalSlug);
      expect(skill).toBeDefined();
      expect(skill!.source).toBe('global');
    }
  });

  it('should override global skills with workspace skills when slug matches', () => {
    const baselineGlobal = getExistingGlobalSlugs();

    // Only test override if there are actually global skills to override
    if (baselineGlobal.size === 0) {
      // No global skills — just verify workspace skills load
      const wsDir = getWorkspaceSkillsDir();
      createSkill(wsDir, `${TEST_PREFIX}ws_only`, { name: 'WS Only', description: 'WS only skill' });
      const skills = loadAllSkills(workspaceRoot);
      expect(skills.find(s => s.slug === `${TEST_PREFIX}ws_only`)).toBeDefined();
      return;
    }

    // Override one of the existing global skills with a workspace skill
    const globalSlugToOverride = [...baselineGlobal][0]!;
    const wsDir = getWorkspaceSkillsDir();
    createSkill(wsDir, globalSlugToOverride, {
      name: 'Workspace Override',
      description: 'This overrides the global skill',
    });

    const skills = loadAllSkills(workspaceRoot);

    const overridden = skills.find(s => s.slug === globalSlugToOverride);
    expect(overridden).toBeDefined();
    expect(overridden!.source).toBe('workspace');
    expect(overridden!.metadata.name).toBe('Workspace Override');

    // Total count should be same as baseline (overridden, not added)
    expect(skills.length).toBe(baselineGlobal.size);
  });

  it('should override workspace skills with project skills (same slug)', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });

    createSkill(wsDir, `${TEST_PREFIX}deploy`, { name: 'Workspace Deploy', description: 'Workspace version' });
    createSkill(projDir, `${TEST_PREFIX}deploy`, { name: 'Project Deploy', description: 'Project version' });

    const skills = loadAllSkills(workspaceRoot, projectRoot);

    // Only 1 skill for this slug (project overrides workspace), plus baseline globals
    expect(skills.length).toBe(baselineGlobal.size + 1);
    const deploy = skills.find(s => s.slug === `${TEST_PREFIX}deploy`);
    expect(deploy).toBeDefined();
    expect(deploy!.source).toBe('project');
    expect(deploy!.metadata.name).toBe('Project Deploy');
    expect(deploy!.metadata.description).toBe('Project version');
  });

  it('should handle full three-tier override: project > workspace > global', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });

    // Same slug at workspace and project tiers
    createSkill(wsDir, `${TEST_PREFIX}shared`, { name: 'Workspace', description: 'Workspace version' });
    createSkill(projDir, `${TEST_PREFIX}shared`, { name: 'Project', description: 'Project version' });

    // Unique skills at each controllable tier
    createSkill(wsDir, `${TEST_PREFIX}only_ws`, { description: 'Only in workspace' });
    createSkill(projDir, `${TEST_PREFIX}only_proj`, { description: 'Only in project' });

    const skills = loadAllSkills(workspaceRoot, projectRoot);

    // Shared skill should be project version (highest priority)
    const shared = skills.find(s => s.slug === `${TEST_PREFIX}shared`);
    expect(shared).toBeDefined();
    expect(shared!.source).toBe('project');
    expect(shared!.metadata.name).toBe('Project');

    // Unique skills should keep their sources
    expect(skills.find(s => s.slug === `${TEST_PREFIX}only_ws`)!.source).toBe('workspace');
    expect(skills.find(s => s.slug === `${TEST_PREFIX}only_proj`)!.source).toBe('project');

    // Total: baseline globals + shared (1, deduplicated) + only_ws + only_proj = baseline + 3
    expect(skills.length).toBe(baselineGlobal.size + 3);
  });

  it('should handle missing project directory gracefully', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    createSkill(wsDir, `${TEST_PREFIX}ws_skill`);

    // Pass a non-existent project root
    const skills = loadAllSkills(workspaceRoot, join(tempDir, 'nonexistent-project'));

    expect(skills.length).toBe(baselineGlobal.size + 1);
    const wsSkill = skills.find(s => s.slug === `${TEST_PREFIX}ws_skill`);
    expect(wsSkill).toBeDefined();
    expect(wsSkill!.source).toBe('workspace');
  });

  it('should skip project tier when projectRoot is undefined', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });
    createSkill(projDir, `${TEST_PREFIX}project_only`);

    const wsDir = getWorkspaceSkillsDir();
    createSkill(wsDir, `${TEST_PREFIX}ws_skill`);

    // No projectRoot passed — project tier should be skipped
    const skills = loadAllSkills(workspaceRoot);

    // Should NOT contain the project-only skill
    expect(skills.find(s => s.slug === `${TEST_PREFIX}project_only`)).toBeUndefined();
    // Should contain the workspace skill
    expect(skills.find(s => s.slug === `${TEST_PREFIX}ws_skill`)).toBeDefined();
    expect(skills.length).toBe(baselineGlobal.size + 1);
  });

  it('should return only global skills when workspace and project are empty', () => {
    const baselineGlobal = getExistingGlobalSlugs();

    const skills = loadAllSkills(workspaceRoot);

    // With empty workspace and no project, only global skills remain
    expect(skills.length).toBe(baselineGlobal.size);
    for (const skill of skills) {
      expect(skill.source).toBe('global');
    }
  });

  it('should correctly assign source for workspace and project tiers', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });

    createSkill(wsDir, `${TEST_PREFIX}w1`);
    createSkill(wsDir, `${TEST_PREFIX}w2`);
    createSkill(projDir, `${TEST_PREFIX}p1`);

    const skills = loadAllSkills(workspaceRoot, projectRoot);

    const testSkills = skills.filter(s => s.slug.startsWith(TEST_PREFIX));
    expect(testSkills.filter(s => s.source === 'workspace')).toHaveLength(2);
    expect(testSkills.filter(s => s.source === 'project')).toHaveLength(1);

    // Global skills should all have source 'global'
    const globalSkills = skills.filter(s => !s.slug.startsWith(TEST_PREFIX));
    for (const skill of globalSkills) {
      expect(skill.source).toBe('global');
    }
  });

  it('should deduplicate by slug across workspace and project tiers', () => {
    const baselineGlobal = getExistingGlobalSlugs();
    const wsDir = getWorkspaceSkillsDir();
    const projDir = getProjectSkillsDir();
    mkdirSync(projDir, { recursive: true });

    // Same slug in workspace and project — only project should remain
    createSkill(wsDir, `${TEST_PREFIX}dup`, { name: 'WS Dup', description: 'From workspace' });
    createSkill(projDir, `${TEST_PREFIX}dup`, { name: 'Proj Dup', description: 'From project' });
    // Unique skills
    createSkill(wsDir, `${TEST_PREFIX}unique_ws`);
    createSkill(projDir, `${TEST_PREFIX}unique_proj`);

    const skills = loadAllSkills(workspaceRoot, projectRoot);

    // 3 test skills (dup deduplicated to 1 + 2 uniques) + baseline
    const testSkills = skills.filter(s => s.slug.startsWith(TEST_PREFIX));
    expect(testSkills).toHaveLength(3);

    const dup = skills.find(s => s.slug === `${TEST_PREFIX}dup`);
    expect(dup!.source).toBe('project');
    expect(dup!.metadata.name).toBe('Proj Dup');
  });

  it('should only load global library skills enabled for the workspace', () => {
    mkdirSync(REAL_GLOBAL_SKILLS_DIR, { recursive: true });
    createSkill(REAL_GLOBAL_SKILLS_DIR, `${TEST_PREFIX}global_on`, {
      name: 'Enabled Global',
      description: 'Enabled for this workspace',
    });
    createSkill(REAL_GLOBAL_SKILLS_DIR, `${TEST_PREFIX}global_off`, {
      name: 'Disabled Global',
      description: 'Not enabled for this workspace',
    });

    expect(loadGlobalSkills().some(s => s.slug === `${TEST_PREFIX}global_on`)).toBe(true);
    expect(loadAllSkills(workspaceRoot).some(s => s.slug === `${TEST_PREFIX}global_on`)).toBe(false);

    const enabled = setGlobalSkillEnabled(workspaceRoot, `${TEST_PREFIX}global_on`, true);
    expect(enabled).toEqual([`${TEST_PREFIX}global_on`]);
    expect(listEnabledGlobalSkillSlugs(workspaceRoot)).toEqual([`${TEST_PREFIX}global_on`]);

    const skills = loadAllSkills(workspaceRoot);
    expect(skills.find(s => s.slug === `${TEST_PREFIX}global_on`)?.source).toBe('global');
    expect(skills.find(s => s.slug === `${TEST_PREFIX}global_off`)).toBeUndefined();
  });

  it('should let workspace skills override enabled global skills', () => {
    mkdirSync(REAL_GLOBAL_SKILLS_DIR, { recursive: true });
    createSkill(REAL_GLOBAL_SKILLS_DIR, `${TEST_PREFIX}override`, {
      name: 'Global Version',
      description: 'Global version',
    });
    createSkill(getWorkspaceSkillsDir(), `${TEST_PREFIX}override`, {
      name: 'Workspace Version',
      description: 'Workspace version',
    });

    setGlobalSkillEnabled(workspaceRoot, `${TEST_PREFIX}override`, true);
    const skill = loadAllSkills(workspaceRoot).find(s => s.slug === `${TEST_PREFIX}override`);

    expect(skill).toBeDefined();
    expect(skill!.source).toBe('workspace');
    expect(skill!.metadata.name).toBe('Workspace Version');
  });
});

// ============================================================
// Tests: skillExists
// ============================================================

describe('skillExists', () => {
  it('should return true for existing skill with SKILL.md', () => {
    createSkill(join(workspaceRoot, 'skills'), 'exists-skill');
    expect(skillExists(workspaceRoot, 'exists-skill')).toBe(true);
  });

  it('should return false for non-existent skill', () => {
    expect(skillExists(workspaceRoot, 'ghost-skill')).toBe(false);
  });

  it('should return false for directory without SKILL.md', () => {
    createEmptySkillDir(join(workspaceRoot, 'skills'), 'empty');
    expect(skillExists(workspaceRoot, 'empty')).toBe(false);
  });
});

// ============================================================
// Tests: listSkillSlugs
// ============================================================

describe('listSkillSlugs', () => {
  it('should list all valid skill slugs', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'alpha');
    createSkill(skillsDir, 'beta');
    createEmptySkillDir(skillsDir, 'no-skill-md');

    const slugs = listSkillSlugs(workspaceRoot);
    expect(slugs.sort()).toEqual(['alpha', 'beta']);
  });

  it('should return empty array for empty skills directory', () => {
    const slugs = listSkillSlugs(workspaceRoot);
    expect(slugs).toEqual([]);
  });

  it('should return empty array for non-existent workspace', () => {
    const slugs = listSkillSlugs(join(tempDir, 'nonexistent'));
    expect(slugs).toEqual([]);
  });
});

// ============================================================
// Tests: deleteSkill
// ============================================================

describe('deleteSkill', () => {
  it('should delete an existing skill', () => {
    const skillsDir = join(workspaceRoot, 'skills');
    createSkill(skillsDir, 'to-delete');
    expect(skillExists(workspaceRoot, 'to-delete')).toBe(true);

    const result = deleteSkill(workspaceRoot, 'to-delete');

    expect(result).toBe(true);
    expect(skillExists(workspaceRoot, 'to-delete')).toBe(false);
  });

  it('should return false for non-existent skill', () => {
    const result = deleteSkill(workspaceRoot, 'nonexistent');
    expect(result).toBe(false);
  });
});

// ============================================================
// Tests: mirrorSkillToGlobal / backfillWorkspaceSkillsToGlobal
// ============================================================

describe('mirrorSkillToGlobal', () => {
  it('copies a workspace skill to the global library and activates it', () => {
    const slug = `${TEST_PREFIX}mirror-new`;
    createSkill(join(workspaceRoot, 'skills'), slug, {
      name: 'Mirror New',
      description: 'A skill to mirror',
      content: 'Body content for mirror test',
    });

    const result = mirrorSkillToGlobal(workspaceRoot, slug);

    expect(result.mirrored).toBe(true);
    expect(result.skipReason).toBeUndefined();
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'))).toBe(true);
    expect(listEnabledGlobalSkillSlugs(workspaceRoot)).toContain(slug);
  });

  it('preserves an existing global skill on slug conflict (no overwrite by default)', () => {
    const slug = `${TEST_PREFIX}mirror-conflict`;

    // Pre-existing global with content A
    mkdirSync(join(GLOBAL_AGENT_SKILLS_DIR, slug), { recursive: true });
    writeFileSync(
      join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'),
      `---\nname: "Original"\ndescription: "Original global"\n---\nGLOBAL_BODY`,
    );

    // Workspace skill with different content B
    createSkill(join(workspaceRoot, 'skills'), slug, {
      name: 'Workspace Override',
      description: 'Workspace version',
      content: 'WORKSPACE_BODY',
    });

    const result = mirrorSkillToGlobal(workspaceRoot, slug);

    expect(result.mirrored).toBe(false);
    expect(result.skipReason).toBe('already-exists');

    // Global content is unchanged
    const globalContent = readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'), 'utf-8');
    expect(globalContent).toContain('GLOBAL_BODY');
    expect(globalContent).not.toContain('WORKSPACE_BODY');

    // But the workspace activates the slug — UI shows it as a global skill
    expect(listEnabledGlobalSkillSlugs(workspaceRoot)).toContain(slug);
  });

  it('replaces global content when overwrite: true', () => {
    const slug = `${TEST_PREFIX}mirror-overwrite`;

    mkdirSync(join(GLOBAL_AGENT_SKILLS_DIR, slug), { recursive: true });
    writeFileSync(
      join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'),
      `---\nname: "Original"\ndescription: "Original"\n---\nOLD_BODY`,
    );

    createSkill(join(workspaceRoot, 'skills'), slug, {
      content: 'NEW_BODY_FROM_WORKSPACE',
    });

    const result = mirrorSkillToGlobal(workspaceRoot, slug, { overwrite: true });

    expect(result.mirrored).toBe(true);
    const globalContent = readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'), 'utf-8');
    expect(globalContent).toContain('NEW_BODY_FROM_WORKSPACE');
  });

  it('returns workspace-missing when the workspace has no skill at that slug', () => {
    const result = mirrorSkillToGlobal(workspaceRoot, `${TEST_PREFIX}does-not-exist`);
    expect(result.mirrored).toBe(false);
    expect(result.skipReason).toBe('workspace-missing');
  });

  it('returns invalid-skill for unparseable workspace SKILL.md', () => {
    const slug = `${TEST_PREFIX}mirror-invalid`;
    const dir = join(workspaceRoot, 'skills', slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nfoo: "bar"\n---\nNo required fields');

    const result = mirrorSkillToGlobal(workspaceRoot, slug);

    expect(result.mirrored).toBe(false);
    expect(result.skipReason).toBe('invalid-skill');
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug))).toBe(false);
  });

  it('leaves no .tmp- staging directories behind in the global skills dir after success', () => {
    const slug = `${TEST_PREFIX}mirror-staging-cleanup`;
    createSkill(join(workspaceRoot, 'skills'), slug);

    const result = mirrorSkillToGlobal(workspaceRoot, slug);
    expect(result.mirrored).toBe(true);

    // No leftover staging directories with our test prefix.
    if (existsSync(GLOBAL_AGENT_SKILLS_DIR)) {
      const leftover = readdirSync(GLOBAL_AGENT_SKILLS_DIR).filter(
        (entry) =>
          (entry.startsWith('.tmp-') || entry.startsWith('.old-')) &&
          entry.includes(slug),
      );
      expect(leftover).toEqual([]);
    }
  });

  it('overwrite: true atomically replaces existing global content', () => {
    const slug = `${TEST_PREFIX}mirror-atomic-overwrite`;

    // Existing global has multiple files including an asset that should be
    // gone after overwrite (verifies the displaced dir is fully removed).
    mkdirSync(join(GLOBAL_AGENT_SKILLS_DIR, slug), { recursive: true });
    writeFileSync(
      join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'),
      `---\nname: "Old"\ndescription: "old"\n---\nOLD_BODY`,
    );
    writeFileSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'old-asset.md'), 'OLD_ONLY');

    // Workspace has a different SKILL.md and a different asset.
    const wsDir = createSkill(join(workspaceRoot, 'skills'), slug, {
      content: 'NEW_BODY',
    });
    writeFileSync(join(wsDir, 'new-asset.md'), 'NEW_ONLY');

    const result = mirrorSkillToGlobal(workspaceRoot, slug, { overwrite: true });
    expect(result.mirrored).toBe(true);

    expect(readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'), 'utf-8')).toContain('NEW_BODY');
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'new-asset.md'))).toBe(true);
    // Old file from the displaced global is gone — the entire dir was replaced.
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'old-asset.md'))).toBe(false);

    // No leftover .old- displaced directories.
    const leftover = readdirSync(GLOBAL_AGENT_SKILLS_DIR).filter(
      (entry) => entry.startsWith('.old-') && entry.includes(slug),
    );
    expect(leftover).toEqual([]);
  });

  it('copies non-SKILL.md asset files (e.g. icon) along with the skill', () => {
    const slug = `${TEST_PREFIX}mirror-with-icon`;
    const skillDir = createSkill(join(workspaceRoot, 'skills'), slug);
    writeFileSync(join(skillDir, 'icon.svg'), '<svg>WORKSPACE_ICON</svg>');

    const result = mirrorSkillToGlobal(workspaceRoot, slug);

    expect(result.mirrored).toBe(true);
    const mirroredIcon = readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'icon.svg'), 'utf-8');
    expect(mirroredIcon).toContain('WORKSPACE_ICON');
  });
});

describe('backfillWorkspaceSkillsToGlobal', () => {
  it('mirrors every parseable workspace skill into the global library', () => {
    const slugA = `${TEST_PREFIX}backfill-a`;
    const slugB = `${TEST_PREFIX}backfill-b`;
    createSkill(join(workspaceRoot, 'skills'), slugA);
    createSkill(join(workspaceRoot, 'skills'), slugB);

    const result = backfillWorkspaceSkillsToGlobal(workspaceRoot);

    expect(result.mirrored.sort()).toEqual([slugA, slugB].sort());
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slugA, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slugB, 'SKILL.md'))).toBe(true);
    const enabled = listEnabledGlobalSkillSlugs(workspaceRoot);
    expect(enabled).toContain(slugA);
    expect(enabled).toContain(slugB);
  });

  it('is idempotent — second run reports already-in-global instead of mirroring again', () => {
    const slug = `${TEST_PREFIX}backfill-idempotent`;
    createSkill(join(workspaceRoot, 'skills'), slug);

    const first = backfillWorkspaceSkillsToGlobal(workspaceRoot);
    expect(first.mirrored).toContain(slug);

    const second = backfillWorkspaceSkillsToGlobal(workspaceRoot);
    expect(second.mirrored).not.toContain(slug);
    expect(second.alreadyInGlobal).toContain(slug);
  });

  it('reports invalid skills under failed and skips them', () => {
    const goodSlug = `${TEST_PREFIX}backfill-good`;
    const badSlug = `${TEST_PREFIX}backfill-bad`;
    createSkill(join(workspaceRoot, 'skills'), goodSlug);
    const badDir = join(workspaceRoot, 'skills', badSlug);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'SKILL.md'), '---\ntitle: "no required fields"\n---\nx');

    const result = backfillWorkspaceSkillsToGlobal(workspaceRoot);

    expect(result.mirrored).toContain(goodSlug);
    expect(result.failed.find(f => f.slug === badSlug)?.reason).toBe('invalid-skill');
  });
});

describe('ensureRequiredGlobalSkills (multi-file)', () => {
  // Use a unique slug per test so we don't collide with the real global library
  // (which can't be mocked — see file header).
  const seededSlugs: string[] = [];

  function makeMultiFileSkill(slug: string) {
    seededSlugs.push(slug);
    return {
      slug,
      files: [
        { path: 'SKILL.md', content: `---\nname: "${slug}"\ndescription: "test"\n---\nbody` },
        { path: 'references/foo.md', content: `# foo for ${slug}` },
        { path: 'references/research/bar.md', content: `# bar for ${slug}` },
      ],
    };
  }

  afterEach(() => {
    for (const slug of seededSlugs) {
      const dir = join(GLOBAL_AGENT_SKILLS_DIR, slug);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    seededSlugs.length = 0;
  });

  it('seeds all files (including nested subdirectories) for a multi-file skill', () => {
    const slug = `${TEST_PREFIX}multifile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const skill = makeMultiFileSkill(slug);

    const { ensured } = ensureRequiredGlobalSkills([skill]);

    expect(ensured).toBe(3);
    const root = join(GLOBAL_AGENT_SKILLS_DIR, slug);
    expect(existsSync(join(root, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'references', 'foo.md'))).toBe(true);
    expect(existsSync(join(root, 'references', 'research', 'bar.md'))).toBe(true);
    expect(readFileSync(join(root, 'references', 'foo.md'), 'utf-8')).toContain('foo for');
  });

  it('is idempotent — second seed writes nothing and does not overwrite existing files', () => {
    const slug = `${TEST_PREFIX}idempotent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const skill = makeMultiFileSkill(slug);

    const first = ensureRequiredGlobalSkills([skill]);
    expect(first.ensured).toBe(3);

    // Mutate one file to verify we don't overwrite.
    const skillMd = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md');
    const userEdit = '---\nname: "user edited"\ndescription: "edited"\n---\nuser body';
    writeFileSync(skillMd, userEdit, 'utf-8');
    const fooMd = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'references', 'foo.md');
    const beforeMtime = statSync(fooMd).mtimeMs;

    const second = ensureRequiredGlobalSkills([skill]);
    expect(second.ensured).toBe(0);
    expect(readFileSync(skillMd, 'utf-8')).toBe(userEdit);
    expect(statSync(fooMd).mtimeMs).toBe(beforeMtime);
  });

  it('partial recovery — restores a missing reference file without disturbing siblings', () => {
    const slug = `${TEST_PREFIX}partial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const skill = makeMultiFileSkill(slug);

    ensureRequiredGlobalSkills([skill]);

    const skillMd = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md');
    const userEdit = '---\nname: "user edited"\ndescription: "edited"\n---\nuser body';
    writeFileSync(skillMd, userEdit, 'utf-8');
    const barMd = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'references', 'research', 'bar.md');
    const barBeforeMtime = statSync(barMd).mtimeMs;

    // Delete one reference file.
    const fooMd = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'references', 'foo.md');
    unlinkSync(fooMd);
    expect(existsSync(fooMd)).toBe(false);

    const result = ensureRequiredGlobalSkills([skill]);

    expect(result.ensured).toBe(1);
    expect(existsSync(fooMd)).toBe(true);
    expect(readFileSync(fooMd, 'utf-8')).toContain('foo for');
    // User edit on SKILL.md and untouched bar.md must survive.
    expect(readFileSync(skillMd, 'utf-8')).toBe(userEdit);
    expect(statSync(barMd).mtimeMs).toBe(barBeforeMtime);
  });
});
