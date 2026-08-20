/**
 * Deterministic acceptance checks for runtime-context PRD §13.2–13.3 (no live LLM):
 * - default thinking level persists via storage (Runtime settings path)
 * - rules.md edits appear in getContextDocsPromptBlock / getSystemPrompt
 * - OMP append-system-prompt composition includes context docs when seeded
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// __tests__ → context-docs → src → shared → packages → repo
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..')
const ELECTRON_ROOT = join(REPO_ROOT, 'apps', 'electron')
const DEFAULTS_SRC = join(ELECTRON_ROOT, 'resources', 'config-defaults.json')
const STORAGE_MODULE = pathToFileURL(join(import.meta.dir, '..', '..', 'config', 'storage.ts')).href

function runStorageEval(configDir: string, code: string): string {
  const run = Bun.spawnSync(
    [process.execPath, '--eval', `import { getDefaultThinkingLevel, setDefaultThinkingLevel } from '${STORAGE_MODULE}'; ${code}`],
    {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  if (run.exitCode !== 0) {
    throw new Error(`storage eval failed: ${run.stderr.toString()}`)
  }
  return run.stdout.toString().trim()
}

function setupConfigDir(): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-accept-'))
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      llmConnections: [],
    }),
  )
  copyFileSync(DEFAULTS_SRC, join(configDir, 'config-defaults.json'))
  return configDir
}

describe('PRD acceptance: thinking level (Runtime)', () => {
  it('setDefaultThinkingLevel persists and is read back without app restart', () => {
    const configDir = setupConfigDir()
    try {
      const before = runStorageEval(configDir, 'console.log(getDefaultThinkingLevel())')
      expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).toContain(before)
      const out = runStorageEval(
        configDir,
        "setDefaultThinkingLevel('high'); console.log(getDefaultThinkingLevel())",
      )
      expect(out).toBe('high')
      // fresh process = next session without app restart
      expect(runStorageEval(configDir, 'console.log(getDefaultThinkingLevel())')).toBe('high')
      const cfg = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as { defaultThinkingLevel?: string }
      expect(cfg.defaultThinkingLevel).toBe('high')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

describe('PRD acceptance: context docs in system prompt', () => {
  const originalConfigDir = process.env.CRAFT_CONFIG_DIR
  const originalCwd = process.cwd()
  let configDir = ''

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = originalConfigDir
    process.chdir(originalCwd)
    try {
      const { setBundledAssetsRoot } = await import('../../utils/paths.ts')
      setBundledAssetsRoot(undefined)
    } catch {
      // ignore
    }
    if (configDir && existsSync(configDir)) rmSync(configDir, { recursive: true, force: true })
  })

  it('rules.md UI edit is visible in getContextDocsPromptBlock (next session payload)', async () => {
    configDir = setupConfigDir()
    process.env.CRAFT_CONFIG_DIR = configDir
    process.chdir(ELECTRON_ROOT)

    const { setBundledAssetsRoot } = await import('../../utils/paths.ts')
    setBundledAssetsRoot(ELECTRON_ROOT)

    const { ensureContextDocs, writeContextDoc, getContextDocsPromptBlock } = await import('../index.ts')

    ensureContextDocs()
    const marker = `ACCEPTANCE_RULES_MARKER_${Date.now()}`
    writeContextDoc('rules.md', `<!-- context-doc-version: 1 -->\n${marker}\n`)

    const block = getContextDocsPromptBlock()
    expect(block).toContain('<context_documents>')
    expect(block).toContain('rules.md')
    expect(block).toContain(marker)

    // getSystemPrompt also injects the block (Claude/Pi path)
    // signature: (prefs?, debug?, workspaceRoot?, workingDirectory?, ...)
    const { getSystemPrompt } = await import('../../prompts/system.ts')
    const sys = getSystemPrompt(undefined, undefined, configDir, configDir)
    expect(sys).toContain(marker)
    expect(sys).toContain('context_document')
  })

  it('OMP append-system-prompt payload includes context docs (buildCraftContextPrompt path)', async () => {
    configDir = setupConfigDir()
    process.env.CRAFT_CONFIG_DIR = configDir
    process.chdir(ELECTRON_ROOT)

    const { setBundledAssetsRoot } = await import('../../utils/paths.ts')
    setBundledAssetsRoot(ELECTRON_ROOT)

    const { ensureContextDocs, writeContextDoc } = await import('../index.ts')
    ensureContextDocs()
    const marker = `OMP_APPEND_MARKER_${Date.now()}`
    writeContextDoc('rules.md', `<!-- context-doc-version: 1 -->\n${marker}\n`)

    const {
      composeOmpAppendSystemPrompt,
      getOmpSpawnSystemPromptArgs,
    } = await import('../../agent/omp-agent.ts')

    // Production compose path used by private buildCraftContextPrompt / spawn.
    const composed = composeOmpAppendSystemPrompt({ workingDirectory: configDir })
    expect(composed).toContain(marker)
    expect(composed).toContain('context_documents')
    expect(composed).toContain('soul.md')
    expect(composed).toContain('rules.md')

    // Spawn wires the composed prompt via --append-system-prompt (not source greps).
    const spawnArgs = getOmpSpawnSystemPromptArgs(composed)
    expect(spawnArgs).toEqual(['--append-system-prompt', composed])
    expect(spawnArgs[1]).toContain(marker)
  })
})
