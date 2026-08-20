/**
 * Handler-level test for toolchain RPC surface.
 *
 * Runs in a spawned subprocess with an isolated CRAFT_CONFIG_DIR. The shared
 * bun test process may already have loaded packages/shared/config/paths.ts
 * against a different config dir (preload / sibling suites), so in-process
 * CRAFT_CONFIG_DIR assignment does NOT isolate getToolchain() singletons.
 *
 * SET_DISABLED persistence is covered in
 * __tests__/runtime-context-handlers.subprocess.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..')

function runSub(script: string): { exitCode: number; stdout: string; stderr: string; configDir: string } {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-toolchain-test-'))
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

const SETUP = [
  'const handlers = new Map();',
  'const pushes = [];',
  'const fakeServer = {',
  '  handle: (ch, fn) => handlers.set(ch, fn),',
  '  push: (ch, _target, payload) => pushes.push({ channel: ch, payload }),',
  '};',
  "const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');",
  'const { registerToolchainHandlers, HANDLED_CHANNELS } = await import(',
  "  process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/toolchain.ts'",
  ');',
  'registerToolchainHandlers(fakeServer, {});',
  'const invoke = async (channel, ...args) => {',
  '  const handler = handlers.get(channel);',
  "  if (!handler) throw new Error('no handler for ' + channel);",
  '  return handler({}, ...args);',
  '};',
  'const VALID_PHASES = {',
  '  missing: true,',
  '  downloading: true,',
  '  installing: true,',
  '  ready: true,',
  '  outdated: true,',
  '  error: true,',
  '  offline: true,',
  '};',
].join('\n')

describe('toolchain rpc handlers (subprocess)', () => {
  test('STATUS returns a snapshot of manifest tools with valid phases', () => {
    const script = [
      SETUP,
      'const statuses = await invoke(RPC_CHANNELS.toolchain.STATUS);',
      "if (!Array.isArray(statuses)) throw new Error('STATUS not array: ' + typeof statuses);",
      'for (const s of statuses) {',
      "  if (!VALID_PHASES[s.phase]) throw new Error('invalid phase: ' + s.phase + ' for ' + s.name);",
      "  if (s.phase !== 'missing' && s.phase !== 'ready') {",
      "    throw new Error('fresh config expected missing|ready, got ' + s.phase + ' for ' + s.name);",
      '  }',
      '}',
      'console.log(JSON.stringify({ ok: true, count: statuses.length }));',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      if (r.exitCode !== 0) {
        throw new Error(
          'STATUS failed\nSTDERR:\n' + r.stderr.slice(0, 3000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000),
        )
      }
      expect(r.stdout).toContain('"ok":true')
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })

  test('registers every channel from HANDLED_CHANNELS', () => {
    const script = [
      SETUP,
      'for (const ch of HANDLED_CHANNELS) {',
      "  if (!handlers.has(ch)) throw new Error('missing handler for ' + ch);",
      '}',
      'console.log(JSON.stringify({ ok: true, channels: [...HANDLED_CHANNELS] }));',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      if (r.exitCode !== 0) {
        throw new Error('HANDLED_CHANNELS failed\nSTDERR:\n' + r.stderr.slice(0, 3000))
      }
      expect(r.stdout).toContain('"ok":true')
      expect(r.stdout).toContain('toolchain:setDisabled')
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })

  test('UPDATE on a platform-absent tool never starts a download', () => {
    if (process.platform === 'win32') return
    const script = [
      SETUP,
      '// git ships only for win32-x64; on mac/linux update() must no-op/reject.',
      'let result;',
      'try {',
      "  result = await invoke(RPC_CHANNELS.toolchain.UPDATE, 'git');",
      '} catch (e) {',
      "  result = { name: 'git', phase: 'error', error: String(e?.message ?? e) };",
      '}',
      "if (!result) throw new Error('no result');",
      "if (result.phase === 'downloading' || result.phase === 'installing') {",
      "  throw new Error('UPDATE started a download: ' + JSON.stringify(result));",
      '}',
      'console.log(JSON.stringify({ ok: true, phase: result.phase }));',
      'process.exit(0);',
    ].join('\n')

    const r = runSub(script)
    try {
      if (r.exitCode !== 0) {
        throw new Error(
          'UPDATE failed\nSTDERR:\n' + r.stderr.slice(0, 3000) + '\nSTDOUT:\n' + r.stdout.slice(0, 2000),
        )
      }
      expect(r.stdout).toContain('"ok":true')
    } finally {
      rmSync(r.configDir, { recursive: true, force: true })
    }
  })
})
