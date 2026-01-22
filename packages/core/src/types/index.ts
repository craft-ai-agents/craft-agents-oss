/**
 * Re-export all types from @craft-agent/core
 */

// Workspace and config types
export type {
  Workspace,
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

