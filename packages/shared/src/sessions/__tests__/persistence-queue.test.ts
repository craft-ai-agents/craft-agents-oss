import { describe, it, expect } from 'bun:test'
import type { SessionHeader, StoredSession } from '../types'
import { getHeaderMetadataSignature, mergeHeaderWithExternalMetadata, SessionPersistenceQueue } from '../persistence-queue'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeHeader(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    id: 's1',
    workspaceRootPath: '~/.craft-agent/workspaces/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      contextTokens: 0,
    },
    ...overrides,
  }
}

describe('session persistence header conflict helpers', () => {
  it('rejects a failed durable write and retains it for explicit retry', async () => {
    const root=mkdtempSync(join(tmpdir(),'session-write-failure-'))
    const blocked=join(root,'workspace'), queue=new SessionPersistenceQueue(60000)
    writeFileSync(blocked,'fixture: a file, not a workspace directory')
    try {
      queue.enqueue({...makeHeader(),workspaceRootPath:blocked,messages:[]} as StoredSession)
      await expect(queue.flushAll()).rejects.toThrow('尚未确认保存')
      expect(queue.pendingCount).toBe(1)
      unlinkSync(blocked);mkdirSync(blocked)
      await queue.flushAll()
      expect(queue.pendingCount).toBe(0)
      expect(JSON.parse(readFileSync(join(blocked,'sessions','s1','session.jsonl'),'utf8').split('\n')[0]!).id).toBe('s1')
    } finally {queue.cancel('s1');rmSync(root,{recursive:true,force:true})}
  })
  it('flushAll waits for timer writes after they leave the pending map', async () => {
    const queue=new SessionPersistenceQueue(0)
    let enter!:()=>void, release!:()=>void
    const started=new Promise<void>(resolve=>{enter=resolve})
    const gate=new Promise<void>(resolve=>{release=resolve})
    ;(queue as any).write=async(id:string)=>{(queue as any).pending.delete(id);enter();await gate}
    queue.enqueue({id:'s1'} as StoredSession)
    await started
    let drained=false
    const done=queue.flushAll().then(()=>{drained=true})
    await Promise.resolve()
    expect(drained).toBe(false)
    release();await done
    expect(drained).toBe(true)
  })
  it('serializes timer/explicit flush and replaces an existing session file', async () => {
    const root=mkdtempSync(join(tmpdir(),'session-drain-test-'))
    const queue=new SessionPersistenceQueue(0)
    try {
      const session={...makeHeader(),workspaceRootPath:root,messages:[]} as StoredSession
      queue.enqueue(session)
      await queue.flushAll()
      queue.enqueue({...session,name:'updated'})
      await Promise.all([queue.flush('s1'),queue.flushAll(),queue.flush('s1')])
      const saved=JSON.parse(readFileSync(join(root,'sessions','s1','session.jsonl'),'utf8').split('\n')[0]!)
      expect(saved.name).toBe('updated')
      expect(queue.pendingCount).toBe(0)
    } finally {await queue.flushAll();rmSync(root,{recursive:true,force:true})}
  })
  it('metadata signature ignores non-metadata fields', () => {
    const a = makeHeader({ name: 'A', lastUsedAt: 100 })
    const b = makeHeader({ name: 'A', lastUsedAt: 999, messageCount: 42 })

    expect(getHeaderMetadataSignature(a)).toBe(getHeaderMetadataSignature(b))
  })

  it('metadata signature changes when metadata changes', () => {
    const a = makeHeader({ name: 'A', labels: ['x'] })
    const b = makeHeader({ name: 'B', labels: ['x'] })

    expect(getHeaderMetadataSignature(a)).not.toBe(getHeaderMetadataSignature(b))
  })

  it('merge preserves external metadata while keeping local computed fields', () => {
    const local = makeHeader({
      name: 'Local Name',
      labels: ['local'],
      isFlagged: false,
      sessionStatus: 'todo',
      permissionMode: 'allow-all',
      hasUnread: true,
      lastReadMessageId: 'm-local',
      messageCount: 99,
      lastUsedAt: 500,
    })

    const disk = makeHeader({
      name: 'Disk Name',
      labels: ['disk'],
      isFlagged: true,
      sessionStatus: 'needs-review',
      permissionMode: 'safe',
      hasUnread: false,
      lastReadMessageId: 'm-disk',
      messageCount: 1,
      lastUsedAt: 50,
    })

    const merged = mergeHeaderWithExternalMetadata(local, disk)

    expect(merged.name).toBe('Disk Name')
    expect(merged.labels).toEqual(['disk'])
    expect(merged.isFlagged).toBe(true)
    expect(merged.sessionStatus).toBe('needs-review')
    expect(merged.permissionMode).toBe('safe')
    expect(merged.hasUnread).toBe(false)
    expect(merged.lastReadMessageId).toBe('m-disk')

    // Local computed/runtime persistence fields remain local
    expect(merged.messageCount).toBe(99)
    expect(merged.lastUsedAt).toBe(500)
  })

  it('startup scenario: external metadata differs from local signature', () => {
    const local = makeHeader({ name: 'Local Name', labels: ['local'] })
    const disk = makeHeader({ name: 'External Name', labels: ['external'] })

    const localSig = getHeaderMetadataSignature(local)
    const diskSig = getHeaderMetadataSignature(disk)

    // This is the condition used by persistence queue at startup:
    // no previousSig yet, disk differs from local → preserve external metadata.
    const hasExternalMetadataChange = diskSig !== localSig
      && (undefined === undefined || diskSig !== undefined)

    expect(hasExternalMetadataChange).toBe(true)

    const merged = mergeHeaderWithExternalMetadata(local, disk)
    expect(merged.name).toBe('External Name')
    expect(merged.labels).toEqual(['external'])
  })
})
