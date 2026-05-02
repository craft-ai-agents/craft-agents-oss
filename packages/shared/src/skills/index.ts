/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  invalidateSkillsCache,
  loadSkillBySlug,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
  ensureRequiredGlobalSkills,
  mirrorSkillToGlobal,
  backfillWorkspaceSkillsToGlobal,
} from './storage.ts';
export type { MirrorSkillResult, BackfillResult } from './storage.ts';

export { STARTER_SKILLS } from './starter-templates.ts';
export type { StarterSkill } from './starter-templates.ts';
