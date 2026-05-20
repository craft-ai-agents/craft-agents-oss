/**
 * Workspace Module
 *
 * Re-exports types and storage functions for workspaces.
 */

// Types
export type {
  WorkspaceConfig,
  TeamPublicKnowledgeConfig,
  TeamPublicKnowledgeDocumentConfig,
  CreateWorkspaceInput,
  LoadedWorkspace,
  WorkspaceSummary,
} from './types.ts';

// Storage functions
export {
  CHAT_FEEDBACK_STATE_FILE,
  deleteChatFeedbackState,
  getChatFeedbackState,
  listChatFeedbackState,
  loadChatFeedbackState,
  setChatFeedbackState,
} from './chat-feedback-state.ts';

export type {
  ChatFeedbackStateEntry,
  ChatFeedbackStateFile,
} from './chat-feedback-state.ts';

export {
  // Path utilities
  getDefaultWorkspacesDir,
  ensureDefaultWorkspacesDir,
  getWorkspacePath,
  getWorkspaceSourcesPath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  // Config operations
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  // Load operations
  loadWorkspace,
  getWorkspaceSummary,
  // Create/Delete operations
  generateSlug,
  generateUniqueWorkspacePath,
  createWorkspaceAtPath,
  deleteWorkspaceFolder,
  isValidWorkspace,
  renameWorkspaceFolder,
  // Auto-discovery
  discoverWorkspacesInDefaultLocation,
  // Constants
  CONFIG_DIR,
  DEFAULT_WORKSPACES_DIR,
} from './storage.ts';
