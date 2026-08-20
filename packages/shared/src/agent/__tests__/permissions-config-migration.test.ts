import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalCwd = process.cwd();
const originalConfigDir = process.env.CRAFT_CONFIG_DIR;

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir;
  try {
    const { setBundledAssetsRoot } = await import('../../utils/paths.ts');
    setBundledAssetsRoot(undefined);
  } catch {
    // ignore
  }
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
        allowedKnowledgePatterns: ['^knowledge:(search|get)$'],
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
        allowedKnowledgePatterns: ['^knowledge:custom-user-op$'],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        blockedCommandHints: [
          { command: 'sed', reason: 'sed print-only policy', whenNotMatching: '^sed\\s+-n\\b' },
        ],
      }, null, 2)
    );

    process.env.CRAFT_CONFIG_DIR = tempConfig;
    process.chdir(tempRoot);
    // Pin assets root to the fixture so a prior test's setBundledAssetsRoot(electron)
    // cannot shadow cwd-based resources/permissions resolution.
    const { setBundledAssetsRoot } = await import('../../utils/paths.ts');
    setBundledAssetsRoot(tempRoot);

    const mod = await import(`../permissions-config.ts?case=${Date.now()}`);
    mod.ensureDefaultPermissions();

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

    // Knowledge patterns merge the same way: user customizations preserved, new bundled ones added
    const knowledgePatterns = merged.allowedKnowledgePatterns as string[];
    expect(knowledgePatterns).toContain('^knowledge:custom-user-op$');
    expect(knowledgePatterns).toContain('^knowledge:(search|get)$');

    const blockedCommandHints = merged.blockedCommandHints as Array<{ command: string; reason: string }>;
    expect(blockedCommandHints.some(h => h.command === 'printf')).toBe(true);
    expect(blockedCommandHints.some(h => h.command === 'sed')).toBe(true);

    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempConfig, { recursive: true, force: true });
  });

  it('merges blockedTools additively: P3 knowledge-write capabilities land on existing installs', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'permissions-bundle-'));
    const tempConfig = mkdtempSync(join(tmpdir(), 'permissions-config-'));

    const bundledDir = join(tempRoot, 'resources', 'permissions');
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(
      join(bundledDir, 'default.json'),
      JSON.stringify({
        version: '2026-08-07-p3',
        allowedBashPatterns: [{ pattern: '^ls\\b', comment: 'List files' }],
        allowedKnowledgePatterns: ['^knowledge:(search|get)$'],
        blockedTools: [
          { pattern: 'knowledge.propose_update', comment: 'P3 write capability, blocked in Explore' },
          { pattern: 'knowledge.create_document', comment: 'P3 write capability, blocked in Explore' },
          { pattern: 'knowledge.append_block', comment: 'P3 write capability, blocked in Explore' },
          { pattern: 'knowledge.set_attribute', comment: 'P3 write capability, blocked in Explore' },
        ],
      }, null, 2)
    );

    const installedDir = join(tempConfig, 'permissions');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      join(installedDir, 'default.json'),
      JSON.stringify({
        // P1's same-day stamp: the bundled '-p3' suffix must still win the version compare
        version: '2026-08-07',
        allowedBashPatterns: [{ pattern: '^ls\\b', comment: 'List files' }],
        allowedKnowledgePatterns: ['^knowledge:(search|get)$'],
        blockedTools: [
          'knowledge.propose_update', // overlap with bundled (string form) — must dedupe
          { pattern: 'custom.agent-block', comment: 'User added block' },
        ],
      }, null, 2)
    );

    process.env.CRAFT_CONFIG_DIR = tempConfig;
    process.chdir(tempRoot);

    const mod = await import(`../permissions-config.ts?case=${Date.now()}`);
    mod.ensureDefaultPermissions();

    const merged = JSON.parse(readFileSync(join(installedDir, 'default.json'), 'utf-8'));
    expect(merged.version).toBe('2026-08-07-p3');

    const blockedTools = (merged.blockedTools as Array<string | { pattern: string }>).map((p) =>
      typeof p === 'string' ? p : p.pattern
    );
    // user customization preserved
    expect(blockedTools).toContain('custom.agent-block');
    // all four bundled P3 knowledge-write capabilities merged in
    for (const op of [
      'knowledge.propose_update',
      'knowledge.create_document',
      'knowledge.append_block',
      'knowledge.set_attribute',
    ]) {
      expect(blockedTools).toContain(op);
    }
    // overlapping entry deduped (appears exactly once, installed form wins)
    expect(blockedTools.filter((t) => t === 'knowledge.propose_update').length).toBe(1);

    // schema/normalize path keeps blockedTools as plain strings for Set-exact matching
    const parsed = mod.parsePermissionsJson(
      readFileSync(join(installedDir, 'default.json'), 'utf-8')
    );
    expect(parsed.blockedTools).toContain('knowledge.set_attribute');
    expect(parsed.blockedTools).toContain('custom.agent-block');

    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempConfig, { recursive: true, force: true });
  });

  it('runtime merged config unions JSON blockedTools with the hardcoded SAFE_MODE_CONFIG set', async () => {
    const tempConfig = mkdtempSync(join(tmpdir(), 'permissions-config-'));
    const tempWorkspace = mkdtempSync(join(tmpdir(), 'permissions-ws-'));

    const installedDir = join(tempConfig, 'permissions');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      join(installedDir, 'default.json'),
      JSON.stringify({
        version: '2026-08-07-p3',
        blockedTools: ['knowledge.set_attribute'],
      }, null, 2)
    );

    process.env.CRAFT_CONFIG_DIR = tempConfig;

    const mod = await import(`../permissions-config.ts?case=${Date.now()}`);
    const merged = mod.permissionsConfigCache.getMergedConfig({ workspaceRootPath: tempWorkspace });

    // hardcoded core write tools are always present (seeded from SAFE_MODE_CONFIG)...
    expect(merged.blockedTools.has('Write')).toBe(true);
    expect(merged.blockedTools.has('Edit')).toBe(true);
    // ...and the default.json knowledge-write capability is unioned in additively
    expect(merged.blockedTools.has('knowledge.set_attribute')).toBe(true);

    rmSync(tempConfig, { recursive: true, force: true });
    rmSync(tempWorkspace, { recursive: true, force: true });
  });
});
