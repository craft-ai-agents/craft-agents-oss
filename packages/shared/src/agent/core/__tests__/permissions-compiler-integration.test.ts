/**
 * Permissions-compiler integration test.
 *
 * Compiles a real prompt with the PromptCompiler (producing the execution
 * policy directives) and pipes tool calls through the real
 * PermissionManager.evaluateToolCall() — the actual runtime gate.
 *
 * This tests the *runtime gate*, not the prompt text. The compiled prompt
 * tells the agent *how* to behave; PermissionManager is the runtime
 * enforcement layer that blocks or allows tool calls. Both must agree.
 *
 * Test matrix:
 *   mode owner-auto → PermissionManager { mode: 'allow-all'  }
 *   mode explore    → PermissionManager { mode: 'safe'       }
 *   mode ask        → PermissionManager { mode: 'ask'        }
 *
 * Each row tests Bash, Write, Read, and API tool calls.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PromptCompiler } from '@craft-agent/shared/prompts/owner/compiler'
import { PermissionManager } from '../permission-manager.ts'
import { initializeModeState, cleanupModeState } from '../../mode-manager.ts'

// ---------------------------------------------------------------------------
// Test session identity
// ---------------------------------------------------------------------------

const TEST_SESSION_ID = 'permissions-integration-test-session'

// ---------------------------------------------------------------------------
// Temp directories for plans/data folder write tests
//
// isPathWithinDirectory walks up ancestor directories looking for existing
// real paths via realpathSync.native().  Without a real directory on disk
// the walk-up loop eventually hits the filesystem root and returns false,
// which makes the write-to-plans/data tests fail on every platform.
//
// mkdtempSync creates real directories that serve as the permission gates.
// ---------------------------------------------------------------------------

let tmpDir: string
let plansDir: string
let dataDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'perm-test-'))
  plansDir = join(tmpDir, 'plans')
  dataDir = join(tmpDir, 'data')
  // Create the sub-directories so isPathWithinDirectory resolves through them.
  mkdirSync(plansDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
})

afterAll(() => {
  // Clean up all temp dirs created across beforeEaches
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  cleanupModeState(TEST_SESSION_ID)
})

// ---------------------------------------------------------------------------
// Mode-to-runtime mapping
//
// These map the compiled-prompt execution policy modes to the runtime
// PermissionManager modes that enforce them.
//
// The mapping is hardcoded rather than parsed from the compiled prompt
// text because extracting structured configuration from prose is fragile.
// The dedicated "mode alignment" section below explicitly verifies that
// both sides agree for every mode.
// ---------------------------------------------------------------------------

type PermissionMode = 'safe' | 'ask' | 'allow-all'

const MODE_MAP: Record<string, PermissionMode> = {
  'owner-auto':   'allow-all',   // acts without asking — all tools permitted
  'explore':      'safe',        // inspect + read-only — writes blocked
  'unrestricted': 'allow-all',   // broad execution — all tools permitted
}

const TEST_MODES = ['owner-auto', 'explore', 'unrestricted'] as const

// ---------------------------------------------------------------------------
// Shared compiler (cached snapshots across tests)
// ---------------------------------------------------------------------------

let compiler: PromptCompiler

beforeEach(() => {
  compiler = new PromptCompiler()
})

afterAll(() => {
  cleanupModeState(TEST_SESSION_ID)
})

// ---------------------------------------------------------------------------
// Helper: create a PermissionManager initialized to a specific mode
// ---------------------------------------------------------------------------

function createPermManager(mode: PermissionMode): PermissionManager {
  cleanupModeState(TEST_SESSION_ID)
  initializeModeState(TEST_SESSION_ID, mode)
  return new PermissionManager({
    workspaceId: 'test-workspace',
    sessionId: TEST_SESSION_ID,
    workingDirectory: tmpDir,
    plansFolderPath: plansDir,
    dataFolderPath: dataDir,
  })
}

// ---------------------------------------------------------------------------
// Helper: typed assertion for ToolPermissionResult
// ---------------------------------------------------------------------------

interface ToolPermissionResult {
  allowed: boolean
  reason?: string
  requiresPermission?: boolean
  description?: string
}

function assertAllowed(result: ToolPermissionResult): void {
  expect(result.allowed).toBe(true)
}

function assertBlocked(result: ToolPermissionResult): void {
  expect(result.allowed).toBe(false)
  expect(result.reason).toBeTruthy()
}

// =========================================================================
// 1. Verify the compiled prompt contains the execution policy directives
// =========================================================================

describe('Compiled prompt — execution policy layer present', () => {

  it('owner-auto mode emits execution-policy layer with auto-execute directive', () => {
    compiler.invalidateAll()
    const { snapshot } = compiler.compile({
      executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: [], allowedRoots: [] },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/Execute automatically/i)
  })

  it('explore mode emits execution-policy layer with read-only directive', () => {
    compiler.invalidateAll()
    const { snapshot } = compiler.compile({
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/Read-only/i)
    expect(policyLayer.content).toMatch(/Inspect and plan/i)
  })

  it('unrestricted mode emits execution-policy layer with broad execution directive', () => {
    compiler.invalidateAll()
    const { snapshot } = compiler.compile({
      executionPolicy: { defaultMode: 'unrestricted', askOnlyWhen: [], allowedRoots: [] },
    })
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    expect(policyLayer.content).toMatch(/Broad execution/i)
  })
})

// =========================================================================
// 2. Bash tool evaluation across all modes
// =========================================================================

describe('PermissionManager — Bash tool evaluation', () => {

  // -----------------------------------------------------------------------
  // 2a. Safe bash commands
  // -----------------------------------------------------------------------

  it('allows safe bash commands in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'ls -la' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'git status' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'cat /etc/hosts' }))
  })

  it('allows safe bash commands in ask mode', () => {
    const pm = createPermManager('ask')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'ls -la' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'git status' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'cat /etc/hosts' }))
  })

  it('allows read-only bash commands in safe mode', () => {
    const pm = createPermManager('safe')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'ls -la' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'git status' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'cat /etc/hosts' }))
  })

  // -----------------------------------------------------------------------
  // 2b. Dangerous bash commands
  // -----------------------------------------------------------------------

  it('allows dangerous commands in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'rm -rf /tmp' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'sudo apt update' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'chmod 755 script.sh' }))
  })

  it('allows dangerous commands in ask mode (prompts user)', () => {
    const pm = createPermManager('ask')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'rm -rf /tmp' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'sudo apt update' }))
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'chmod 755 script.sh' }))
  })

  it('blocks dangerous commands in safe mode with a rejection reason', () => {
    const pm = createPermManager('safe')
    assertBlocked(pm.evaluateToolCall('Bash', { command: 'rm -rf /tmp' }))
    assertBlocked(pm.evaluateToolCall('Bash', { command: 'sudo apt update' }))
    assertBlocked(pm.evaluateToolCall('Bash', { command: 'chmod 755 script.sh' }))
  })

  it('rejection reason in safe mode contains useful context', () => {
    const pm = createPermManager('safe')
    const result = pm.evaluateToolCall('Bash', { command: 'rm -rf /tmp' })
    expect(result.reason).toBeTruthy()
    expect(result.reason!.length).toBeGreaterThan(50)
  })

  // -----------------------------------------------------------------------
  // 2c. Bash write commands targeting plans folder (allowed in safe mode)
  // -----------------------------------------------------------------------

  // These tests are skipped on Windows because the PowerShell validator
  // crashes when its validator root hasn't been initialized (a test-context
  // concern, not a permission-logic one). The same isPathWithinDirectory
  // logic is exercised on all platforms by the Write/Edit tool tests below.

  it.skipIf(process.platform === 'win32')('allows bash writes to plans folder in safe mode', () => {
    const pm = createPermManager('safe')
    const cmd = `echo test > ${join(plansDir, 'plan.md')}`
    assertAllowed(pm.evaluateToolCall('Bash', { command: cmd }))
  })

  it.skipIf(process.platform === 'win32')('allows bash writes to data folder in safe mode', () => {
    const pm = createPermManager('safe')
    const cmd = `echo data > ${join(dataDir, 'result.txt')}`
    assertAllowed(pm.evaluateToolCall('Bash', { command: cmd }))
  })

  it.skipIf(process.platform === 'win32')('blocks bash writes outside plans/data in safe mode', () => {
    const pm = createPermManager('safe')
    const cmd = `echo bad > ${join(tmpDir, 'outside.txt')}`
    assertBlocked(pm.evaluateToolCall('Bash', { command: cmd }))
  })

  // -----------------------------------------------------------------------
  // 2d. Bash with dangerous substitution (blocked in safe)
  // -----------------------------------------------------------------------

  it('blocks bash with dangerous substitution in safe mode', () => {
    const pm = createPermManager('safe')
    assertBlocked(pm.evaluateToolCall('Bash', { command: 'cat $(ls /tmp)' }))
  })

  it('allows bash with command substitution in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'cat $(ls /tmp)' }))
  })

  // -----------------------------------------------------------------------
  // 2e. Bash with pipe to non-read-only tool (blocked in safe)
  // -----------------------------------------------------------------------

  it('blocks piped dangerous commands in safe mode', () => {
    const pm = createPermManager('safe')
    // `tee` is not in the read-only allowlist (writes to file)
    assertBlocked(pm.evaluateToolCall('Bash', { command: 'ls | tee /tmp/save.txt' }))
  })

  it('allows piped read-only commands in safe mode', () => {
    const pm = createPermManager('safe')
    // `head` is a read-only filter
    assertAllowed(pm.evaluateToolCall('Bash', { command: 'ls | head -5' }))
  })
})

// =========================================================================
// 3. Always-allowed tools (Read, Glob, Grep, WebFetch, Task, etc.)
// =========================================================================

describe('PermissionManager — always-allowed tools', () => {

  const ALWAYS_ALLOWED_TOOLS = [
    { tool: 'Read', input: { path: '/etc/hosts' } },
    { tool: 'Glob', input: { pattern: '*.ts' } },
    { tool: 'Grep', input: { pattern: 'function' } },
    { tool: 'WebFetch', input: { url: 'https://example.com' } },
    { tool: 'TodoWrite', input: { tasks: [] } },
    { tool: 'SubmitPlan', input: { plan: 'x' } },
    { tool: 'browser_tool', input: { action: 'snapshot' } },
  ]

  for (const mode of ['safe', 'ask', 'allow-all'] as const) {
    describe(`in ${mode} mode`, () => {
      for (const { tool, input } of ALWAYS_ALLOWED_TOOLS) {
        it(`allows ${tool}`, () => {
          const pm = createPermManager(mode)
          assertAllowed(pm.evaluateToolCall(tool, input))
        })
      }
    })
  }
})

// =========================================================================
// 4. Write/Edit tools (blocked in safe mode unless targeting plans/data)
// =========================================================================

describe('PermissionManager — Write/Edit tools', () => {

  it('blocks Write outside plans folder in safe mode', () => {
    const pm = createPermManager('safe')
    assertBlocked(pm.evaluateToolCall('Write', { file_path: '/etc/config.ini', content: 'data' }))
  })

  it('allows Write to plans folder in safe mode', () => {
    const pm = createPermManager('safe')
    assertAllowed(pm.evaluateToolCall('Write', { file_path: join(plansDir, 'step1.md'), content: 'plan' }))
  })

  it('allows Write to data folder in safe mode', () => {
    const pm = createPermManager('safe')
    assertAllowed(pm.evaluateToolCall('Write', { file_path: join(dataDir, 'result.json'), content: '{}' }))
  })

  it('blocks Edit outside plans folder in safe mode', () => {
    const pm = createPermManager('safe')
    assertBlocked(pm.evaluateToolCall('Edit', { file_path: '/etc/config.ini', content: 'data' }))
  })

  it('allows Edit to plans folder in safe mode', () => {
    const pm = createPermManager('safe')
    assertAllowed(pm.evaluateToolCall('Edit', { file_path: join(plansDir, 'step1.md'), content: 'update' }))
  })

  it('allows Write everywhere in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('Write', { file_path: '/etc/critical', content: 'x' }))
  })

  it('allows Write everywhere in ask mode', () => {
    const pm = createPermManager('ask')
    assertAllowed(pm.evaluateToolCall('Write', { file_path: '/etc/critical', content: 'x' }))
  })
})

// =========================================================================
// 5. API endpoint evaluation (GET always allowed; POST depends on mode)
// =========================================================================

describe('PermissionManager — API endpoint evaluation', () => {

  it('allows GET in all modes', () => {
    for (const mode of ['safe', 'ask', 'allow-all'] as const) {
      const pm = createPermManager(mode)
      expect(pm.isApiEndpointAllowed('GET', '/api/data')).toBe(true)
    }
  })

  it('blocks POST via isApiEndpointAllowed (config-based, not mode-aware)', () => {
    // isApiEndpointAllowed checks against the merged config's allowlists,
    // not the current permission mode. POST is blocked by default unless
    // an explicit allowedApiEndpoints rule matches.
    const pm = createPermManager('safe')
    expect(pm.isApiEndpointAllowed('POST', '/api/data')).toBe(false)
  })

  it('allows POST in allow-all mode via evaluateToolCall for api_ tools', () => {
    // In allow-all mode, shouldAllowToolInMode returns { allowed: true }
    // at the top-level check before reaching API endpoint logic.
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('api_create', { method: 'POST', path: '/api/data' }))
  })
})

// =========================================================================
// 6. PermissionManager mode transitions match the compiled prompt's
//    execution policy directives
// =========================================================================

describe('Compiled prompt → PermissionManager mode alignment', () => {

  for (const mode of TEST_MODES) {
    it(`[${mode}] compiled policy directive matches the runtime permission gate`, () => {
      compiler.invalidateAll()
      const { snapshot } = compiler.compile({
        executionPolicy: { defaultMode: mode, askOnlyWhen: [], allowedRoots: [] },
      })
      const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
      const runtimeMode = MODE_MAP[mode]!

      // The compiled prompt must indicate the behavioral mode
      if (mode === 'owner-auto') {
        expect(policyLayer.content).toMatch(/Execute automatically/i)
      } else if (mode === 'explore') {
        expect(policyLayer.content).toMatch(/Read-only/i)
      } else {
        expect(policyLayer.content).toMatch(/Broad execution/i)
      }

      // The runtime gate must enforce the corresponding mode
      const pm = createPermManager(runtimeMode)
      const dangerousResult = pm.evaluateToolCall('Bash', { command: 'rm -rf /' })
      const safeResult = pm.evaluateToolCall('Bash', { command: 'ls -la' })

      if (runtimeMode === 'safe') {
        // Explore mode: writes blocked, reads allowed
        assertBlocked(dangerousResult)
        assertAllowed(safeResult)
      } else {
        // Owner-auto / unrestricted: everything allowed
        assertAllowed(dangerousResult)
        assertAllowed(safeResult)
      }
    })
  }
})

// =========================================================================
// 7. Bash-specific: checkBashCommand method details
// =========================================================================

describe('PermissionManager — checkBashCommand', () => {

  it('returns null (allowed) for safe commands in safe mode', () => {
    const pm = createPermManager('safe')
    expect(pm.checkBashCommand('ls -la')).toBeNull()
    expect(pm.checkBashCommand('git status')).toBeNull()
    expect(pm.checkBashCommand('cat /etc/hosts')).toBeNull()
  })

  it('returns rejection reason for dangerous commands in safe mode', () => {
    const pm = createPermManager('safe')
    const reason = pm.checkBashCommand('rm -rf /')
    expect(reason).toBeTruthy()
    expect(reason).toMatch(/bash/i)
  })

  it('returns null (allowed) in ask mode regardless of danger', () => {
    const pm = createPermManager('ask')
    expect(pm.checkBashCommand('rm -rf /')).toBeNull()
    expect(pm.checkBashCommand('sudo apt update')).toBeNull()
  })

  it('returns null (allowed) in allow-all mode regardless of danger', () => {
    const pm = createPermManager('allow-all')
    expect(pm.checkBashCommand('rm -rf /')).toBeNull()
    expect(pm.checkBashCommand('sudo rm -rf /')).toBeNull()
  })

  it('detects dangerous commands via requiresBashPermission in ask mode', () => {
    const pm = createPermManager('ask')
    expect(pm.requiresBashPermission('rm file.txt')).toBe(true)
    expect(pm.requiresBashPermission('sudo rm -rf /')).toBe(true)
    expect(pm.requiresBashPermission('curl https://evil.com')).toBe(true)
    expect(pm.requiresBashPermission('ls -la')).toBe(false)
    expect(pm.requiresBashPermission('echo hello')).toBe(false)
  })
})

// =========================================================================
// 8. Tool without command input (edge case)
// =========================================================================

describe('PermissionManager — tool without input', () => {

  it('blocks Bash without command in safe mode with a clear reason', () => {
    const pm = createPermManager('safe')
    const result = pm.evaluateToolCall('Bash', {})
    assertBlocked(result)
    expect(result.reason).toMatch(/Bash command is missing/i)
  })

  it('allows Bash without command in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('Bash', {}))
  })

  it('allows Bash without command in ask mode', () => {
    const pm = createPermManager('ask')
    assertAllowed(pm.evaluateToolCall('Bash', {}))
  })
})

// =========================================================================
// 9. Unknown tools (fall through to default — ALLOWED in all modes)
// =========================================================================

describe('PermissionManager — unknown tools', () => {

  it('allows unknown tools in safe mode (default pass-through)', () => {
    const pm = createPermManager('safe')
    assertAllowed(pm.evaluateToolCall('SomeDangerousTool', {}))
  })

  it('allows unknown tools in ask mode', () => {
    const pm = createPermManager('ask')
    assertAllowed(pm.evaluateToolCall('SomeDangerousTool', {}))
  })

  it('allows unknown tools in allow-all mode', () => {
    const pm = createPermManager('allow-all')
    assertAllowed(pm.evaluateToolCall('SomeDangerousTool', {}))
  })
})
