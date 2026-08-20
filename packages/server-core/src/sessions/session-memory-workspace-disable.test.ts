import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Spec P2: {workspace}/config.json `memory.enabled` overrides the global
// memory.enabled. When false, memoryServiceFor must NOT create the workspace
// MemoryService — session start then sees no memory blocks (the
// `memoryServiceFor(...)?.buildMemoryBlocks()` chain yields undefined) and no
// distill trigger is ever attached (no completion subscription exists).
describe('memoryServiceFor per-workspace disable (P2)', () => {
  let tmpRoot: string
  let sm: SessionManager
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-mem-ws-'))
    sm = new SessionManager()
  })
  afterEach(() => {
    for (const svc of (sm as unknown as { memoryServices: Map<string, { stop(): void }> }).memoryServices.values()) {
      svc.stop()
    }
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildWorkspace() {
    return { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() } as never
  }

  function writeWorkspaceConfig(extra: Record<string, unknown>) {
    mkdirSync(tmpRoot, { recursive: true })
    writeFileSync(
      join(tmpRoot, 'config.json'),
      JSON.stringify({ id: 'ws_test', name: 'Test Workspace', slug: 'test-workspace', createdAt: Date.now(), updatedAt: Date.now(), ...extra }),
      'utf-8',
    )
  }

  function serviceFor(): { stop(): void } | null {
    return (sm as unknown as {
      memoryServiceFor(workspace: unknown): { stop(): void } | null
    }).memoryServiceFor(buildWorkspace())
  }

  function memoryServiceCount(): number {
    return (sm as unknown as { memoryServices: Map<string, unknown> }).memoryServices.size
  }

  it('memory.enabled:false → returns null, no service constructed, no distill triggers attached', () => {
    writeWorkspaceConfig({ memory: { enabled: false } })
    expect(serviceFor()).toBeNull()
    // Nothing cached → every downstream call site (buildMemoryBlocks, distill
    // triggers, branch signals) no-ops through optional chaining.
    expect(memoryServiceCount()).toBe(0)
    // Repeated lookups stay null and keep not creating the service.
    expect(serviceFor()).toBeNull()
    expect(memoryServiceCount()).toBe(0)
  })

  it('missing memory override → service created as before (global switch rules)', () => {
    writeWorkspaceConfig({})
    expect(serviceFor()).not.toBeNull()
    expect(memoryServiceCount()).toBe(1)
  })

  it('memory.enabled:true → service created (explicit opt-in)', () => {
    writeWorkspaceConfig({ memory: { enabled: true } })
    expect(serviceFor()).not.toBeNull()
    expect(memoryServiceCount()).toBe(1)
  })

  it('session buildMemoryBlocks path degrades to undefined when memory is disabled', async () => {
    writeWorkspaceConfig({ memory: { enabled: false } })
    // Seed a managed session the way the F3 harness does, then walk the exact
    // chain createBackendFromResolvedContext uses for memoryBlocks.
    const sessionId = 'sess_p2'
    const managed = createManagedSession({ id: sessionId, name: 'seeded', createdAt: Date.now() }, buildWorkspace())
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
    const svc = (sm as unknown as {
      memoryServiceFor(workspace: { id: string; rootPath: string }): { buildMemoryBlocks(): unknown } | null
    }).memoryServiceFor(managed.workspace)
    const memoryBlocks = svc?.buildMemoryBlocks()
    expect(memoryBlocks).toBeUndefined()
  })
})
