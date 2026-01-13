/**
 * Electron-specific manifest fetching
 *
 * Uses the /electron/ path prefix for Electron app updates.
 * Endpoints:
 * - https://agents.craft.do/electron/latest
 * - https://agents.craft.do/electron/{version}/manifest.json
 */

import semver from 'semver';
import { debug } from '../utils/debug';
import type { VersionManifest } from './manifest';

const ELECTRON_VERSIONS_URL = 'https://agents.craft.do/electron';

/** Default timeout for network requests (10 seconds) */
const FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch with timeout to prevent hanging on slow/unresponsive servers
 */
async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch the latest Electron app version from the server
 */
export async function getElectronLatestVersion(): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(`${ELECTRON_VERSIONS_URL}/latest`);
    if (!response.ok) {
      debug(`[electron-manifest] Failed to fetch latest version: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const version = (data as { version?: string }).version;
    if (typeof version !== 'string') {
      debug('[electron-manifest] Latest version is not a valid string');
      return null;
    }
    return version;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      debug('[electron-manifest] Fetch latest version timed out');
    } else {
      debug(`[electron-manifest] Failed to get latest version: ${error}`);
    }
    return null;
  }
}

/**
 * Fetch the manifest for a specific Electron app version
 */
export async function getElectronManifest(version: string): Promise<VersionManifest | null> {
  try {
    const url = `${ELECTRON_VERSIONS_URL}/${version}/manifest.json`;
    debug(`[electron-manifest] Getting manifest for version: ${url}`);
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      debug(`[electron-manifest] Failed to fetch manifest: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data as VersionManifest;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      debug('[electron-manifest] Fetch manifest timed out');
    } else {
      debug(`[electron-manifest] Failed to get manifest: ${error}`);
    }
    return null;
  }
}

/**
 * Compare two semver version strings
 * Returns true if `latest` is newer than `current`
 *
 * Uses the semver package for reliable version comparison.
 * Handles: standard versions, prerelease, build metadata, v prefix.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  try {
    // semver.coerce handles partial versions like "1" or "1.0" and v prefix
    const currentCoerced = semver.coerce(current);
    const latestCoerced = semver.coerce(latest);

    if (!currentCoerced || !latestCoerced) {
      debug(`[electron-manifest] Could not parse versions: current=${current}, latest=${latest}. Skipping update.`);
      return false;
    }

    // For versions with prerelease tags, we need to use the original strings
    // semver.coerce strips prerelease info, so check if originals are valid first
    const currentValid = semver.valid(current);
    const latestValid = semver.valid(latest);

    if (currentValid && latestValid) {
      // Both are valid semver strings, compare directly
      return semver.gt(latestValid, currentValid);
    }

    // Fall back to coerced versions for partial version strings
    return semver.gt(latestCoerced, currentCoerced);
  } catch (error) {
    debug(`[electron-manifest] Version comparison failed: ${error}. Skipping update.`);
    return false;
  }
}

/**
 * Get the platform key for the current system (darwin-arm64, darwin-x64, etc.)
 */
export function getPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}
