/**
 * Re-export all types from @craft-agent/core
 */

// Workspace and config types
export type {
  Workspace,
  WorkspaceStorageType,
  McpAuthType,
  AuthType,
  OAuthCredentials,
  StoredConfig,
} from './workspace.ts';

// Session types
export type {
  Session,
  StoredSession,
  SessionMetadata,
  SessionStatus,
} from './session.ts';

// Cloud workspace types
export type {
  CloudWorkspaceConfig,
  WSClientMessage,
  WSServerMessage,
  WSRemoteChangeEvent,
  CloudConnectionState,
  CloudConnectionStatus,
} from './cloud.ts';

// Message types
export type {
  MessageRole,
  ToolStatus,
  ToolDisplayMeta,
  AttachmentType,
  MessageAttachment,
  StoredAttachment,
  ContentBadge,
  Message,
  StoredMessage,
  TokenUsage,
  AgentEventUsage,
  RecoveryAction,
  TypedError,
  PermissionRequest,
  AgentEvent,
  // Auth-related types
  CredentialInputMode,
  AuthRequestType,
  AuthStatus,
} from './message.ts';
export { generateMessageId } from './message.ts';

