/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export * from './account-library.ts';
export { hasDeliverableSkillIntent, matchSkillsForConversation, matchSkillsForRequest } from './auto-routing.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  invalidateSkillsCache,
  setAccountSkillRoots,
  setWorkspaceSkillRoots,
  getWorkspaceSkillRoots,
  loadSkillBySlug,
  getSkillIconPath,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';
