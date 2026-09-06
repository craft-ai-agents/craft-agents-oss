/**
 * Pages - Public API
 *
 * Workspace-scoped mini dashboards: storage/CRUD, refresh-hook matchers, and
 * the mediated source-action bridge.
 *
 * NOT exported here: ./data-store.ts (bun:sqlite) — Bun-only by design, import
 * it via the '@craft-agent/shared/pages/data-store' subpath from Bun scripts.
 */

// Types (core page types re-exported plus storage-layer shapes)
export type {
  PageKind,
  PageScriptRuntime,
  PageRefreshSpec,
  PageRefreshStatus,
  PageSeriesPoint,
  PageDataSnapshot,
  PageActionHttpMethod,
  PageActionDescriptor,
  PageActionGrant,
  PageRenderLease,
  PageActionInvocation,
  PageActionRequest,
  PageActionResult,
  PageShareInfo,
  PageThumbnailInfo,
  PageConfig,
  CreatePageInput,
  LoadedPage,
} from './types.ts';
export { isPageGrantUsable } from './types.ts';

// Storage
export {
  // Path utilities
  getWorkspacePagesPath,
  getPagePath,
  getPageConfigPath,
  getPageContentPath,
  getPageDataPath,
  getPageSnapshotPath,
  getPageStorePath,
  getPageThumbnailPath,
  ensurePagesDir,
  ensurePageDataDir,
  // Config operations
  loadPageConfig,
  savePageConfig,
  loadPage,
  loadPageById,
  loadWorkspacePages,
  pageExists,
  // Create/update/delete
  generatePageSlug,
  createPage,
  updatePage,
  type UpdatePagePatch,
  deletePage,
  unbindProjectFromPages,
  // Content
  computePageContentDigest,
  loadPageContent,
  savePageContent,
  // Data
  readPageDataSnapshot,
  recordPageRefresh,
  // Grants
  addPageGrant,
  revokePageGrant,
  type AddPageGrantInput,
  // Share state
  setPageShareState,
  // Thumbnail (cached poster)
  recordPageThumbnail,
  isThumbnailFresh,
  // Constants
  PAGE_CONFIG_FILENAME,
  PAGE_CONTENT_FILENAME,
  PAGE_SNAPSHOT_FILENAME,
  PAGE_STORE_FILENAME,
  PAGE_THUMBNAIL_FILENAME,
  DEFAULT_PAGE_GRANT_TTL_MS,
} from './storage.ts';

// Validation
export {
  validatePageConfig,
  PageConfigSchema,
  PageKindSchema,
  PageRefreshSpecSchema,
  PageActionDescriptorSchema,
  PageActionGrantSchema,
  PageShareInfoSchema,
  PageThumbnailInfoSchema,
  PAGE_SLUG_REGEX,
  PAGE_REFRESH_MIN_INTERVAL_MS,
  isValidPageSlug,
  assertValidPageSlug,
  InvalidPageSlugError,
} from './validation.ts';

// Refresh hook (synthetic cron matchers)
export {
  buildPageRefreshMatchers,
  pageRefreshMatcherId,
  isPageRefreshMatcherId,
  PAGE_REFRESH_MATCHER_PREFIX,
} from './refresh.ts';

// Data writes (Node-safe: the SQLite work happens in a spawned Bun one-shot)
export {
  applyPageDataPatch,
  writePageData,
  validatePageDataPatch,
  buildPageDataWriterScript,
  PAGE_DATA_PATCH_MAX_BYTES,
  type PageDataPatch,
  type PageDataWriteResult,
} from './data-write.ts';
export {
  DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES,
  PAGE_DATA_MAX_KV_KEYS,
  PAGE_DATA_MAX_SERIES,
} from './data-store-constants.ts';

// Mediated source-action bridge
export {
  PageActionBroker,
  type PageActionBrokerOptions,
  type PageActionExecutors,
  type PageActionValidationErrorCode,
  type CreateLeaseInput,
} from './action-bridge.ts';

// Sharing (Cloudflare publication)
export {
  buildPageShareBundle,
  getShareSnapshotSizeBytes,
  scanSnapshotForSecretCandidates,
  scanPageShareData,
  type PageShareDataScan,
  pageShareErrorCode,
  PageShareError,
  PAGE_SHARE_MAX_BUNDLE_BYTES,
  PAGE_SHARE_MAX_CONTENT_BYTES,
  PAGE_SHARE_MAX_SNAPSHOT_BYTES,
  type PageShareErrorCode,
  type PagePublicManifest,
  type PageShareBundle,
  type BuildPageShareBundleOptions,
} from './share-bundle.ts';
export {
  PagePublisher,
  createCredentialPagePublishTokenStore,
  resolvePagesShareApiBaseUrl,
  deletePageWithUnpublish,
  DEFAULT_PAGES_SHARE_API_BASE_URL,
  type PagePublisherOptions,
  type PagePublishTokenStore,
  type PublishPageOptions,
  type UnpublishResult,
  type DeletePageOutcome,
} from './publisher.ts';
