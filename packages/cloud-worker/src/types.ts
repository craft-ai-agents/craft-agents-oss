import type { Sandbox } from '@cloudflare/sandbox';

/**
 * Worker Environment Types
 */

export interface Env {
  WORKSPACE: DurableObjectNamespace;
  API_KEY: string;
  FILES: R2Bucket;
  // Sandbox Durable Object (container-backed)
  Sandbox: DurableObjectNamespace<Sandbox>;
  // GitHub OAuth
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  // Encryption key for credentials (32-byte hex)
  ENCRYPTION_KEY: string;
  // Anthropic API key for sandbox sessions
  ANTHROPIC_API_KEY: string;
}

/**
 * GitHub OAuth credentials stored per project
 */
export interface GitHubCredential {
  accessToken: string; // encrypted
  username: string;
  userId: number;
  scope: string;
  authenticatedAt: number;
  expiresAt?: number;
}

/**
 * Project state (one per repo per workspace)
 */
export interface Project {
  repoKey: string; // "owner/repo"
  repoUrl: string; // git@github.com:owner/repo.git or https://...
  defaultBranch: string;
  addedAt: number;
  github: GitHubCredential | null;
}

/**
 * Sandbox session state
 */
export type SandboxStatus = 'provisioning' | 'cloning' | 'ready' | 'idle' | 'expired';

export interface SandboxSession {
  sessionId: string;
  repoKey: string;
  sandboxId: string;
  branch: string;
  status: SandboxStatus;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

/**
 * OAuth state for CSRF protection
 */
export interface OAuthState {
  workspaceSlug: string;
  repoKey: string;
  redirectUri: string;
  nonce: string;
}

/**
 * File storage types
 */
export type FileType = 'attachments' | 'downloads' | 'long_responses';

export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
}

export const VALID_FILE_TYPES: FileType[] = ['attachments', 'downloads', 'long_responses'];

export function isValidFileType(type: string): type is FileType {
  return VALID_FILE_TYPES.includes(type as FileType);
}
