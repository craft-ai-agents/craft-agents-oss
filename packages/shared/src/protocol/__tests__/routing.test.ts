import { describe, test, expect } from 'bun:test'
import { getAllChannelValues, RPC_CHANNELS } from '../channels'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '../routing'

describe('channel routing exhaustiveness', () => {
  const all = getAllChannelValues()

  test('every channel is classified exactly once', () => {
    for (const ch of all) {
      const inLocal = LOCAL_ONLY_CHANNELS.has(ch)
      const inRemote = REMOTE_ELIGIBLE_CHANNELS.has(ch)

      if (!inLocal && !inRemote) {
        throw new Error(`Channel "${ch}" is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE. Add it to one set in routing.ts.`)
      }
      if (inLocal && inRemote) {
        throw new Error(`Channel "${ch}" is in BOTH LOCAL_ONLY and REMOTE_ELIGIBLE. It must be in exactly one.`)
      }
    }
  })

  test('no extra channels in LOCAL_ONLY', () => {
    for (const ch of LOCAL_ONLY_CHANNELS) {
      expect(all).toContain(ch)
    }
  })

  test('no extra channels in REMOTE_ELIGIBLE', () => {
    for (const ch of REMOTE_ELIGIBLE_CHANNELS) {
      expect(all).toContain(ch)
    }
  })

  test('sets are non-empty', () => {
    expect(LOCAL_ONLY_CHANNELS.size).toBeGreaterThan(0)
    expect(REMOTE_ELIGIBLE_CHANNELS.size).toBeGreaterThan(0)
  })

  test('total classified equals total channels', () => {
    expect(LOCAL_ONLY_CHANNELS.size + REMOTE_ELIGIBLE_CHANNELS.size).toBe(all.length)
  })
})

describe('channel routing behavior', () => {
  test('LOCAL_ONLY and REMOTE_ELIGIBLE have zero intersection', () => {
    const intersection: string[] = []
    for (const ch of LOCAL_ONLY_CHANNELS) {
      if (REMOTE_ELIGIBLE_CHANNELS.has(ch)) {
        intersection.push(ch)
      }
    }
    expect(intersection).toEqual([])
  })

  test('all server:* channels are REMOTE_ELIGIBLE', () => {
    const serverChannels = Object.values(RPC_CHANNELS.server)
    expect(serverChannels.length).toBeGreaterThan(0)

    for (const ch of serverChannels) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
    }
  })

  test('no LOCAL_ONLY channel starts with server:', () => {
    for (const ch of LOCAL_ONLY_CHANNELS) {
      if (ch.startsWith('server:')) {
        throw new Error(`server:* channel "${ch}" must be REMOTE_ELIGIBLE, not LOCAL_ONLY`)
      }
    }
  })
})

describe('Rox Cloud onboarding routing', () => {
  const ROX_CLOUD_CHANNELS = [
    RPC_CHANNELS.onboarding.START_ROX_CONNECT,
    RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE,
    RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD,
  ]

  test('keeps desktop-wide credential flows local', () => {
    for (const channel of ROX_CLOUD_CHANNELS) {
      expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(true)
      expect(REMOTE_ELIGIBLE_CHANNELS.has(channel)).toBe(false)
    }
  })
})

describe('knowledge channel routing (P1+P3+P4+P5)', () => {
  const REMOTE_READ_CHANNELS = [
    RPC_CHANNELS.knowledge.LIST_CONNECTIONS,
    RPC_CHANNELS.knowledge.CAPABILITIES,
    RPC_CHANNELS.knowledge.SEARCH,
    RPC_CHANNELS.knowledge.GET,
    RPC_CHANNELS.knowledge.GET_CONTEXT,
    RPC_CHANNELS.knowledge.GET_BACKLINKS,
    RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD,
    RPC_CHANNELS.knowledge.SNAPSHOT_CREATE,
    RPC_CHANNELS.knowledge.SNAPSHOT_GET,
    RPC_CHANNELS.knowledge.CHANGED,
  ]

  // P3 write-back (spec 05): the declared mutation-proposal lifecycle set.
  const P3_WRITE_CHANNELS = [
    RPC_CHANNELS.knowledge.PROPOSE_MUTATION,
    RPC_CHANNELS.knowledge.APPROVE_PROPOSAL,
    RPC_CHANNELS.knowledge.REJECT_PROPOSAL,
    RPC_CHANNELS.knowledge.APPLY_PROPOSAL,
    RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL,
    RPC_CHANNELS.knowledge.GET_PROPOSAL,
    RPC_CHANNELS.knowledge.LIST_PROPOSALS,
  ]

  // P5 saved views + work envelopes (K-09 / S-08).
  const P5_VIEW_CHANNELS = [
    RPC_CHANNELS.knowledge.ENVELOPE_GET,
    RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
    RPC_CHANNELS.knowledge.ENVELOPE_LIST,
    RPC_CHANNELS.knowledge.VIEWS_LIST,
    RPC_CHANNELS.knowledge.VIEW_RUN,
    RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
  ]

  const P4_MIGRATE_CHANNELS = [
    RPC_CHANNELS.knowledge.MIGRATE_NOTES,
  ]

  test('knowledge read channels and CHANGED broadcast are REMOTE_ELIGIBLE', () => {
    for (const ch of REMOTE_READ_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(false)
    }
  })

  test('knowledge P3 write-back proposal channels are REMOTE_ELIGIBLE', () => {
    for (const ch of P3_WRITE_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(false)
    }
  })

  test('knowledge P5 view/envelope channels are REMOTE_ELIGIBLE', () => {
    for (const ch of P5_VIEW_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(false)
    }
  })

  test('knowledge P4.4 migrateNotes is LOCAL_ONLY', () => {
    for (const ch of P4_MIGRATE_CHANNELS) {
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(true)
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(false)
    }
  })

  test('knowledge ENGINE_STATUS, DETECT_ENGINE and ENGINE_START are LOCAL_ONLY', () => {
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.knowledge.ENGINE_STATUS)).toBe(true)
    expect(REMOTE_ELIGIBLE_CHANNELS.has(RPC_CHANNELS.knowledge.ENGINE_STATUS)).toBe(false)
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.knowledge.DETECT_ENGINE)).toBe(true)
    expect(REMOTE_ELIGIBLE_CHANNELS.has(RPC_CHANNELS.knowledge.DETECT_ENGINE)).toBe(false)
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.knowledge.ENGINE_START)).toBe(true)
    expect(REMOTE_ELIGIBLE_CHANNELS.has(RPC_CHANNELS.knowledge.ENGINE_START)).toBe(false)
  })

  test('knowledge namespace includes ENGINE_START bootstrap (no engineStop)', () => {
    expect([...Object.keys(RPC_CHANNELS.knowledge)].sort()).toEqual([
      'APPLY_PROPOSAL',
      'APPROVE_PROPOSAL',
      'CAPABILITIES',
      'CHANGED',
      'DETECT_ENGINE',
      'ENGINE_START',
      'ENGINE_STATUS',
      'ENVELOPE_GET',
      'ENVELOPE_LIST',
      'ENVELOPE_UPSERT',
      'GET',
      'GET_BACKLINKS',
      'GET_CONTEXT',
      'GET_EXPORT_PAYLOAD',
      'GET_PROPOSAL',
      'LIST_CONNECTIONS',
      'LIST_LINKS',
      'LIST_PROPOSALS',
      'METRICS_GET',
      'MIGRATE_NOTES',
      'PROPOSE_MUTATION',
      'PUBLISH_APPLY',
      'PUBLISH_DISTILL',
      'PUBLISH_FINALIZE',
      'PUBLISH_GET_DRAFT',
      'PUBLISH_LIST',
      'PUBLISH_PREPARE',
      'PUBLISH_UPDATE_DRAFT',
      'REJECT_PROPOSAL',
      'ROLLBACK_PROPOSAL',
      'SEARCH',
      'SNAPSHOT_CREATE',
      'SNAPSHOT_GET',
      'UNWATCH',
      'VIEWS_LIST',
      'VIEW_RUN',
      'VIEW_SET_ATTRIBUTE',
      'WATCH',
    ])
    // Guard: engineStop remains out of scope (managed lifecycle).
    expect(Object.keys(RPC_CHANNELS.knowledge).some((k) => /engineStop/i.test(k))).toBe(false)
  })
})


describe('OpenClaw security data channel routing', () => {
  const DATA_CHANNELS = [
    RPC_CHANNELS.openclawRuntime.GET_STATUS,
    RPC_CHANNELS.openclawRuntime.INSTALL,
    RPC_CHANNELS.openclawRuntime.PROVISION,
    RPC_CHANNELS.openclawRuntime.START,
    RPC_CHANNELS.openclawRuntime.STOP,
    RPC_CHANNELS.securityAudit.RUN,
    RPC_CHANNELS.securityAudit.GET_LATEST,
    RPC_CHANNELS.securityAudit.ACCEPT_RISK,
    RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE,
  ]

  test('classifies every safe data operation as REMOTE_ELIGIBLE', () => {
    for (const channel of DATA_CHANNELS) {
      expect(REMOTE_ELIGIBLE_CHANNELS.has(channel)).toBe(true)
      expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(false)
    }
  })

  test('exposes exactly the declared OpenClaw data wire channels', () => {
    const openClawChannels = getAllChannelValues()
      .filter(channel => channel.startsWith('openclawRuntime:') || channel.startsWith('securityAudit:'))
      .sort()
    expect(openClawChannels).toEqual([...DATA_CHANNELS].sort())
  })
})

describe('WorkGraph routing', () => {
  test('keeps every WorkGraph channel local-only', () => {
    for (const channel of Object.values(RPC_CHANNELS.workgraph)) {
      expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(true)
      expect(REMOTE_ELIGIBLE_CHANNELS.has(channel)).toBe(false)
    }
  })
})