/**
 * Subprocess isolation for runtime-context RPC handlers (toolchain /
 * contextDocs / marketplace).
 *
 * packages/shared/config/paths.ts freezes CRAFT_CONFIG_DIR at module load.
 * Under the shared bun test process that module may already be loaded against
 * the real ~/.craft-agent (or another suite's temp dir), so SET_DISABLED /
 * WRITE / CATALOG must run in a fresh child where env is set before import.
 *
 * Pattern matches cloud-runs.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const ELECTRON_ROOT = join(REPO_ROOT, 'apps', 'electron')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  configDir: string
}

function runSub(script: string, env: Record<string, string> = {}): RunResult {
  const configDir = mkdtempSync(join(tmpdir(), 'rpc-sub-'))
  // Seed a minimal StoredConfig so setToolchainDisabled / saveConfig can persist.
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
    }),
  )
  const result = Bun.spawnSync([process.execPath, '-e', script], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
      CRAFT_TEST_ROOT: REPO_ROOT,
      CRAFT_ELECTRON_ROOT: ELECTRON_ROOT,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    configDir,
  }
}

function assertOk(r: RunResult, label: string): void {
  if (r.exitCode !== 0) {
    throw new Error(
      label +
        ' failed (exit=' +
        r.exitCode +
        ')\nSTDERR:\n' +
        r.stderr.slice(0, 4000) +
        '\nSTDOUT:\n' +
        r.stdout.slice(0, 4000),
    )
  }
}

const FAKE_SERVER_SETUP = [
  'const handlers = new Map();',
  'const pushes = [];',
  'const fakeServer = {',
  '  handle: (ch, fn) => handlers.set(ch, fn),',
  '  push: (ch, _target, payload) => pushes.push({ channel: ch, payload }),',
  '};',
  'const invoke = async (channel, ...args) => {',
  '  const handler = handlers.get(channel);',
  "  if (!handler) throw new Error('no handler for ' + channel);",
  '  return handler({}, ...args);',
  '};',
].join('\n')

describe('runtime-context rpc handlers (subprocess)', () => {
  test('toolchain SET_DISABLED persists fzf via real storage', () => {
    const script = [
      FAKE_SERVER_SETUP,
      "const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');",
      'const { registerToolchainHandlers } = await import(',
      "  process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/toolchain.ts'",
      ');',
      'registerToolchainHandlers(fakeServer, {});',
      '',
      "const applied = await invoke(RPC_CHANNELS.toolchain.SET_DISABLED, ['fzf']);",
      "if (!Array.isArray(applied) || !applied.includes('fzf')) {",
      "  throw new Error('SET_DISABLED did not return fzf: ' + JSON.stringify(applied));",
      '}',
      '',
      'const disabled = await invoke(RPC_CHANNELS.toolchain.GET_DISABLED);',
      "if (!Array.isArray(disabled) || !disabled.includes('fzf')) {",
      "  throw new Error('GET_DISABLED missing fzf: ' + JSON.stringify(disabled));",
      '}',
      '',
      "const { getToolchainDisabled } = await import('@craft-agent/shared/config');",
      'const stored = getToolchainDisabled();',
      "if (!stored.includes('fzf')) {",
      "  throw new Error('getToolchainDisabled missing fzf: ' + JSON.stringify(stored));",
      '}',
      '',
      "const cfgPath = process.env.CRAFT_CONFIG_DIR + '/config.json';",
      'const raw = await Bun.file(cfgPath).text();',
      "if (!raw.includes('fzf')) {",
      "  throw new Error('config.json does not contain fzf: ' + raw.slice(0, 500));",
      '}',
      '',
      'console.log(JSON.stringify({ ok: true, disabled: stored }));',
      '// Background ensureAll from SET_DISABLED keeps the event loop alive — exit hard.',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      assertOk(r, 'toolchain SET_DISABLED')
      expect(r.stdout).toContain('"ok":true')
      const cfg = readFileSync(join(r.configDir, 'config.json'), 'utf8')
      expect(cfg).toContain('fzf')
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })

  test('contextDocs WRITE → LIST/READ sees marker and pushes CHANGED', () => {
    const marker = 'rpc-sub-marker-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    const script = [
      FAKE_SERVER_SETUP,
      "const { setBundledAssetsRoot } = await import('@craft-agent/shared/utils');",
      'setBundledAssetsRoot(process.env.CRAFT_ELECTRON_ROOT);',
      '',
      "const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');",
      'const { registerContextDocsHandlers } = await import(',
      "  process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/context-docs.ts'",
      ');',
      'registerContextDocsHandlers(fakeServer, {});',
      '',
      'const marker = ' + JSON.stringify(marker) + ';',
      "const written = await invoke(RPC_CHANNELS.contextDocs.WRITE, 'rules.md', marker + '\\n');",
      "if (!written || written.filename !== 'rules.md') {",
      "  throw new Error('WRITE returned unexpected: ' + JSON.stringify(written));",
      '}',
      '',
      'const list = await invoke(RPC_CHANNELS.contextDocs.LIST);',
      'const listed = Array.isArray(list) ? list : [];',
      "if (!listed.some((d) => d.filename === 'rules.md')) {",
      "  throw new Error('LIST missing rules.md: ' + JSON.stringify(list));",
      '}',
      '',
      "const read = await invoke(RPC_CHANNELS.contextDocs.READ, 'rules.md');",
      "const body = typeof read === 'string' ? read : read?.content;",
      "if (typeof body !== 'string' || !body.includes(marker)) {",
      "  throw new Error('READ missing marker: ' + JSON.stringify(read).slice(0, 400));",
      '}',
      '',
      'const changed = pushes.filter((p) => p.channel === RPC_CHANNELS.contextDocs.CHANGED);',
      'if (changed.length < 1) {',
      "  throw new Error('expected contextDocs CHANGED push, got: ' + JSON.stringify(pushes));",
      '}',
      '',
      'console.log(JSON.stringify({ ok: true, pushes: changed.length, marker }));',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      assertOk(r, 'contextDocs WRITE')
      expect(r.stdout).toContain('"ok":true')
      expect(r.stdout).toContain(marker)
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })

  test('marketplace CATALOG returns bundled entries', () => {
    const bundledCatalog = join(ELECTRON_ROOT, 'resources', 'marketplace', 'catalog.json')
    expect(existsSync(bundledCatalog)).toBe(true)

    const script = [
      FAKE_SERVER_SETUP,
      "const { setBundledAssetsRoot } = await import('@craft-agent/shared/utils');",
      'setBundledAssetsRoot(process.env.CRAFT_ELECTRON_ROOT);',
      '',
      '// Force the degradation ladder onto the bundled catalog: unreachable remote',
      '// makes the https fetch fail closed without depending on network.',
      "process.env.CRAFT_MARKETPLACE_CATALOG_URL = 'https://127.0.0.1:1/catalog-unreachable.json';",
      '',
      "const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');",
      'const { registerMarketplaceHandlers, HANDLED_CHANNELS } = await import(',
      "  process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/marketplace.ts'",
      ');',
      '',
      'registerMarketplaceHandlers(fakeServer, {});',
      '',
      'for (const ch of HANDLED_CHANNELS) {',
      "  if (!handlers.has(ch)) throw new Error('missing handler registration for ' + ch);",
      '}',
      '',
      'const view = await invoke(RPC_CHANNELS.marketplace.CATALOG);',
      'const entries = view?.catalog?.entries ?? view?.entries;',
      'if (!Array.isArray(entries) || entries.length === 0) {',
      "  throw new Error('CATALOG entries empty: ' + JSON.stringify(view).slice(0, 600));",
      '}',
      '// With unreachable remote + no cache we must land on bundled.',
      "if (view.origin !== 'bundled') {",
      "  throw new Error('expected bundled origin, got ' + view.origin + ' err=' + (view.error ?? ''));",
      '}',
      '',
      'console.log(JSON.stringify({ ok: true, count: entries.length, origin: view.origin, sample: entries[0]?.id }));',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      assertOk(r, 'marketplace CATALOG')
      expect(r.stdout).toContain('"ok":true')
      expect(r.stdout).toContain('"origin":"bundled"')
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })
})
