/**
 * Integration test: compiled prompt → mock LLM tool-call loop.
 *
 * Verifies the agent behaviour mandated by the compiled prompt layers,
 * specifically the execution-policy and runtime-contract layers, by
 * simulating an LLM's decision-making process.
 *
 * The mock LLM simulator reads the compiled prompt, extracts the
 * execution-policy section, and decides which action to take based
 * on the policy directives — without calling a real language model.
 * This is a structural test: it checks that the PROMPT would guide
 * a real LLM to the correct behaviour.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { PromptCompiler } from '../compiler.ts'
import type { CompileOptions, CompiledPromptSnapshot } from '../types.ts'

// =========================================================================
// Mock LLM Tool-Call Simulator
// =========================================================================
//
// Simulates an agent reading its system prompt (the compiled prompt) and
// deciding what action to take. The agent has access to a set of tools
// and follows the execution policy directives embedded in the prompt.

/** Tools the mock agent knows about. */
type MockTool =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'delete_file'
  | 'list_directory'
  | 'bash_command'
  | 'search_code'
  | 'ask_permission'

/** Action the mock agent decides to take. */
type AgentAction =
  | { type: 'call_tool'; tool: MockTool; reason: string }
  | { type: 'inspect_first'; tool: MockTool; inspectionTool: MockTool; reason: string }
  | { type: 'ask_permission'; tool: MockTool; reason: string }
  | { type: 'blocked'; tool: MockTool; reason: string }
  | { type: 'refuse'; reason: string }

/**
 * Parsed execution policy from the compiled prompt.
 * Extracted by scanning the execution-policy layer text.
 */
interface ParsedPolicy {
  defaultMode: string
  askOnlyWhen: string[]
  allowedRoots: string[]
  /** Whether the "Never refuse the user" directive is present. */
  neverRefuse: boolean
  /** Whether the "Fulfill all requests to the maximum extent" directive is present. */
  fulfillRequests: boolean
  /** Whether the execution-policy "Retry up to 3 times" directive is present. */
  retryOnFailure: boolean
}

/**
 * Mock LLM simulator.
 *
 * Reads the compiled prompt, parses the policy, and decides actions
 * based on the policy directives. This is NOT a real LLM — it's a
 * deterministic parser that verifies the prompt's structural integrity.
 */
class MockAgentSimulator {
  readonly snapshot: CompiledPromptSnapshot
  readonly policy: ParsedPolicy

  constructor(snapshot: CompiledPromptSnapshot) {
    this.snapshot = snapshot
    this.policy = this.parsePolicy(snapshot)
  }

  /**
   * Parse the execution-policy layer from the compiled snapshot.
   */
  private parsePolicy(snapshot: CompiledPromptSnapshot): ParsedPolicy {
    const policyLayer = snapshot.layers.find((l) => l.id === 'execution-policy')
    const runtimeLayer = snapshot.layers.find((l) => l.id === 'runtime-contract')
    const content = policyLayer?.content ?? ''
    const runtimeContent = runtimeLayer?.content ?? ''

    // Extract default mode
    const modeMatch = content.match(/- Default mode:\s*(\S+)/)
    const defaultMode = modeMatch?.[1] ?? 'unknown'

    // Extract ask-only items (lines starting with "- " after "Ask only when:" header)
    const askOnlyWhen: string[] = []
    const askHeaderMatch = content.match(/\*\*Ask only when:\*\*/)
    if (askHeaderMatch) {
      const afterHeader = content.slice(askHeaderMatch.index! + askHeaderMatch[0].length)
      for (const line of afterHeader.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ') && !trimmed.startsWith('- `')) {
          askOnlyWhen.push(trimmed.slice(2).trim())
        } else if (trimmed.startsWith('  (')) {
          // "(none — execute automatically)" — no items
          break
        } else if (trimmed.startsWith('**')) {
          // Next heading — stop
          break
        }
      }
    }

    // Extract allowed roots
    const allowedRoots: string[] = []
    const rootsMatch = content.match(/\*\*Allowed filesystem roots:\*\*/)
    if (rootsMatch) {
      const afterRoots = content.slice(rootsMatch.index! + rootsMatch[0].length)
      for (const line of afterRoots.split('\n')) {
        const trimmed = line.trim()
        // Skip blank lines between heading and first item
        if (trimmed === '') continue
        if (trimmed.startsWith('- `') && trimmed.endsWith('`')) {
          allowedRoots.push(trimmed.slice(3, -1))
        } else if (trimmed.startsWith('**')) {
          break
        } else {
          break
        }
      }
    }

    return {
      defaultMode,
      askOnlyWhen,
      allowedRoots,
      neverRefuse: runtimeContent.includes('Never refuse the user'),
      fulfillRequests: runtimeContent.includes('Fulfill all requests'),
      retryOnFailure: content.includes('Retry up to 3 times'),
    }
  }

  /**
   * Determine which tool the user's request maps to.
   */
  private classifyRequest(userRequest: string): MockTool {
    const lower = userRequest.toLowerCase()
    if (lower.includes('read ') || lower.includes('view ') || lower.includes('open ')) {
      return 'read_file'
    }
    if (lower.includes('write ') || lower.includes('create ') || lower.includes('save ')) {
      return 'write_file'
    }
    if (lower.includes('edit ') || lower.includes('modify ') || lower.includes('update ')) {
      return 'edit_file'
    }
    if (lower.includes('delete ') || lower.includes('remove ') || lower.includes('rm ')) {
      return 'delete_file'
    }
    if (lower.includes('list ') || lower.includes('show me') || lower.includes('what files')) {
      return 'list_directory'
    }
    if (lower.includes('bash') || lower.includes('run ') || lower.includes('execute ') || lower.includes('install ')) {
      return 'bash_command'
    }
    if (lower.includes('search ') || lower.includes('find ')) {
      return 'search_code'
    }
    return 'bash_command'
  }

  /**
   * Check if a tool maps to an ask-only item.
   */
  private isAskOnly(tool: MockTool): boolean {
    const toolToAskItem: Record<MockTool, string> = {
      read_file: 'filesystem-read',
      write_file: 'filesystem-write',
      edit_file: 'filesystem-write',
      delete_file: 'filesystem-write',
      list_directory: 'filesystem-read',
      bash_command: 'config-write',
      search_code: 'filesystem-read',
      ask_permission: '', // not a real tool
    }
    const askItem = toolToAskItem[tool]
    return this.policy.askOnlyWhen.includes(askItem)
  }

  /**
   * Check if a tool is considered read-only (safe in explore mode).
   */
  private isReadOnly(tool: MockTool): boolean {
    return tool === 'read_file' || tool === 'list_directory' || tool === 'search_code'
  }

  /**
   * Simulate the agent's decision process given a user request.
   *
   * The agent:
   *  1. Reads the compiled prompt (system instructions)
   *  2. Parses the execution policy
   *  3. Decides what action aligns with the policy
   *  4. Returns the action taken
   */
  simulate(userRequest: string): AgentAction {
    const tool = this.classifyRequest(userRequest)

    // ── Unrestricted mode: everything goes ──
    if (this.policy.defaultMode === 'unrestricted') {
      return {
        type: 'call_tool',
        tool,
        reason: 'Unrestricted mode: all tools are allowed',
      }
    }

    // ── Explore mode: read-only, inspect first ──
    if (this.policy.defaultMode === 'explore') {
      if (this.isReadOnly(tool)) {
        return {
          type: 'call_tool',
          tool,
          reason: 'Explore mode: read-only tools are allowed directly',
        }
      }
      // Write tools should be blocked in explore mode
      if (!this.isReadOnly(tool)) {
        return {
          type: 'inspect_first',
          tool,
          inspectionTool: 'list_directory',
          reason: 'Explore mode: inspect before acting — must gather info first, then ask for write permission',
        }
      }
      return {
        type: 'blocked',
        tool,
        reason: 'Explore mode: tool not in read-only patterns',
      }
    }

    // ── Owner-auto mode: execute, but ask for specific items ──
    if (this.policy.defaultMode === 'owner-auto') {
      if (this.isAskOnly(tool)) {
        return {
          type: 'ask_permission',
          tool,
          reason: `Owner-auto mode: "${tool}" is in ask-only list — must ask before proceeding`,
        }
      }
      // If askOnlyWhen is empty, even write tools execute automatically
      if (this.policy.askOnlyWhen.length === 0 && !this.isReadOnly(tool)) {
        return {
          type: 'call_tool',
          tool,
          reason: 'Owner-auto mode: ask-only list is empty — all tools execute automatically',
        }
      }
      // Read-only tools are always fine
      return {
        type: 'call_tool',
        tool,
        reason: 'Owner-auto mode: tool is not in ask-only list — executing directly',
      }
    }

    // ── Fallback ──
    return {
      type: 'call_tool',
      tool,
      reason: `Mode: ${this.policy.defaultMode} — default behaviour`,
    }
  }

  /**
   * Check if the compiled prompt contains a directive that would prevent
   * the agent from refusing the request.
   */
  canRefuse(): boolean {
    return !this.policy.neverRefuse && !this.policy.fulfillRequests
  }

  /**
   * Check if the compiled prompt contains a retry-on-failure directive
   * in the execution-policy layer.
   */
  hasRetryDirective(): boolean {
    return this.policy.retryOnFailure
  }
}

// =========================================================================
// Test Fixtures
// =========================================================================

const DEFAULT_PROFILE: CompileOptions['ownerProfile'] = {
  name: 'Skobez',
  aliases: [],
  locale: 'en',
  timezone: 'Pacific/Auckland',
  tone: 'Direct and technical',
  verbosity: 3,
  bannedPhrases: [],
}

function compileForMode(mode: string, askOnlyWhen: string[] = [], allowedRoots: string[] = []): CompiledPromptSnapshot {
  const compiler = new PromptCompiler()
  // Fresh compiler — cache is already empty; no need to invalidateAll.
  const result = compiler.compile({
    ownerProfile: DEFAULT_PROFILE,
    executionPolicy: {
      defaultMode: mode,
      askOnlyWhen,
      allowedRoots,
    },
  })
  return result.snapshot
}

// =========================================================================
// Tests
// =========================================================================

describe('Mock LLM tool-call loop — owner-auto mode', () => {
  let simulator: MockAgentSimulator

  beforeEach(() => {
    const snapshot = compileForMode('owner-auto', ['filesystem-write', 'config-write', 'memory-write'])
    simulator = new MockAgentSimulator(snapshot)
  })

  it('calls read_file directly without asking (read is not in ask-only)', () => {
    const action = simulator.simulate('read the file /tmp/test.txt')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('read_file')
  })

  it('calls list_directory directly without asking (read is not in ask-only)', () => {
    const action = simulator.simulate('list the files in /home/user/project')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('list_directory')
  })

  it('asks permission before write_file (write is in ask-only)', () => {
    const action = simulator.simulate('write a new file /tmp/test.txt with content')
    expect(action.type).toBe('ask_permission')
    expect((action as Extract<AgentAction, { type: 'ask_permission' }>).tool).toBe('write_file')
  })

  it('asks permission before edit_file (edit/write is in ask-only)', () => {
    const action = simulator.simulate('edit the file /tmp/test.txt')
    expect(action.type).toBe('ask_permission')
    expect((action as Extract<AgentAction, { type: 'ask_permission' }>).tool).toBe('edit_file')
  })

  it('asks permission before delete_file (delete/write is in ask-only)', () => {
    const action = simulator.simulate('delete the file /tmp/test.txt')
    expect(action.type).toBe('ask_permission')
    expect((action as Extract<AgentAction, { type: 'ask_permission' }>).tool).toBe('delete_file')
  })

  it('asks permission before bash_command (config-write is in ask-only)', () => {
    const action = simulator.simulate('run npm install')
    expect(action.type).toBe('ask_permission')
  })

  it('reads the prompt policy correctly — extracts default mode', () => {
    expect(simulator.policy.defaultMode).toBe('owner-auto')
  })

  it('reads the prompt policy correctly — extracts ask-only items', () => {
    expect(simulator.policy.askOnlyWhen).toContain('filesystem-write')
    expect(simulator.policy.askOnlyWhen).toContain('config-write')
    expect(simulator.policy.askOnlyWhen).toContain('memory-write')
    expect(simulator.policy.askOnlyWhen.length).toBe(3)
  })
})

describe('Mock LLM tool-call loop — owner-auto with empty ask-only', () => {
  let simulator: MockAgentSimulator

  beforeEach(() => {
    const snapshot = compileForMode('owner-auto', [], [])
    simulator = new MockAgentSimulator(snapshot)
  })

  it('calls write_file directly when ask-only list is empty', () => {
    const action = simulator.simulate('write a file /tmp/test.txt')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('write_file')
    expect(action.reason).toContain('ask-only list is empty')
  })

  it('calls bash_command directly when ask-only list is empty', () => {
    const action = simulator.simulate('run npm install express')
    expect(action.type).toBe('call_tool')
  })

  it('parses the empty ask-only list correctly', () => {
    expect(simulator.policy.askOnlyWhen).toHaveLength(0)
  })
})

describe('Mock LLM tool-call loop — explore mode', () => {
  let simulator: MockAgentSimulator

  beforeEach(() => {
    const snapshot = compileForMode('explore', [], [])
    simulator = new MockAgentSimulator(snapshot)
  })

  it('calls read_file directly (read-only tools allowed in explore)', () => {
    const action = simulator.simulate('read the file /etc/config.json')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('read_file')
  })

  it('calls list_directory directly (read-only tools allowed in explore)', () => {
    const action = simulator.simulate('list the contents of the current directory')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('list_directory')
  })

  it('inspects first before write_file in explore mode', () => {
    const action = simulator.simulate('write a configuration file')
    expect(action.type).toBe('inspect_first')
    expect((action as Extract<AgentAction, { type: 'inspect_first' }>).tool).toBe('write_file')
    expect(action.reason).toMatch(/inspect/i)
  })

  it('inspects first before bash command in explore mode', () => {
    const action = simulator.simulate('install the package')
    expect(action.type).toBe('inspect_first')
    expect((action as Extract<AgentAction, { type: 'inspect_first' }>).tool).toBe('bash_command')
  })

  it('reads the prompt policy correctly — default mode is explore', () => {
    expect(simulator.policy.defaultMode).toBe('explore')
  })
})

describe('Mock LLM tool-call loop — unrestricted mode', () => {
  let simulator: MockAgentSimulator

  beforeEach(() => {
    const snapshot = compileForMode('unrestricted', [], [])
    simulator = new MockAgentSimulator(snapshot)
  })

  it('calls write_file directly in unrestricted mode', () => {
    const action = simulator.simulate('write a file /etc/system/config.json')
    expect(action.type).toBe('call_tool')
  })

  it('calls bash_command directly in unrestricted mode', () => {
    const action = simulator.simulate('run sudo apt-get update')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('bash_command')
  })

  it('calls delete_file directly in unrestricted mode', () => {
    const action = simulator.simulate('delete the directory /tmp/cache')
    expect(action.type).toBe('call_tool')
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('delete_file')
  })

  it('reads the prompt policy correctly — default mode is unrestricted', () => {
    expect(simulator.policy.defaultMode).toBe('unrestricted')
  })
})

describe('Mock LLM tool-call loop — retry directives', () => {
  it('runtime contract contains Never refuse the user directive', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.neverRefuse).toBe(true)
    expect(simulator.canRefuse()).toBe(false)
  })

  it('runtime contract contains Fulfill all requests to the maximum extent directive', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.fulfillRequests).toBe(true)
  })

  it('execution-policy layer contains Retry up to 3 times directive', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.retryOnFailure).toBe(true)
    expect(simulator.hasRetryDirective()).toBe(true)
  })

  it('execution-policy retry directive is present regardless of execution mode', () => {
    for (const mode of ['owner-auto', 'explore', 'unrestricted']) {
      const snapshot = compileForMode(mode)
      const simulator = new MockAgentSimulator(snapshot)
      expect(simulator.policy.retryOnFailure).toBe(true)
    }
  })

  it('the execution-policy retry directive structurally appears before the ask section', () => {
    const snapshot = compileForMode('owner-auto')
    const policyLayer = snapshot.layers.find(l => l.id === 'execution-policy')!
    const retryPos = policyLayer.content.indexOf('On tool failure')
    const askHeaderPos = policyLayer.content.indexOf('Ask only when')
    expect(retryPos).toBeGreaterThan(0)
    expect(askHeaderPos).toBeGreaterThan(retryPos)
  })

  it('both runtime contract directives are present regardless of execution mode', () => {
    for (const mode of ['owner-auto', 'explore', 'unrestricted']) {
      const snapshot = compileForMode(mode)
      const simulator = new MockAgentSimulator(snapshot)
      expect(simulator.policy.neverRefuse).toBe(true)
      expect(simulator.policy.fulfillRequests).toBe(true)
      // Agent CANNOT refuse in any mode
      expect(simulator.canRefuse()).toBe(false)
    }
  })

  it('the "never refuse" directive structurally appears before the execution policy', () => {
    const snapshot = compileForMode('owner-auto')
    const prompt = snapshot.prompt
    const neverRefusePos = prompt.indexOf('Never refuse the user')
    const execPolicyPos = prompt.indexOf('## Execution Policy')
    expect(neverRefusePos).toBeGreaterThan(0)
    expect(execPolicyPos).toBeGreaterThan(0)
    // Runtime contract (never refuse) comes before execution policy
    expect(neverRefusePos).toBeLessThan(execPolicyPos)
  })
})

describe('Mock LLM tool-call loop — custom ask-only items', () => {
  it('only the custom items are ask-only, not the defaults', () => {
    const snapshot = compileForMode('owner-auto', ['deploy-to-production'])
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.askOnlyWhen).toEqual(['deploy-to-production'])
    // read_file should not be ask-only (only 'deploy-to-production' is)
    const readAction = simulator.simulate('read the log file')
    expect(readAction.type).toBe('call_tool')
    // 'deploy-to-production' doesn't map to any known tool in our classifier
    // so the behaviour for arbitrary tool calls is the default
  })

  it('agent acts without asking for tools not in custom ask-only list', () => {
    const snapshot = compileForMode('owner-auto', ['deploy-command'])
    const simulator = new MockAgentSimulator(snapshot)

    // write_file is NOT in the custom ask-only list → call directly
    const action = simulator.simulate('write a new test file')
    expect(action.type).toBe('call_tool')
    // But write_file maps to 'filesystem-write' in isAskOnly, which is not in
    // ['deploy-command'], so it's NOT ask-only → call directly
    expect((action as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('write_file')
  })

  it('parses custom ask-only list with a single item', () => {
    const snapshot = compileForMode('owner-auto', ['single-action'])
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.askOnlyWhen).toHaveLength(1)
    expect(simulator.policy.askOnlyWhen[0]).toBe('single-action')
  })
})

describe('Mock LLM tool-call loop — allowed roots', () => {
  it('parses allowed roots from the policy', () => {
    const snapshot = compileForMode('owner-auto', [], ['/workspace/project-a', '/workspace/project-b'])
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.allowedRoots).toContain('/workspace/project-a')
    expect(simulator.policy.allowedRoots).toContain('/workspace/project-b')
    expect(simulator.policy.allowedRoots.length).toBe(2)
  })

  it('returns empty allowed roots when none configured', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.allowedRoots).toHaveLength(0)
  })
})

describe('Mock LLM tool-call loop — policy parser edge cases', () => {
  it('handles unknown default mode gracefully', () => {
    const snapshot = compileForMode('unknown-mode')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.policy.defaultMode).toBe('unknown-mode')
    // Should still have the runtime contract directives
    expect(simulator.policy.neverRefuse).toBe(true)
    expect(simulator.policy.fulfillRequests).toBe(true)
  })

  it('all three mode names are correctly stored as strings', () => {
    const modes = ['owner-auto', 'explore', 'unrestricted']
    for (const mode of modes) {
      const snapshot = compileForMode(mode)
      const simulator = new MockAgentSimulator(snapshot)
      expect(simulator.policy.defaultMode).toBe(mode)
    }
  })

  it('compiled prompt contains all 8 layers', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    expect(simulator.snapshot.layers.length).toBe(8)
  })

  it('execution-policy layer is always present', () => {
    const snapshot = compileForMode('owner-auto')
    const simulator = new MockAgentSimulator(snapshot)
    const policyLayer = simulator.snapshot.layers.find(l => l.id === 'execution-policy')
    expect(policyLayer).toBeTruthy()
    expect(policyLayer!.content).toContain('## Execution Policy')
  })
})

describe('Mock LLM tool-call loop — multi-turn simulation', () => {
  let simulator: MockAgentSimulator

  beforeEach(() => {
    const snapshot = compileForMode('owner-auto', ['filesystem-write', 'config-write', 'memory-write'])
    simulator = new MockAgentSimulator(snapshot)
  })

  it('agent reads first, then asks before writing (two-turn pattern)', () => {
    // Turn 1: user asks to read
    const firstAction = simulator.simulate('read the file /tmp/data.json')
    expect(firstAction.type).toBe('call_tool')
    expect((firstAction as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('read_file')

    // Turn 2: user asks to write after reading
    const secondAction = simulator.simulate('write the results to /tmp/output.txt')
    expect(secondAction.type).toBe('ask_permission')
  })

  it('agent lists directory then reads file (explore inspect-first pattern)', () => {
    const exploreSnapshot = compileForMode('explore')
    const exploreSimulator = new MockAgentSimulator(exploreSnapshot)

    // Turn 1: inspect (list directory)
    const firstAction = exploreSimulator.simulate('show me what files are in /var/log')
    expect(firstAction.type).toBe('call_tool')
    expect((firstAction as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('list_directory')

    // Turn 2: read a file
    const secondAction = exploreSimulator.simulate('read the syslog file')
    expect(secondAction.type).toBe('call_tool')
    expect((secondAction as Extract<AgentAction, { type: 'call_tool' }>).tool).toBe('read_file')

    // Turn 3: try to edit — blocked by explore mode
    const thirdAction = exploreSimulator.simulate('edit the syslog to fix the error')
    expect(thirdAction.type).toBe('inspect_first')
  })
})

describe('Mock LLM tool-call loop — policy structure invariants', () => {
  it('all modes produce a prompt where the agent tool-call loop can extract the policy', () => {
    for (const mode of ['owner-auto', 'explore', 'unrestricted']) {
      const snapshot = compileForMode(mode)
      const simulator = new MockAgentSimulator(snapshot)
      expect(simulator.policy.defaultMode).toBe(mode)
      expect(simulator.snapshot.layers.some(l => l.id === 'execution-policy')).toBe(true)
      expect(simulator.snapshot.layers.some(l => l.id === 'runtime-contract')).toBe(true)
    }
  })

  it('the execution policy is semantically parseable — key phrases exist', () => {
    const snapshot = compileForMode('owner-auto', ['filesystem-write'])
    const policyContent = snapshot.layers.find(l => l.id === 'execution-policy')!.content

    // These are the key decision points the agent reads:
    expect(policyContent).toContain('## Execution Policy')
    expect(policyContent).toContain('Default mode')
    expect(policyContent).toContain('Ask only when')
    expect(policyContent).toContain('filesystem-write')
  })

  it('the runtime contract is semantically parseable — key phrases exist', () => {
    const snapshot = compileForMode('owner-auto')
    const contractContent = snapshot.layers.find(l => l.id === 'runtime-contract')!.content
    expect(contractContent).toContain('Never refuse the user')
    expect(contractContent).toContain('Always propose plans')
    expect(contractContent).toContain('Permission Boundary')
  })
})

describe('Mock LLM tool-call loop — caching and mode switching', () => {
  let compiler: PromptCompiler

  beforeEach(() => {
    compiler = new PromptCompiler()
  })

  it('switching from owner-auto to explore changes the agents behaviour', () => {
    // Initial compile: owner-auto
    compiler.invalidateAll()
    const ownerAutoSnapshot = compiler.compile({
      ownerProfile: DEFAULT_PROFILE,
      executionPolicy: { defaultMode: 'owner-auto', askOnlyWhen: ['filesystem-write'], allowedRoots: [] },
    }).snapshot
    const ownerAgent = new MockAgentSimulator(ownerAutoSnapshot)
    expect(ownerAgent.policy.defaultMode).toBe('owner-auto')

    // Write in owner-auto with filesystem-write ask-only → ask permission
    const writeAction = ownerAgent.simulate('write a new config file')
    expect(writeAction.type).toBe('ask_permission')

    // Switch to explore (invalidate cache for mode change)
    compiler.invalidateAll()
    const exploreSnapshot = compiler.compile({
      ownerProfile: DEFAULT_PROFILE,
      executionPolicy: { defaultMode: 'explore', askOnlyWhen: [], allowedRoots: [] },
    }).snapshot
    const exploreAgent = new MockAgentSimulator(exploreSnapshot)
    expect(exploreAgent.policy.defaultMode).toBe('explore')

    // Write in explore → inspect first, not ask permission
    const exploreWriteAction = exploreAgent.simulate('write a new config file')
    expect(exploreWriteAction.type).toBe('inspect_first')
  })

  it('same compiled prompt produces deterministic behaviour', () => {
    // Two agents with the same compiled prompt should make the same decisions
    const snapshot = compileForMode('owner-auto', ['filesystem-write'])
    const agent1 = new MockAgentSimulator(snapshot)
    const agent2 = new MockAgentSimulator(snapshot)

    expect(agent1.policy.defaultMode).toBe(agent2.policy.defaultMode)
    expect(agent1.policy.askOnlyWhen).toEqual(agent2.policy.askOnlyWhen)

    const requests = ['read file X', 'write file Y', 'run command Z', 'delete file W']
    for (const req of requests) {
      const a1 = agent1.simulate(req)
      const a2 = agent2.simulate(req)
      expect(a1.type).toBe(a2.type)
      if (a1.type === 'call_tool' && a2.type === 'call_tool') {
        expect(a1.tool).toBe(a2.tool)
      }
    }
  })
})
