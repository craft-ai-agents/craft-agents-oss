/**
 * Tests for the Claude SDK sandbox config builder.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  buildClaudeSandboxOptions,
  getSandboxWriteRoots,
  getSandboxAllowedHosts,
  isPathInsideAllowedRoots,
  isHostAllowed,
  extractSandboxGatedFilePath,
  extractSandboxGatedUrl,
  isSandboxNetworkGatedTool,
  safeExtractHost,
  SANDBOX_GATED_TOOLS,
} from '../sandbox-config.ts';
import type { SessionConfig } from '../../sessions/types.ts';

const WORKSPACE = '/tmp/craft-test-workspace';
const SESSION_ID = 'test-session';
const EXPECTED_SESSION_DIR = join(WORKSPACE, 'sessions', SESSION_ID);
const EXPECTED_WORKSPACE_DATA_DIR = join(WORKSPACE, 'data');

function makeSession(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    id: SESSION_ID,
    workspaceRootPath: WORKSPACE,
    createdAt: 0,
    lastUsedAt: 0,
    ...overrides,
  };
}

describe('buildClaudeSandboxOptions', () => {
  it('returns undefined when session is missing', () => {
    const result = buildClaudeSandboxOptions({
      session: undefined,
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when sandboxed is not enabled', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when sandboxed is undefined', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession(),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns enabled config when sandboxed is true', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true, workingDirectory: '/Users/me/project' }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    expect(result).toBeDefined();
    expect(result?.enabled).toBe(true);
    expect(result?.autoAllowBashIfSandboxed).toBe(true);
  });

  it('closes the dangerouslyDisableSandbox escape hatch', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    // Craft already exposes user-controlled escape hatches (toggle sandbox
    // off entirely, or unset it on the session). The SDK's per-tool
    // `dangerouslyDisableSandbox` parameter would let the LLM silently
    // bypass under allow-all permission mode, undermining the property
    // the user opted in for.
    expect(result?.allowUnsandboxedCommands).toBe(false);
  });

  it('defaults failIfUnavailable to true when sandboxFailHard is unset', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.failIfUnavailable).toBe(true);
  });

  it('honors sandboxFailHard: false for graceful degradation', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true, sandboxFailHard: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.failIfUnavailable).toBe(false);
  });

  it('includes workingDirectory, sdkCwd, session dir, and workspace data dir in allowWrite', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).toContain('/Users/me/project');
    expect(allowWrite).toContain(EXPECTED_SESSION_DIR);
    // Workspace `data/` is the documented home for cross-run state
    // (caches, seen-sets, etc.) that automations need to update.
    expect(allowWrite).toContain(EXPECTED_WORKSPACE_DATA_DIR);
  });

  it('does NOT add the whole workspace root to allowWrite', () => {
    // automations.json, config.json, sources/, and other sessions' transcripts
    // must remain write-protected even from the sandboxed agent itself.
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).not.toContain(WORKSPACE);
  });

  it('deduplicates allowWrite when workingDirectory equals sdkCwd', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    const occurrences = allowWrite.filter((p) => p === '/Users/me/project').length;
    expect(occurrences).toBe(1);
  });

  it('falls back to session dir + workspace data for sessions without a working folder', () => {
    // When no workingDirectory is set, sdkCwd defaults to the session storage
    // dir at session creation. Writable roots are then the session dir and
    // the workspace `data/` dir (workspace-shared scratch for automations).
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).toContain(EXPECTED_SESSION_DIR);
    expect(allowWrite).toContain(EXPECTED_WORKSPACE_DATA_DIR);
    expect(allowWrite).toHaveLength(2);
  });

  it('always allows api.anthropic.com in network.allowedDomains', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.network?.allowedDomains).toContain('api.anthropic.com');
  });

  it('uses strict managed-domains mode under allow-all permission', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true, permissionMode: 'allow-all' }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.network?.allowManagedDomainsOnly).toBe(true);
  });

  it('lets the SDK prompt under safe / ask permission modes', () => {
    for (const mode of ['safe', 'ask'] as const) {
      const result = buildClaudeSandboxOptions({
        session: makeSession({ sandboxed: true, permissionMode: mode }),
        workspaceRootPath: WORKSPACE,
        sdkCwd: EXPECTED_SESSION_DIR,
      });
      expect(result?.network?.allowManagedDomainsOnly).toBe(false);
    }
  });

  it('includes hosts passed via allowedHosts', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
      allowedHosts: ['api.linear.app', 'mcp.example.com'],
    });
    expect(result?.network?.allowedDomains).toContain('api.linear.app');
    expect(result?.network?.allowedDomains).toContain('mcp.example.com');
    expect(result?.network?.allowedDomains).toContain('api.anthropic.com');
  });
});

describe('getSandboxAllowedHosts', () => {
  it('returns an empty array when not sandboxed', () => {
    expect(getSandboxAllowedHosts({
      session: makeSession({ sandboxed: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    })).toEqual([]);
  });

  it('always includes api.anthropic.com when sandboxed', () => {
    const hosts = getSandboxAllowedHosts({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(hosts).toEqual(['api.anthropic.com']);
  });

  it('lowercases and deduplicates hosts', () => {
    const hosts = getSandboxAllowedHosts({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
      allowedHosts: ['API.LINEAR.APP', 'api.linear.app', 'api.anthropic.com'],
    });
    expect(hosts.filter((h) => h === 'api.linear.app').length).toBe(1);
    expect(hosts.filter((h) => h === 'api.anthropic.com').length).toBe(1);
  });

  it('drops empty / whitespace-only entries defensively', () => {
    const hosts = getSandboxAllowedHosts({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
      allowedHosts: ['', '   ', 'api.linear.app'],
    });
    expect(hosts).toContain('api.linear.app');
    expect(hosts).not.toContain('');
  });
});

describe('safeExtractHost', () => {
  it('extracts lowercased hostname from valid URLs', () => {
    expect(safeExtractHost('https://API.Linear.App/v1/issues')).toBe('api.linear.app');
    expect(safeExtractHost('http://localhost:8080/mcp')).toBe('localhost');
  });

  it('returns null for non-URL strings', () => {
    expect(safeExtractHost('not a url')).toBeNull();
    expect(safeExtractHost('')).toBeNull();
    expect(safeExtractHost('/just/a/path')).toBeNull();
  });

  it('returns null for missing host', () => {
    // Custom schemes without a host
    expect(safeExtractHost('file:///etc/passwd')).toBeNull();
  });
});

describe('getSandboxWriteRoots', () => {
  it('returns an empty array when not sandboxed', () => {
    expect(getSandboxWriteRoots({
      session: makeSession({ sandboxed: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    })).toEqual([]);
  });

  it('includes active local source paths in the write roots', () => {
    const roots = getSandboxWriteRoots({
      session: makeSession({ sandboxed: true, workingDirectory: '/Users/me/project' }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
      localSourcePaths: ['/Users/me/notes', '/Users/me/research'],
    });
    expect(roots).toContain('/Users/me/notes');
    expect(roots).toContain('/Users/me/research');
  });

  it('deduplicates a local source path that matches workingDirectory', () => {
    const roots = getSandboxWriteRoots({
      session: makeSession({ sandboxed: true, workingDirectory: '/Users/me/project' }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
      localSourcePaths: ['/Users/me/project'],
    });
    const occurrences = roots.filter((p) => p === '/Users/me/project').length;
    expect(occurrences).toBe(1);
  });

  it('skips empty / falsy local source paths defensively', () => {
    const roots = getSandboxWriteRoots({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
      localSourcePaths: ['', '/Users/me/notes'],
    });
    expect(roots).toContain('/Users/me/notes');
    expect(roots).not.toContain('');
  });

  it('returns the same roots that buildClaudeSandboxOptions feeds the SDK', () => {
    // The PreToolUse hook and the OS sandbox MUST agree. This test guards
    // against drift between the two enforcement layers.
    const args = {
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    };
    const roots = getSandboxWriteRoots(args);
    const sandboxOpts = buildClaudeSandboxOptions(args);
    expect(sandboxOpts?.filesystem?.allowWrite).toEqual(roots);
  });
});

describe('isPathInsideAllowedRoots', () => {
  const ROOTS = ['/Users/me/project', '/tmp/scratch'];
  const CWD = '/Users/me/project';

  it('matches an exact root path', () => {
    expect(isPathInsideAllowedRoots('/Users/me/project', ROOTS, CWD)).toBe(true);
  });

  it('matches a file inside a root', () => {
    expect(isPathInsideAllowedRoots('/Users/me/project/src/foo.ts', ROOTS, CWD)).toBe(true);
  });

  it('matches via cwd resolution for relative paths', () => {
    expect(isPathInsideAllowedRoots('src/foo.ts', ROOTS, CWD)).toBe(true);
  });

  it('does not match a sibling whose name is a prefix of a root', () => {
    // Important: /Users/me/projection should NOT be considered inside /Users/me/project.
    expect(isPathInsideAllowedRoots('/Users/me/projection/x.ts', ROOTS, CWD)).toBe(false);
  });

  it('rejects paths outside every root', () => {
    expect(isPathInsideAllowedRoots('/etc/passwd', ROOTS, CWD)).toBe(false);
    expect(isPathInsideAllowedRoots('/Users/me/Documents/secret.txt', ROOTS, CWD)).toBe(false);
  });
});

describe('extractSandboxGatedFilePath', () => {
  it('extracts file_path for Write/Edit/MultiEdit', () => {
    expect(extractSandboxGatedFilePath('Write', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
    expect(extractSandboxGatedFilePath('Edit', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
    expect(extractSandboxGatedFilePath('MultiEdit', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
  });

  it('extracts notebook_path for NotebookEdit', () => {
    expect(extractSandboxGatedFilePath('NotebookEdit', { notebook_path: '/x/y.ipynb' })).toBe('/x/y.ipynb');
  });

  it('returns null for tools that aren\'t sandbox-gated', () => {
    expect(extractSandboxGatedFilePath('Read', { file_path: '/x/y.txt' })).toBeNull();
    expect(extractSandboxGatedFilePath('Bash', { command: 'ls' })).toBeNull();
  });

  it('returns null when the path field is missing or non-string', () => {
    expect(extractSandboxGatedFilePath('Write', {})).toBeNull();
    expect(extractSandboxGatedFilePath('Write', { file_path: 42 })).toBeNull();
    expect(extractSandboxGatedFilePath('Write', undefined)).toBeNull();
  });

  it('SANDBOX_GATED_TOOLS covers exactly the SDK\'s built-in writers', () => {
    // Lock in the gated set — adding a new built-in writer (e.g. a future
    // notebook-cell editor) requires an explicit code change here, which
    // forces the author to think about sandbox semantics.
    expect([...SANDBOX_GATED_TOOLS].sort()).toEqual([
      'Edit', 'MultiEdit', 'NotebookEdit', 'Write',
    ]);
  });
});

describe('isSandboxNetworkGatedTool', () => {
  it('matches WebFetch exactly', () => {
    expect(isSandboxNetworkGatedTool('WebFetch')).toBe(true);
  });

  it('matches canonical browser_tool and namespaced variants', () => {
    expect(isSandboxNetworkGatedTool('browser_tool')).toBe(true);
    expect(isSandboxNetworkGatedTool('mcp__session__browser_tool')).toBe(true);
  });

  it('matches legacy browser_navigate / browser_open aliases', () => {
    expect(isSandboxNetworkGatedTool('browser_navigate')).toBe(true);
    expect(isSandboxNetworkGatedTool('browser_open')).toBe(true);
    expect(isSandboxNetworkGatedTool('browser_snapshot')).toBe(true);
  });

  it('does not match non-network tools', () => {
    expect(isSandboxNetworkGatedTool('Bash')).toBe(false);
    expect(isSandboxNetworkGatedTool('Write')).toBe(false);
    expect(isSandboxNetworkGatedTool('Read')).toBe(false);
    expect(isSandboxNetworkGatedTool('WebSearch')).toBe(false);
  });
});

describe('extractSandboxGatedUrl', () => {
  it('extracts url from WebFetch input', () => {
    expect(extractSandboxGatedUrl('WebFetch', { url: 'https://example.com/api' })).toBe('https://example.com/api');
  });

  it('extracts the URL from browser_tool navigate subcommand (string form)', () => {
    expect(extractSandboxGatedUrl('browser_tool', { command: 'navigate https://example.com' }))
      .toBe('https://example.com');
  });

  it('extracts the URL from browser_tool open subcommand', () => {
    expect(extractSandboxGatedUrl('browser_tool', { command: 'open https://example.com' }))
      .toBe('https://example.com');
  });

  it('extracts the URL from browser_tool with array command', () => {
    expect(extractSandboxGatedUrl('browser_tool', { command: ['navigate', 'https://example.com'] }))
      .toBe('https://example.com');
  });

  it('returns null for non-URL browser_tool subcommands', () => {
    expect(extractSandboxGatedUrl('browser_tool', { command: 'snapshot' })).toBeNull();
    expect(extractSandboxGatedUrl('browser_tool', { command: 'click #login' })).toBeNull();
    expect(extractSandboxGatedUrl('browser_tool', { command: 'wait network-idle' })).toBeNull();
  });

  it('extracts url from legacy browser_navigate alias', () => {
    expect(extractSandboxGatedUrl('browser_navigate', { url: 'https://example.com' }))
      .toBe('https://example.com');
  });

  it('returns null for non-network-gated tools', () => {
    expect(extractSandboxGatedUrl('Write', { file_path: '/x/y.txt' })).toBeNull();
    expect(extractSandboxGatedUrl('Bash', { command: 'ls' })).toBeNull();
  });

  it('returns null on missing or malformed input', () => {
    expect(extractSandboxGatedUrl('WebFetch', {})).toBeNull();
    expect(extractSandboxGatedUrl('browser_tool', {})).toBeNull();
    expect(extractSandboxGatedUrl('browser_tool', { command: '' })).toBeNull();
    expect(extractSandboxGatedUrl('browser_tool', { command: 42 as unknown as string })).toBeNull();
  });
});

describe('isHostAllowed', () => {
  const ALLOWED = ['api.anthropic.com', 'api.linear.app'];

  it('matches an exact host', () => {
    expect(isHostAllowed('api.anthropic.com', ALLOWED)).toBe(true);
    expect(isHostAllowed('api.linear.app', ALLOWED)).toBe(true);
  });

  it('matches a subdomain of an allowed host', () => {
    expect(isHostAllowed('cdn.api.linear.app', ALLOWED)).toBe(true);
  });

  it('rejects a hostname that is a PREFIX of an allowed host', () => {
    // 'linear.app' ≠ 'api.linear.app'; allowing this would be a leak.
    expect(isHostAllowed('linear.app', ALLOWED)).toBe(false);
    expect(isHostAllowed('apxlinear.app', ALLOWED)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isHostAllowed('API.Linear.App', ALLOWED)).toBe(true);
  });

  it('rejects null / empty hosts', () => {
    expect(isHostAllowed(null, ALLOWED)).toBe(false);
    expect(isHostAllowed('', ALLOWED)).toBe(false);
  });

  it('rejects when allowed list is empty', () => {
    expect(isHostAllowed('api.anthropic.com', [])).toBe(false);
  });
});
