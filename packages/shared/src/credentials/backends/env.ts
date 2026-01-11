/**
 * Environment Variable Backend
 *
 * Read-only backend for server/container deployments.
 * Reads credentials from environment variables.
 *
 * Supported variables (in priority order):
 *   CRAFT_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY - Anthropic API key
 *   CRAFT_CLAUDE_OAUTH_TOKEN - Claude OAuth token
 *
 * Note: Workspace and agent-scoped credentials are not supported
 * via environment variables - use file backend for those.
 */

import type { CredentialBackend } from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';

// Maps credential type to env var names (in priority order - first found wins)
const ENV_MAP: Record<string, string[]> = {
  anthropic_api_key: ['CRAFT_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
  claude_oauth: ['CRAFT_CLAUDE_OAUTH_TOKEN'],
};

/** Find the first env var that has a value */
function getEnvValue(envVars: string[]): string | undefined {
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }
  return undefined;
}

export class EnvironmentBackend implements CredentialBackend {
  readonly name = 'environment';
  readonly priority = 110; // Higher than file (100) so env vars override file storage

  async isAvailable(): Promise<boolean> {
    // Always available, but only provides read access to global credentials
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    // Only support global credentials
    if (id.workspaceId) {
      return null;
    }

    const envVars = ENV_MAP[id.type];
    if (!envVars) {
      return null;
    }

    const value = getEnvValue(envVars);
    if (!value) {
      return null;
    }

    return { value };
  }

  async set(_id: CredentialId, _credential: StoredCredential): Promise<void> {
    // Environment variables are read-only
    throw new Error('Environment backend is read-only');
  }

  async delete(_id: CredentialId): Promise<boolean> {
    // Environment variables are read-only
    return false;
  }

  async list(_filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    const ids: CredentialId[] = [];

    for (const [type, envVars] of Object.entries(ENV_MAP)) {
      if (getEnvValue(envVars)) {
        ids.push({ type: type as CredentialId['type'] });
      }
    }

    return ids;
  }
}
