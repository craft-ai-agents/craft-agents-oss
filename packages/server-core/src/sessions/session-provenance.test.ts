import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import { writeProvenance } from '../memory/provenance.ts'
// Spec F4: sessionManager.getSessionProvenance resolves the session's workspace
// and returns the record written by the injection site (or null when absent).
// Harness follows session-memory-mode.test.ts.
describe('getSessionProvenance (F4)', () => {
  let tmpRoot: string
  let sm: SessionManager
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-provenance-'))
    sm = new SessionManager()
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })
  function seedSession(sessionId: string) {
    const managed = createManagedSession(
      { id: sessionId, name: 'seeded', createdAt: Date.now() },
      {
        id: 'ws_test',
        name: 'Test Workspace',
        rootPath: tmpRoot,
        createdAt: Date.now(),
      } as never,
    )
    // SessionManager.sessions is private: tests seed fixture state directly,
    // mirroring session-memory-mode.test.ts.
    const registry = sm as unknown as { sessions: Map<string, unknown> }
    registry.sessions.set(sessionId, managed)
  }

  it('returns null for an unknown session id', () => {
    expect(sm.getSessionProvenance('missing')).toBeNull()
  })

  it('returns null when no provenance was ever written', () => {
    seedSession('s1')
    expect(sm.getSessionProvenance('s1')).toBeNull()
  })

  it('returns the record written for the session', () => {
    seedSession('s2')
    const written = writeProvenance(tmpRoot, 's2', {
      lessons: [
        { rule: 'global rule', scope: 'global' },
        { rule: 'ws rule', scope: 'workspace' },
      ],
      skills: [],
    })
    const provenance = sm.getSessionProvenance('s2')
    expect(provenance).toEqual({
      lessons: [
        { rule: 'global rule', scope: 'global' },
        { rule: 'ws rule', scope: 'workspace' },
      ],
      skills: [],
      ts: written.ts,
    })
  })
})
