import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

const NOW = '2026-07-01T00:00:00.000Z'

function binding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'binding-one',
    enabled: true,
    labelId: 'review',
    skillSlug: 'audit',
    compactInstruction: 'Apply the audit skill compactly.',
    applyScope: { mode: 'workspace-slug', workspaceSlug: 'ws_test' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('SessionManager label-skill binding integration', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-label-skill-'))
    writeLabels(['review'])
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function writeBindings(config: unknown) {
    writeFileSync(join(tmpRoot, 'label-skill-bindings.json'), JSON.stringify(config, null, 2), 'utf-8')
  }

  function writeLabels(ids: string[]) {
    mkdirSync(join(tmpRoot, 'labels'), { recursive: true })
    writeFileSync(join(tmpRoot, 'labels', 'config.json'), JSON.stringify({
      version: 1,
      labels: ids.map(id => ({ id, name: id, color: 'foreground/50' })),
    }, null, 2), 'utf-8')
  }

  function buildSession(id: string, overrides: Record<string, unknown> = {}) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'label skill test', labels: ['review'], llmConnection: 'missing-test-connection', ...overrides },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('resolves invalid loaded config to a revocation block when prior anchors existed', () => {
    writeBindings({
      version: 1,
      bindings: [binding({ requiredSourcesSnapshot: { slug: 'linear' } })],
    })
    const managed = buildSession('invalid-revocation', {
      labelSkillAnchorState: { lastActiveBindingIds: ['binding-one'], lastBlockKind: 'active' },
    })

    const resolution = (sm as unknown as {
      resolveLabelSkillAnchorsForSession(session: unknown): unknown
    }).resolveLabelSkillAnchorsForSession(managed) as { blockKind: string; block?: string; nextState: { lastActiveBindingIds?: string[] } }

    expect(resolution.blockKind).toBe('revocation')
    expect(resolution.block).toContain('prior label-bound bootstrap/read-derived role instructions only')
    expect(resolution.nextState.lastActiveBindingIds).toEqual([])
  })

  it('revokes when the session label was deleted from current label config', () => {
    writeLabels(['other-label'])
    writeBindings({
      version: 1,
      bindings: [binding()],
    })
    const managed = buildSession('deleted-label-revocation', {
      labelSkillAnchorState: { lastActiveBindingIds: ['binding-one'], lastBlockKind: 'active' },
    })

    const resolution = (sm as unknown as {
      resolveLabelSkillAnchorsForSession(session: unknown): unknown
    }).resolveLabelSkillAnchorsForSession(managed) as { blockKind: string; block?: string; activeAnchors: unknown[] }

    expect(resolution.blockKind).toBe('revocation')
    expect(resolution.activeAnchors).toHaveLength(0)
    expect(resolution.block).toContain('No label-bound skill role is active')
  })

  it('builds first-turn bootstrap entries and suppresses queued/prior-final/completed retries', () => {
    const skillDir = join(tmpRoot, 'skills', 'audit')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    writeFileSync(skillPath, '---\nname: Audit\ndescription: Audit carefully\n---\nRead this skill.\n', 'utf-8')
    writeBindings({
      version: 1,
      bindings: [binding()],
    })
    const managed = buildSession('bootstrap-first-turn')
    const resolution = (sm as unknown as {
      resolveLabelSkillAnchorsForSession(session: unknown): unknown
    }).resolveLabelSkillAnchorsForSession(managed)
    const buildBootstrap = (args: { messagesBeforeModelCall: unknown[]; isQueuedReplay: boolean }) => (sm as unknown as {
      buildLabelSkillBootstrapEntriesForSession(session: unknown, resolution: unknown, args: unknown): { entries: Array<{ skillPath: string }>; selection: { reason?: string } } | null
    }).buildLabelSkillBootstrapEntriesForSession(managed, resolution, {
      ...args,
      explicitSkillSlugs: [],
    })

    expect(buildBootstrap({ messagesBeforeModelCall: [], isQueuedReplay: false })?.entries[0]?.skillPath).toBe(skillPath)
    expect(buildBootstrap({ messagesBeforeModelCall: [{ role: 'user' }], isQueuedReplay: true })?.selection.reason).toBe('queued-replay')
    expect(buildBootstrap({ messagesBeforeModelCall: [{ role: 'assistant' }], isQueuedReplay: false })?.selection.reason).toBe('prior-final-assistant')

    managed.labelSkillAnchorState = {
      contextEpoch: 0,
      lastActiveBindingIds: ['binding-one'],
      bootstrap: {
        configHash: (resolution as { configHash: string }).configHash,
        contextEpoch: 0,
        entries: [{ bindingId: 'binding-one', skillSlug: 'audit', status: 'completed', completedAt: NOW }],
        bootstrappedSkillSlugs: ['audit'],
      },
    }
    expect(buildBootstrap({ messagesBeforeModelCall: [], isQueuedReplay: false })?.selection.reason).toBe('no-candidates')

    managed.labelSkillAnchorState = {
      contextEpoch: 1,
      lastActiveBindingIds: ['binding-one'],
      bootstrap: {
        configHash: (resolution as { configHash: string }).configHash,
        contextEpoch: 0,
        entries: [{ bindingId: 'binding-one', skillSlug: 'audit', status: 'completed', completedAt: NOW }],
        bootstrappedSkillSlugs: ['audit'],
      },
    }
    expect(buildBootstrap({ messagesBeforeModelCall: [{ role: 'assistant' }], isQueuedReplay: false })?.entries[0]?.skillPath).toBe(skillPath)
  })

  it('detects mid-stream label-skill sources that must be queued for replay', () => {
    writeBindings({
      version: 1,
      bindings: [binding({ requiredSourcesSnapshot: [{ slug: 'linear' }] })],
    })
    const managed = buildSession('midstream-source-queue')
    managed.enabledSourceSlugs = []
    managed.agent = { getActiveSourceSlugs: () => [] } as never

    const resolution = (sm as unknown as {
      resolveLabelSkillAnchorsForSession(session: unknown): unknown
    }).resolveLabelSkillAnchorsForSession(managed)
    const missing = (sm as unknown as {
      getUnpreparedLabelSkillSourceSlugs(session: unknown, resolution: unknown): string[]
    }).getUnpreparedLabelSkillSourceSlugs(managed, resolution)

    expect(missing).toEqual(['linear'])
  })

  it('allows mid-stream label-skill steering when required sources are already live', () => {
    writeBindings({
      version: 1,
      bindings: [binding({ requiredSourcesSnapshot: [{ slug: 'linear' }] })],
    })
    const managed = buildSession('midstream-source-ready')
    managed.enabledSourceSlugs = ['linear']
    managed.agent = { getActiveSourceSlugs: () => ['linear'] } as never

    const resolution = (sm as unknown as {
      resolveLabelSkillAnchorsForSession(session: unknown): unknown
    }).resolveLabelSkillAnchorsForSession(managed)
    const missing = (sm as unknown as {
      getUnpreparedLabelSkillSourceSlugs(session: unknown, resolution: unknown): string[]
    }).getUnpreparedLabelSkillSourceSlugs(managed, resolution)

    expect(missing).toEqual([])
  })
})
