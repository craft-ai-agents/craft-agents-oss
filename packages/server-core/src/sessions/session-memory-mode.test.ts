import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  getSessionFilePath,
  loadSession,
  writeSessionJsonl,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import type { StoredMessage } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'
// Spec F3: sessions:setMemoryMode persists the self-learning memory mode into the
// session JSONL header (default 'persistent' stores absent) for both warm and cold
// (metadata-only, post-restart) sessions. Harness follows cold-session-metadata.test.ts.
describe('setSessionMemoryMode persistence (F3)', () => {
  let tmpRoot: string
  let sm: SessionManager
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-mem-mode-'))
    sm = new SessionManager()
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })
  function buildWorkspace() {
    return {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    } as never
  }
  function seedSession(
    sessionId: string,
    opts: { memoryMode?: 'persistent' | 'incognito' | 'temporary'; messages?: StoredMessage[] } = {},
  ) {
    const filePath = getSessionFilePath(tmpRoot, sessionId)
    mkdirSync(dirname(filePath), { recursive: true })
    const stored: StoredSession = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: 'seeded',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages: opts.messages ?? [],
      ...(opts.memoryMode ? { memoryMode: opts.memoryMode } : {}),
    } as StoredSession
    writeSessionJsonl(filePath, stored)

    const managed = createManagedSession(
      {
        id: sessionId,
        name: stored.name,
        createdAt: stored.createdAt,
        ...(opts.memoryMode ? { memoryMode: opts.memoryMode } : {}),
      },
      buildWorkspace(),
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
  }
  function readDiskHeader(sessionId: string): Record<string, unknown> {
    const path = getSessionFilePath(tmpRoot, sessionId)
    const firstLine = readFileSync(path, 'utf-8').split('\n')[0]
    return JSON.parse(firstLine)
  }

  it('persists incognito to the JSONL header on a cold session', async () => {
    seedSession('s1')
    await sm.setSessionMemoryMode('s1', 'incognito')
    const header = readDiskHeader('s1')
    expect(header.memoryMode).toBe('incognito')
    const reloaded = loadSession(tmpRoot, 's1')
    expect(reloaded?.memoryMode).toBe('incognito')
  })
  it('persists temporary to the JSONL header', async () => {
    seedSession('s2')
    await sm.setSessionMemoryMode('s2', 'temporary')
    const reloaded = loadSession(tmpRoot, 's2')
    expect(reloaded?.memoryMode).toBe('temporary')
  })
  it('switching back to persistent clears the field (absent = persistent)', async () => {
    seedSession('s3', { memoryMode: 'incognito' })
    await sm.setSessionMemoryMode('s3', 'persistent')
    const header = readDiskHeader('s3')
    expect(header.memoryMode).toBeUndefined()
    const reloaded = loadSession(tmpRoot, 's3')
    expect(reloaded?.memoryMode).toBeUndefined()
  })
  it('unknown mode string on disk is dropped by header normalization', async () => {
    const filePath = getSessionFilePath(tmpRoot, 's4')
    mkdirSync(dirname(filePath), { recursive: true })
    writeSessionJsonl(filePath, {
      id: 's4',
      workspaceRootPath: tmpRoot,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages: [],
    } as unknown as StoredSession)
    // Simulate a corrupt/future header written by a newer build.
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    const header = JSON.parse(lines[0])
    header.memoryMode = 'forget-me-maybe'
    lines[0] = JSON.stringify(header)
    writeFileSync(filePath, lines.join('\n'))
    const reloaded = loadSession(tmpRoot, 's4')
    expect(reloaded?.memoryMode).toBeUndefined()
  })
  it('no-op for an unknown session id', async () => {
    await expect(sm.setSessionMemoryMode('missing', 'incognito')).resolves.toBeUndefined()
  })
})
