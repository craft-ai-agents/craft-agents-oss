import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

// getMemoryConfig() reads the on-disk config.json, and CRAFT_CONFIG_DIR is
// captured at module load — so each scenario runs in a subprocess against a
// fresh temp config dir (same pattern as default-thinking-level.test.ts).
function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getMemoryConfig } from '${STORAGE_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

function setupConfigDir(memory?: unknown): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-memory-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        llmConnections: [],
        ...(memory !== undefined ? { memory } : {}),
      },
      null,
      2,
    ),
    'utf-8',
  )
  return configDir
}

describe('getMemoryConfig merge (P1 redactExtraPatterns / M1 ftsLimit)', () => {
  it('falls back to defaults when memory block is absent', () => {
    const out = runEval(setupConfigDir(), 'console.log(JSON.stringify(getMemoryConfig()))')
    const cfg = JSON.parse(out)
    expect(cfg.redactExtraPatterns).toEqual([])
    expect(cfg.ftsLimit).toBe(20)
  })

  it('merges redactExtraPatterns and ftsLimit from config.json', () => {
    const cfg = JSON.parse(
      runEval(
        setupConfigDir({ redactExtraPatterns: ['ACME Corp', '/srv/internal'], ftsLimit: 7 }),
        'console.log(JSON.stringify(getMemoryConfig()))',
      ),
    )
    expect(cfg.redactExtraPatterns).toEqual(['ACME Corp', '/srv/internal'])
    expect(cfg.ftsLimit).toBe(7)
  })

  it('filters non-string/empty patterns and rejects invalid ftsLimit', () => {
    const cfg = JSON.parse(
      runEval(
        setupConfigDir({ redactExtraPatterns: ['ACME Corp', 42, null, '  '], ftsLimit: -5 }),
        'console.log(JSON.stringify(getMemoryConfig()))',
      ),
    )
    expect(cfg.redactExtraPatterns).toEqual(['ACME Corp'])
    expect(cfg.ftsLimit).toBe(20)
  })

  it('non-array redactExtraPatterns falls back to the default', () => {
    const cfg = JSON.parse(
      runEval(setupConfigDir({ redactExtraPatterns: 'ACME Corp' }), 'console.log(JSON.stringify(getMemoryConfig()))'),
    )
    expect(cfg.redactExtraPatterns).toEqual([])
  })

  it('M2 semantic defaults to false and merges an explicit opt-in', () => {
    const off = JSON.parse(runEval(setupConfigDir(), 'console.log(JSON.stringify(getMemoryConfig()))'))
    expect(off.semantic).toBe(false)
    const on = JSON.parse(
      runEval(setupConfigDir({ semantic: true }), 'console.log(JSON.stringify(getMemoryConfig()))'),
    )
    expect(on.semantic).toBe(true)
    const falsy = JSON.parse(
      runEval(setupConfigDir({ semantic: 1 }), 'console.log(JSON.stringify(getMemoryConfig()))'),
    )
    expect(falsy.semantic).toBe(false) // non-boolean values fall back to the default
  })
})
