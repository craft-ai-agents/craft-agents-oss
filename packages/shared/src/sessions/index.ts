/**
 * Sessions Module
 *
 * Public exports for workspace-scoped session management.
 *
 * Sessions are stored in JSONL format:
 * - Line 1: SessionHeader (metadata for fast list loading)
 * - Lines 2+: StoredMessage (one message per line)
 */

// Types
export type {
  SessionStatus,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionPersistentField,
  SessionPriority,
} from './types.ts';

// Field constants
export { SESSION_PERSISTENT_FIELDS } from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSessionsDir,
  ensureSessionDir,
  getSessionPath,
  getSessionFilePath,
  getSessionAttachmentsPath,
  getSessionPlansPath,
  ensureAttachmentsDir,
  // ID generation
  generateSessionId,
  // Session CRUD
  createSession,
  getOrCreateSessionById,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearSessionMessages,
  getOrCreateLatestSession,
  // Metadata updates
  updateSessionSdkId,
  updateSessionMetadata,
  canUpdateSdkCwd,
  flagSession,
  unflagSession,
  setSessionStatus,
  setSessionLabels,
  setSessionProjectId,
  unbindProjectFromSessions,
  // Pending plan execution (Accept & Compact flow)
  setPendingPlanExecution,
  markCompactionComplete,
  markPendingPlanExecutionDispatched,
  clearPendingPlanExecution,
  getPendingPlanExecution,
  // Session filtering
  listFlaggedSessions,
  listCompletedSessions,
  listInboxSessions,
  // Archive management
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
  listActiveSessions,
  deleteOldArchivedSessions,
  // Plan storage
  formatPlanAsMarkdown,
  parsePlanFromMarkdown,
  savePlanToFile,
  loadPlanFromFile,
  loadPlanFromPath,
  listPlanFiles,
  deletePlanFile,
  getMostRecentPlanFile,
  // Async persistence queue
  sessionPersistenceQueue,
  // Header metadata signature (for self-triggered event suppression)
  getHeaderMetadataSignature,
} from './storage.ts';

// JSONL helpers (for direct access if needed)
export {
  readSessionHeader,
  readSessionJsonl,
  writeSessionJsonl,
  createSessionHeader,
} from './jsonl.ts';

// Field utilities
export { pickSessionFields } from './utils.ts';

// Slug generator utilities
export {
  generateDatePrefix,
  generateHumanSlug,
  generateUniqueSessionId,
  parseSessionId,
  isHumanReadableId,
} from './slug-generator.ts';

// Word lists (for customization if needed)
export { ADJECTIVES, NOUNS } from './word-lists.ts';

// Session ID validation (security)
export {
  validateSessionId,
  sanitizeSessionId,
} from './validation.ts';

// Session bundle (export/import/dispatch)
export type {
  SessionBundle,
  BundleFile,
  BundleBranchInfo,
  DispatchMode,
} from './bundle.ts';
export {
  serializeSession,
  validateBundle,
  MAX_BUNDLE_SIZE_BYTES,
} from './bundle.ts';

// LexoRank helpers (manual session ordering)
export {
  LEXORANK_MAX_LENGTH,
  lexorankValidate,
  lexorankBetween,
  lexorankN,
  backfillRanks,
} from './lexorank.ts';

// Collection display / filter contracts (pure types)
export type {
  CollectionViewMode,
  CollectionGroupBy,
  CollectionOrderBy,
  CollectionOrderDir,
  CollectionProperty,
  CollectionDisplay,
  DueRange,
  CollectionFilters,
} from './collection-types.ts'
export {
  DEFAULT_COLLECTION_DISPLAY,
  DEFAULT_COLLECTION_FILTERS,
  COLLECTION_GROUP_BY_VALUES,
  COLLECTION_ORDER_BY_VALUES,
  COLLECTION_PROPERTY_VALUES,
} from './collection-types.ts'

// Collection pure query helpers
export type {
  CollectionSessionMeta,
  FilterSessionMetaOptions,
  DueBucket,
} from './collection-query.ts'
export {
  priorityWeight,
  dueBucket,
  filterSessionMeta,
  compareSessions,
  querySessionMetas,
} from './collection-query.ts'

// Collection display persistence (workspace collection/display.json)
export {
  COLLECTION_DISPLAY_RELATIVE_PATH,
  getCollectionDisplayPath,
  getDefaultCollectionDisplay,
  loadCollectionDisplay,
  normalizeCollectionDisplay,
  saveCollectionDisplay,
} from './collection-display-storage.ts'

