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
  loadGlobalSkills,
  loadSystemGlobalSkillBySlug,
  invalidateSkillsCache,
  loadSkillBySlug,
  loadGlobalSkillBySlug,
  listEnabledGlobalSkillSlugs,
  setGlobalSkillEnabled,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
  ensureRequiredGlobalSkills,
  replaceRequiredGlobalSkillFileIfContains,
  mirrorSkillToGlobal,
  backfillWorkspaceSkillsToGlobal,
} from './storage.ts';
export type { MirrorSkillResult, BackfillResult } from './storage.ts';

export { STARTER_SKILLS } from './starter-templates.ts';
export type { StarterSkill, StarterSkillFile } from './starter-templates.ts';
export { BUNDLED_STARTER_SKILLS } from './bundled.generated.ts';
export {
  CONCIERGE_SYSTEM_SKILL_SLUGS,
  CREATOR_SYSTEM_SKILL_SLUGS,
  isSystemGlobalSkillSlug,
  SYSTEM_GLOBAL_SKILL_SLUGS,
} from './system.ts';
