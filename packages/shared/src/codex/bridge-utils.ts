/**
 * Bridge MCP Server Utilities
 *
 * Shared file I/O helpers for backends that use bridge-mcp-server (Codex, Copilot).
 * Writes bridge-config.json and credential cache files so the bridge subprocess
 * can authenticate API source requests.
 */

import { join } from 'node:path';
import { mkdir, writeFile, open, rename } from 'node:fs/promises';
import { generateBridgeConfig, getCredentialCachePath, type CredentialCacheEntry } from './config-generator.ts';
import { getSourceCredentialManager } from '../sources/credential-manager.ts';
import type { LoadedSource } from '../sources/types.ts';

/**
 * Write a file with restricted permissions atomically.
 *
 * Avoids TOCTOU (Time-of-Check-Time-of-Use) race conditions where the file
 * could be read with default permissions between write and chmod.
 *
 * Strategy: Open file with O_CREAT|O_EXCL and mode 0o600, write, close, rename.
 */
export async function writeFileSecure(targetPath: string, content: string, mode: number = 0o600): Promise<void> {
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  const fd = await open(tempPath, 'wx', mode);
  try {
    await fd.writeFile(content, 'utf-8');
  } finally {
    await fd.close();
  }
  await rename(tempPath, targetPath);
}

/**
 * Write bridge-config.json and credential cache files for API sources.
 * Shared by all backends that use bridge-mcp-server (Codex, Copilot).
 *
 * @param configDir - Directory to write bridge-config.json into
 * @param sources - All enabled sources (API sources are filtered internally)
 */
export async function writeBridgeSourceFiles(
  configDir: string,
  sources: LoadedSource[],
): Promise<void> {
  const apiSources = sources.filter(s => s.config.type === 'api' && s.config.enabled);
  if (apiSources.length === 0) return;

  await mkdir(configDir, { recursive: true });

  // Generate bridge config JSON (tells bridge which API sources to expose)
  const bridgeConfig = generateBridgeConfig(sources);
  await writeFile(join(configDir, 'bridge-config.json'), bridgeConfig, 'utf-8');

  // Write credential cache files for the bridge server to read
  const credManager = getSourceCredentialManager();
  for (const source of apiSources) {
    const cred = await credManager.load(source);
    if (cred?.value) {
      const cachePath = getCredentialCachePath(source.workspaceRootPath, source.config.slug);
      const cacheEntry: CredentialCacheEntry = {
        value: cred.value,
        expiresAt: cred.expiresAt,
      };
      await mkdir(join(source.workspaceRootPath, 'sources', source.config.slug), { recursive: true });
      await writeFileSecure(cachePath, JSON.stringify(cacheEntry), 0o600);
    }
  }
}
