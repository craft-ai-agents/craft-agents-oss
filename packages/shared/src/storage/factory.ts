/**
 * Storage Provider Factory
 *
 * Creates the appropriate storage provider based on workspace configuration.
 * - Local workspaces → LocalStorageProvider (filesystem)
 * - Cloud workspaces → CloudStorageProvider (WebSocket + REST to cloud-worker)
 */

import type { Workspace } from '@craft-agent/core';
import type { IStorageProvider } from './types.ts';
import { LocalStorageProvider } from './local/index.ts';
import { CloudStorageProvider } from './cloud/index.ts';

export interface CreateStorageProviderOptions {
  workspace: Workspace;
  /** API key for cloud workspaces (retrieved from CredentialManager by the caller) */
  apiKey?: string;
}

/**
 * Create a storage provider for a workspace.
 *
 * For local workspaces, returns a LocalStorageProvider wrapping filesystem operations.
 * For cloud workspaces, returns a CloudStorageProvider that connects via WebSocket/REST.
 *
 * The provider must be initialized after creation by calling `provider.initialize()`.
 */
export function createStorageProvider(options: CreateStorageProviderOptions): IStorageProvider {
  const { workspace, apiKey } = options;

  if (workspace.storageType === 'cloud') {
    if (!workspace.cloudConfig) {
      throw new Error(`Cloud workspace "${workspace.name}" is missing cloudConfig`);
    }
    if (!apiKey) {
      throw new Error(`Cloud workspace "${workspace.name}" requires an API key`);
    }

    return new CloudStorageProvider({
      remoteUrl: workspace.cloudConfig.remoteUrl,
      workspaceSlug: workspace.cloudConfig.workspaceSlug,
      apiKey,
    });
  }

  // Default: local filesystem storage
  if (!workspace.rootPath) {
    throw new Error(`Local workspace "${workspace.name}" is missing rootPath`);
  }
  return new LocalStorageProvider(workspace.id, workspace.rootPath);
}
