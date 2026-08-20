import * as path from 'node:path';
import { OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES, parseOpenClawAuditJson } from '../openclaw/audit.ts';

import type { ManagedOpenClawLauncher } from './types';

export const OPENCLAW_CAPABILITIES = [
  'gateway-run',
  'gateway-health',
  'security-audit-json',
  'config-validate',
] as const;

export type OpenClawCapability = (typeof OPENCLAW_CAPABILITIES)[number];

/** Fixed, help-only command request for an isolated capability probe. */
export interface OpenClawCapabilityProbeRequest {
  executablePath: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  maxOutputBytes: number;
}

/** DI boundary: callers own process spawning, bounds, and no-shell execution. */
export type OpenClawCapabilityProbeRunner = (
  request: OpenClawCapabilityProbeRequest,
) => Promise<{ exitCode: number; stdout: string }>;

export interface OpenClawCapabilityProbeOptions {
  /** Empty, caller-owned HOME for help-only CLI inspection; never the user's home. */
  homeDir: string;
  run: OpenClawCapabilityProbeRunner;
}

export type OpenClawCapabilityProbeResult =
  | {
      state: 'supported';
      capabilities: readonly OpenClawCapability[];
    }
  | {
      state: 'unsupported';
      reason: 'launcher-unavailable' | 'probe-environment-invalid' | 'capability-missing' | 'probe-failed';
      missing: readonly OpenClawCapability[];
    };

const CAPABILITY_CHECKS: ReadonlyArray<{
  capability: OpenClawCapability;
  args: readonly string[];
  markers: readonly string[];
}> = [
  {
    capability: 'gateway-run',
    args: ['gateway', 'run', '--help'],
    markers: ['gateway run'],
  },
  {
    capability: 'gateway-health',
    args: ['gateway', 'health', '--help'],
    markers: ['gateway health'],
  },
  {
    capability: 'security-audit-json',
    args: ['security', 'audit', '--help'],
    markers: ['security audit', '--json'],
  },
  {
    capability: 'config-validate',
    args: ['config', 'validate', '--help'],
    markers: ['config validate'],
  },
];

const MAX_HELP_OUTPUT_CHARS = OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES;

/**
 * Checks fixed `--help` surfaces plus a bounded isolated `security audit --json`.
 * It never invokes a Gateway and returns only enumerated capabilities—not CLI output.
 */
export async function probeOpenClawCapabilities(
  launcher: ManagedOpenClawLauncher | null,
  options: OpenClawCapabilityProbeOptions,
): Promise<OpenClawCapabilityProbeResult> {
  if (!launcher) {
    return {
      state: 'unsupported',
      reason: 'launcher-unavailable',
      missing: [...OPENCLAW_CAPABILITIES],
    };
  }
  if (!path.isAbsolute(options.homeDir)) {
    return {
      state: 'unsupported',
      reason: 'probe-environment-invalid',
      missing: [...OPENCLAW_CAPABILITIES],
    };
  }

  const env = {
    HOME: options.homeDir,
    XDG_CACHE_HOME: path.join(options.homeDir, '.cache'),
    XDG_CONFIG_HOME: path.join(options.homeDir, '.config'),
    XDG_DATA_HOME: path.join(options.homeDir, '.local', 'share'),
    NO_COLOR: '1',
  } as const;
  const missing: OpenClawCapability[] = [];
  let probeFailed = false;

  for (const check of CAPABILITY_CHECKS) {
    try {
      const result = await options.run({
        executablePath: launcher.executablePath,
        args: [...launcher.argsPrefix, ...check.args],
        maxOutputBytes: MAX_HELP_OUTPUT_CHARS,
        env,
      });
      const output = result.stdout.slice(0, MAX_HELP_OUTPUT_CHARS).toLowerCase();
      if (result.exitCode !== 0 || !check.markers.every((marker) => output.includes(marker))) {
        missing.push(check.capability);
      }
    } catch {
      probeFailed = true;
      missing.push(check.capability);
    }
  }

  try {
    const audit = await options.run({
      executablePath: launcher.executablePath,
      args: [...launcher.argsPrefix, 'security', 'audit', '--json'],
      env,
      maxOutputBytes: OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES,
    });
    if (
      audit.exitCode !== 0 ||
      !parseOpenClawAuditJson(audit.stdout.slice(0, OPENCLAW_AUDIT_OUTPUT_LIMIT_BYTES)).ok
    ) {
      missing.push('security-audit-json');
    }
  } catch {
    probeFailed = true;
    missing.push('security-audit-json');
  }

  const uniqueMissing = [...new Set(missing)];

  if (uniqueMissing.length > 0) {
    return {
      state: 'unsupported',
      reason: probeFailed ? 'probe-failed' : 'capability-missing',
      missing: uniqueMissing,
    };
  }
  return {
    state: 'supported',
    capabilities: [...OPENCLAW_CAPABILITIES],
  };
}
