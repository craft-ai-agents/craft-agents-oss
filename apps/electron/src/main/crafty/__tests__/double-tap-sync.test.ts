import { describe, expect, it } from 'bun:test'
import { afterTapRefused } from '../double-tap-sync'

describe('afterTapRefused', () => {
  it('waits while Craft Agents has no Accessibility', () => {
    expect(afterTapRefused({ mainTrusted: false, restarted: false, busy: false })).toEqual({ action: 'wait', restarted: false })
  })

  it('replaces the helper once the main process sees a grant the helper missed', () => {
    expect(afterTapRefused({ mainTrusted: true, restarted: false, busy: false })).toEqual({ action: 'restart', restarted: true })
  })

  it('restarts once per grant, not at every check', () => {
    expect(afterTapRefused({ mainTrusted: true, restarted: true, busy: false })).toEqual({ action: 'wait', restarted: true })
  })

  it('leaves the helper alone while the pie or panel uses it, and restarts at a later check', () => {
    expect(afterTapRefused({ mainTrusted: true, restarted: false, busy: true })).toEqual({ action: 'wait', restarted: false })
    expect(afterTapRefused({ mainTrusted: true, restarted: false, busy: false }).action).toBe('restart')
  })

  it('gives the next grant its own restart after access went away', () => {
    const revoked = afterTapRefused({ mainTrusted: false, restarted: true, busy: false })
    expect(revoked.restarted).toBe(false)
    expect(afterTapRefused({ mainTrusted: true, restarted: revoked.restarted, busy: false }).action).toBe('restart')
  })
})
