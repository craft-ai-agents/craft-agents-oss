import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { toolchainPaths } from '../manifest';
import { probeOpenClawCapabilities } from '../openclaw';
import { createResolver } from '../resolver';
import type { ManagedOpenClawLauncher, ToolEntry, ToolchainPaths } from '../types';

const isWindows = process.platform === 'win32';
const platform = isWindows ? 'win32-x64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
const nodeBinRel = isWindows ? 'node-v22.23.2-win-x64/node.exe' : 'node-v22.23.2/bin/node';
const INSTALL_COMPLETE_MARKER = '.craft-toolchain-install-complete';

const MANAGED_MANIFEST: ToolEntry[] = [
  {
    name: 'node',
    version: '22.23.2',
    displayName: 'Node.js 22 LTS',
    artifacts: {
      [platform]: {
        url: 'https://example.invalid/node.tgz',
        sha256: 'a'.repeat(64),
        size: 1,
        archive: 'tar.gz',
        binPaths: [nodeBinRel],
      },
    },
  },
  {
    name: 'openclaw',
    version: '2026.7.1-2',
    kind: 'npm',
    tier: 'opt-in',
    dependsOn: ['node'],
    displayName: 'OpenClaw',
    artifacts: {
      [platform]: {
        url: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
        sha256: '5bb525f36f471a41239615d321c441778c7e1c007018ed6d84b795be77803276',
        size: 19728152,
        archive: 'tar.gz',
        binPaths: ['package/openclaw.mjs'],
      },
    },
  },
];

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-toolchain-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function putFile(file: string, content = '#!/bin/sh\nexit 0\n'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (!isWindows) fs.chmodSync(file, 0o755);
}

function activateManagedTool(paths: ToolchainPaths, tool: string, version: string): void {
  const toolRoot = path.join(paths.toolchainDir, tool);
  const versionDir = path.join(toolRoot, version);
  fs.writeFileSync(path.join(versionDir, INSTALL_COMPLETE_MARKER), `${tool}@${version}\n`);
  const current = path.join(toolRoot, 'current');
  fs.rmSync(current, { recursive: true, force: true });
  if (isWindows) {
    fs.cpSync(versionDir, current, { recursive: true });
  } else {
    fs.symlinkSync(version, current, 'dir');
  }
}

function managedLauncher(): ManagedOpenClawLauncher {
  return {
    executablePath: '/managed/toolchain/node/22.23.2/bin/node',
    argsPrefix: ['/managed/toolchain/openclaw/2026.7.1-2/package/openclaw.mjs'],
    version: '2026.7.1-2',
  };
}

describe('managed OpenClaw toolchain', () => {
  it('resolves only the exact toolchain-owned Node and openclaw.mjs, never PATH', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'resolver'));
    const pathShim = path.join(tmpDir, 'global-bin');
    putFile(path.join(pathShim, isWindows ? 'node.exe' : 'node'));
    putFile(path.join(pathShim, isWindows ? 'openclaw.cmd' : 'openclaw'));

    const resolver = createResolver(paths, { manifest: MANAGED_MANIFEST, pathEnv: pathShim });
    expect(await resolver.resolveOpenClawLauncher()).toBeNull();

    const nodePath = path.join(paths.toolchainDir, 'node', '22.23.2', nodeBinRel);
    const entrypointPath = path.join(
      paths.toolchainDir,
      'openclaw',
      '2026.7.1-2',
      'package',
      'openclaw.mjs',
    );
    putFile(nodePath);
    putFile(entrypointPath, 'export {};\n');

    // Extracted files are not launchable until the installer marks the exact
    // version complete and atomically makes it current.
    expect(await resolver.resolveOpenClawLauncher()).toBeNull();
    activateManagedTool(paths, 'node', '22.23.2');
    activateManagedTool(paths, 'openclaw', '2026.7.1-2');

    expect(await resolver.resolveOpenClawLauncher()).toEqual({
      executablePath: nodePath,
      argsPrefix: [entrypointPath],
      version: '2026.7.1-2',
    });
    expect(await resolver.findExecutable('openclaw')).toBeNull();
    expect(await resolver.toolchainPathPrefix()).not.toContain(
      path.join(paths.toolchainDir, 'openclaw', 'current'),
    );
  });

  it('probes only fixed help commands in an isolated environment', async () => {
    const requests: Array<{
      executablePath: string;
      args: readonly string[];
      env: Readonly<Record<string, string>>;
      maxOutputBytes: number;
    }> = [];
    const result = await probeOpenClawCapabilities(managedLauncher(), {
      homeDir: '/isolated/openclaw-probe-home',
      run: async (request) => {
        requests.push(request);
        if (request.args.includes('--json')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ts: '2026-08-10T00:00:00.000Z',
              summary: { critical: 0, warn: 0, info: 0, pass: 1, unavailable: 0 },
              findings: [],
            }),
          };
        }
        const command = request.args.slice(1, -1).join(' ');
        return {
          exitCode: 0,
          stdout: command === 'security audit'
            ? 'Usage: openclaw security audit [options]\n  --json\n'
            : `Usage: openclaw ${command} [options]\n`,
        };
      },
    });

    expect(result).toEqual({
      state: 'supported',
      capabilities: ['gateway-run', 'gateway-health', 'security-audit-json', 'config-validate'],
    });
    expect(requests.map((request) => request.args)).toEqual([
      [...managedLauncher().argsPrefix, 'gateway', 'run', '--help'],
      [...managedLauncher().argsPrefix, 'gateway', 'health', '--help'],
      [...managedLauncher().argsPrefix, 'security', 'audit', '--help'],
      [...managedLauncher().argsPrefix, 'config', 'validate', '--help'],
      [...managedLauncher().argsPrefix, 'security', 'audit', '--json'],
    ]);
    for (const request of requests) {
      expect(request.executablePath).toBe(managedLauncher().executablePath);
      expect(request.env).toEqual({
        HOME: '/isolated/openclaw-probe-home',
        XDG_CACHE_HOME: '/isolated/openclaw-probe-home/.cache',
        XDG_CONFIG_HOME: '/isolated/openclaw-probe-home/.config',
        XDG_DATA_HOME: '/isolated/openclaw-probe-home/.local/share',
        NO_COLOR: '1',
      });
      expect(request.maxOutputBytes).toBe(1024 * 1024);
    }
  });

  it('returns structured non-secret unsupported results for a missing launcher or capability', async () => {
    const missingLauncher = await probeOpenClawCapabilities(null, {
      homeDir: '/isolated/openclaw-probe-home',
      run: async () => ({ exitCode: 0, stdout: '' }),
    });
    expect(missingLauncher).toEqual({
      state: 'unsupported',
      reason: 'launcher-unavailable',
      missing: ['gateway-run', 'gateway-health', 'security-audit-json', 'config-validate'],
    });

    const missingCapability = await probeOpenClawCapabilities(managedLauncher(), {
      homeDir: '/isolated/openclaw-probe-home',
      run: async (request) => {
        if (request.args.at(-1) === '--json') {
          return { exitCode: 0, stdout: 'not a valid audit document' };
        }
        const command = request.args.slice(1, -1).join(' ');
        return {
          exitCode: 0,
          stdout: command === 'security audit'
            ? 'Usage: openclaw security audit [options]\n  --json\n'
            : `Usage: openclaw ${command} [options]\n`,
        };
      },
    });
    expect(missingCapability).toEqual({
      state: 'unsupported',
      reason: 'capability-missing',
      missing: ['security-audit-json'],
    });
  });
});
