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
  applyMarketplaceSkillUpdate,
  applyMarketplaceSkillUpdateFromIntent,
  checkMarketplaceSkillUpdates,
  downloadMarketplaceBundle,
  installMarketplaceSkill,
  installMarketplaceSkillFromIntent,
  readMarketplaceOriginMetadata,
} from './marketplace-install.ts';
export {
  PRODUCT_MARKETPLACE_CATEGORIES,
  createHttpMarketplaceOwnerActionsApi,
  createHttpMarketplacePublishApi,
  publishDirectSkillToMarketplace,
  publishDirectSkillToMarketplaceService,
  publishLocalSkillToMarketplace,
  publishLocalSkillToMarketplaceService,
  suggestMarketplacePublishSlug,
  suggestMarketplaceSlug,
  unpublishMarketplaceSkillFromDiscovery,
  unpublishMarketplaceSkillFromDiscoveryService,
  validateMarketplacePublishRequest,
} from './marketplace-publish.ts';
export type {
  MarketplaceOwnerActionsApi,
  MarketplacePublishApi,
  MarketplacePublishApiInput,
  MarketplacePublishApiResult,
  MarketplaceLocalSkillPublishInput,
  MarketplaceDirectPublishRequest,
  MarketplaceDirectSkillPublishInput,
  MarketplacePublishDirectResult,
  MarketplacePublishLocalResult,
  MarketplacePublishRequest,
  MarketplaceUnpublishApiInput,
  MarketplaceUnpublishApiResult,
  MarketplaceUnpublishRequest,
  MarketplaceUnpublishResult,
  ProductMarketplaceCategory,
} from './marketplace-publish.ts';
export {
  resolveMarketplaceServiceConfig,
} from './marketplace-config.ts';
export type {
  MarketplaceInstallApi,
  MarketplaceInstallConflictResolution,
  MarketplaceInstallIntent,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceSkillInstallInput,
  MarketplaceSkillUpdateInput,
  MarketplaceOriginMetadata,
  MarketplaceUpdateApplyApi,
  MarketplaceUpdateApplyRequest,
  MarketplaceUpdateCheckApi,
  MarketplaceUpdateCheckItem,
  MarketplaceUpdateCheckRequest,
  MarketplaceUpdateCheckResponse,
  MarketplaceUpdateCheckResult,
  MarketplaceUpdateStatus,
} from './marketplace-install.ts';
export type {
  MarketplaceBuildChannel,
  MarketplaceServiceConfig,
  MarketplaceServiceConfigInput,
  MarketplaceServiceEnvironment,
} from './marketplace-config.ts';

export {
  COPAW_MARKET_BASE_URL,
  listCopawMarketSkills,
  uploadCopawMarketSkill,
  deleteCopawMarketSkill,
  generateMarketSkillVersion,
} from './copaw-market-api.ts';
export type {
  CopawMarketSkill,
  CopawMarketUploadInput,
  CopawMarketUploadPayload,
  CopawMarketUploadResult,
} from './copaw-market-api.ts';
