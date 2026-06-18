/**
 * RTK binary detector.
 *
 * Resolves the path to the rtk binary (https://github.com/rtk-ai/rtk) by
 * looking it up on the user's PATH, then verifies it meets the minimum
 * version required by `rtk rewrite` (added in 0.23.0).
 *
 * Result is cached per process — restart the app to pick up an install
 * or upgrade.
 *
 * Bundling rtk in `apps/electron/resources/bin/` is a separate concern
 * (see plans/rtk-integration-path-a.md); this MVP detects only.
 */

import { execFileSync } from 'node:child_process';

const REQUIRED_MIN_VERSION = { major: 0, minor: 23, patch: 0 } as const;

interface CachedStatus {
  path: string | null;
  version: string | null;
}

let cachedStatus: CachedStatus | undefined = undefined;

/**
 * Status of the rtk binary for UI display.
 */
export interface RtkStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

/**
 * Get the absolute path to the rtk binary, or null if not installed
 * or installed version is below the required minimum.
 */
export function getRtkPath(): string | null {
  return resolveStatus().path;
}

/**
 * Get installation status for the rtk binary. Used by Settings UI to decide
 * between an "install" prompt and the enable/disable toggle.
 */
export function getRtkStatus(opts?: { forceRecheck?: boolean }): RtkStatus {
  if (opts?.forceRecheck) resetRtkPathCache();
  const { path, version } = resolveStatus();
  return { installed: path !== null, path, version };
}

/**
 * Token-savings stats from `rtk gain --format json`. Returns null if rtk
 * is not installed, the spawn fails, or the JSON can't be parsed. The Settings
 * UI uses this to render an efficiency meter beneath the RTK toggle.
 */
export interface RtkGainStats {
  totalCommands: number;
  totalInput: number;
  totalOutput: number;
  totalSaved: number;
  avgSavingsPct: number;
  totalTimeMs: number;
  avgTimeMs: number;
}

export function getRtkGain(): RtkGainStats | null {
  const rtkPath = getRtkPath();
  if (!rtkPath) return null;

  try {
    const out = execFileSync(rtkPath, ['gain', '--format', 'json'], {
      encoding: 'utf-8',
      timeout: 2000,
      env: { ...process.env, RTK_TELEMETRY_DISABLED: '1' },
    });
    const parsed = JSON.parse(out) as { summary?: Partial<Record<keyof RtkGainStats | 'total_commands' | 'total_input' | 'total_output' | 'total_saved' | 'avg_savings_pct' | 'total_time_ms' | 'avg_time_ms', number>> };
    const s = parsed.summary;
    if (!s) return null;
    return {
      totalCommands: Number(s.total_commands ?? 0),
      totalInput: Number(s.total_input ?? 0),
      totalOutput: Number(s.total_output ?? 0),
      totalSaved: Number(s.total_saved ?? 0),
      avgSavingsPct: Number(s.avg_savings_pct ?? 0),
      totalTimeMs: Number(s.total_time_ms ?? 0),
      avgTimeMs: Number(s.avg_time_ms ?? 0),
    };
  } catch {
    return null;
  }
}

/** Clears the cached detection result so the next call probes PATH fresh. */
export function resetRtkPathCache(): void {
  cachedStatus = undefined;
}

function resolveStatus(): CachedStatus {
  if (cachedStatus !== undefined) return cachedStatus;

  const rtkPath = findRtkOnPath();
  if (!rtkPath) {
    cachedStatus = { path: null, version: null };
    return cachedStatus;
  }

  const version = readRtkVersion(rtkPath);
  if (!version || !meetsMinVersion(version)) {
    cachedStatus = { path: null, version };
    return cachedStatus;
  }

  cachedStatus = { path: rtkPath, version };
  return cachedStatus;
}

function findRtkOnPath(): string | null {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(whichCmd, ['rtk'], { encoding: 'utf-8', timeout: 2000 }).trim();
    // `where` returns multiple lines on Windows — take the first.
    return result.split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

function readRtkVersion(rtkPath: string): string | null {
  try {
    const out = execFileSync(rtkPath, ['--version'], { encoding: 'utf-8', timeout: 2000 }).trim();
    return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function meetsMinVersion(version: string): boolean {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (major !== REQUIRED_MIN_VERSION.major) return major > REQUIRED_MIN_VERSION.major;
  if (minor !== REQUIRED_MIN_VERSION.minor) return minor > REQUIRED_MIN_VERSION.minor;
  return patch >= REQUIRED_MIN_VERSION.patch;
}
