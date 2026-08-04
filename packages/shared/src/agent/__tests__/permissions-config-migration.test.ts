import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const originalCwd = process.cwd();
const originalConfigDir = process.env.ARCHSTUDIO_CONFIG_DIR;

// file URL (forward slashes) so the path survives subprocess --eval on Windows.
const PERMISSIONS_CONFIG_MODULE = pathToFileURL(join(import.meta.dir, '..', 'permissions-config.ts')).href;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.ARCHSTUDIO_CONFIG_DIR;
  else process.env.ARCHSTUDIO_CONFIG_DIR = originalConfigDir;
});

describe('ensureDefaultPermissions migration', () => {
  it('merges new bundled defaults into existing installed file and preserves customizations', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'permissions-bundle-'));
    const tempConfig = mkdtempSync(join(tmpdir(), 'permissions-config-'));

    const bundledDir = join(tempRoot, 'resources', 'permissions');
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(
      join(bundledDir, 'default.json'),
      JSON.stringify({
        version: '2026-03-01',
        allowedBashPatterns: [
          { pattern: '^rg\\b', comment: 'Ripgrep search' },
          { pattern: '^bun\\s+run\\s+typecheck\\b$', comment: 'Typecheck' },
        ],
        allowedMcpPatterns: ['search'],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        blockedCommandHints: [
          { command: 'printf', reason: 'printf blocked by default' },
        ],
      }, null, 2)
    );

    const installedDir = join(tempConfig, 'permissions');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      join(installedDir, 'default.json'),
      JSON.stringify({
        version: '2026-02-01',
        allowedBashPatterns: [
          { pattern: '^rg\\b', comment: 'User existing pattern' },
          { pattern: '^custom-review\\b', comment: 'User customization' },
        ],
        allowedMcpPatterns: ['list'],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        blockedCommandHints: [
          { command: 'sed', reason: 'sed print-only policy', whenNotMatching: '^sed\\s+-n\\b' },
        ],
      }, null, 2)
    );

    // Run ensureDefaultPermissions in a fresh subprocess: CONFIG_DIR is captured
    // from ARCHSTUDIO_CONFIG_DIR at module load, and a worker process may reuse a
    // previously-loaded paths.ts (with the default CONFIG_DIR), making an in-process
    // env override flaky. The subprocess chdirs to tempRoot so the bundled assets
    // dir (cwd/resources/permissions) resolves to the fixture; the parent keeps its
    // own cwd so cleanup rmSync doesn't hit EBUSY.
    const run = Bun.spawnSync([process.execPath, '--eval', `
      import { ensureDefaultPermissions } from '${PERMISSIONS_CONFIG_MODULE}';
      ensureDefaultPermissions();
    `], {
      cwd: tempRoot,
      env: { ...process.env, ARCHSTUDIO_CONFIG_DIR: tempConfig },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // Log before asserting — expect() throws, so a diagnostic placed after it
    // would never run on the exact failure it exists to explain.
    if (run.exitCode !== 0) {
      console.error(run.stderr.toString());
    }
    expect(run.exitCode).toBe(0);

    const merged = JSON.parse(readFileSync(join(installedDir, 'default.json'), 'utf-8'));

    expect(merged.version).toBe('2026-03-01');

    const bashPatterns = merged.allowedBashPatterns.map((p: string | { pattern: string }) =>
      typeof p === 'string' ? p : p.pattern
    );

    expect(bashPatterns).toContain('^custom-review\\b');
    expect(bashPatterns).toContain('^bun\\s+run\\s+typecheck\\b$');
    expect(bashPatterns.filter((p: string) => p === '^rg\\b').length).toBe(1);

    const mcpPatterns = merged.allowedMcpPatterns as string[];
    expect(mcpPatterns).toContain('list');
    expect(mcpPatterns).toContain('search');

    const blockedCommandHints = merged.blockedCommandHints as Array<{ command: string; reason: string }>;
    expect(blockedCommandHints.some(h => h.command === 'printf')).toBe(true);
    expect(blockedCommandHints.some(h => h.command === 'sed')).toBe(true);

    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempConfig, { recursive: true, force: true });
  });
});
