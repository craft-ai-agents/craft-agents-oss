import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS, getAllChannelValues } from '../channels'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '../routing'

describe('pages RPC channels', () => {
  it('defines the channels the renderer needs', () => {
    expect(RPC_CHANNELS.pages.GET_URL).toBe('pages:getUrl')
    expect(RPC_CHANNELS.pages.LIST).toBe('pages:list')
  })

  it('registers them in the global channel list', () => {
    const all = getAllChannelValues()
    expect(all).toContain('pages:getUrl')
    expect(all).toContain('pages:list')
  })

  it('classifies them LOCAL_ONLY, not remote-eligible', () => {
    // Pages are served by a loopback listener on the machine that owns the
    // workspace. On a thin client the remote's 127.0.0.1 URL is unreachable, so
    // proxying these would hand back an address that cannot load. Craft Pages
    // is explicitly unsupported for remote workspaces (ADR 0001 §9) — LOCAL_ONLY
    // makes that fail cleanly instead of silently returning a dead URL.
    for (const ch of [RPC_CHANNELS.pages.GET_URL, RPC_CHANNELS.pages.LIST]) {
      expect(LOCAL_ONLY_CHANNELS.has(ch)).toBe(true)
      expect(REMOTE_ELIGIBLE_CHANNELS.has(ch)).toBe(false)
    }
  })
})
