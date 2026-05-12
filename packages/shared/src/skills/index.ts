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
  deriveSkillSlug,
  createSkill,
  forceWriteSkill,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';

export type { CreateSkillResult } from './storage.ts';

export { extractSkillsFromZip } from './zip-extractor.ts';
export { resolveRemoteSkills, parseRemoteInput } from './remote-resolver.ts';
export type { RemoteResolveResult } from './remote-resolver.ts';
export {
  MARKETPLACE_ORIGIN_METADATA_FILE,
  downloadMarketplaceBundle,
  installMarketplaceSkill,
  installMarketplaceSkillFromIntent,
  readMarketplaceOriginMetadata,
} from './marketplace-install.ts';
export type {
  MarketplaceInstallApi,
  MarketplaceInstallConflictResolution,
  MarketplaceInstallIntent,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceSkillInstallInput,
  MarketplaceOriginMetadata,
} from './marketplace-install.ts';
