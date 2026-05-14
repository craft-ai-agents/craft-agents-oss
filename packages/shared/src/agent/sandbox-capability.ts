/**
 * Sandbox capability detection.
 *
 * The Claude Agent SDK uses Seatbelt on macOS and bubblewrap on Linux/WSL2 to
 * enforce its native sandbox. On platforms where the runtime can't start the
 * sandbox (Windows native, or Linux without bubblewrap+socat installed),
 * passing `sandbox: { enabled: true, failIfUnavailable: true }` to query()
 * makes the session error out at first use. Probing up front lets the UI
 * disable the toggle and explain why, instead of letting users hit a
 * confusing runtime error.
 *
 * Result is cached for the process lifetime — installed-tools state shouldn't
 * change while the app is running.
 */

import { spawnSync } from 'node:child_process';

export type SandboxCapability =
  | { available: true }
  | { available: false; reason: 'platform-unsupported'; platform: NodeJS.Platform }
  | { available: false; reason: 'missing-deps'; missing: string[] };

let cached: SandboxCapability | null = null;

function commandExists(binary: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [binary], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Check whether the Claude SDK's sandbox runtime can start on this machine.
 * Cached — call any number of times.
 */
export function getSandboxCapability(): SandboxCapability {
  if (cached) return cached;

  if (process.platform === 'darwin') {
    // Seatbelt is built into macOS — no external dependency to verify.
    cached = { available: true };
    return cached;
  }

  if (process.platform === 'linux') {
    // Linux + WSL2 use bubblewrap for filesystem isolation. The SDK's
    // network proxy needs `socat` on PATH for the per-domain prompt flow.
    const missing: string[] = [];
    if (!commandExists('bwrap')) missing.push('bwrap');
    if (!commandExists('socat')) missing.push('socat');
    cached = missing.length === 0
      ? { available: true }
      : { available: false, reason: 'missing-deps', missing };
    return cached;
  }

  // win32 (native) and any other platform: no path forward today.
  cached = {
    available: false,
    reason: 'platform-unsupported',
    platform: process.platform,
  };
  return cached;
}

/** Reset the cache. Test-only — production callers should never invoke this. */
export function _resetSandboxCapabilityCacheForTesting(): void {
  cached = null;
}
