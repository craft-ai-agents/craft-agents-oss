/**
 * Sessions Module
 *
 * Public exports for workspace-scoped session management.
 */

// Types
export type {
  TodoState,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
} from './types.ts';

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
  getOrCreateLatestSession,
  // Metadata updates
  updateSessionSdkId,
  updateSessionMetadata,
  flagSession,
  unflagSession,
  setSessionTodoState,
  assignAgentToSession,
  // Session filtering
  listFlaggedSessions,
  listCompletedSessions,
  listInboxSessions,
  listSessionsByAgent,
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
} from './storage.ts';
