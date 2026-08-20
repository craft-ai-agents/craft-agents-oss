import { describe, expect, it } from 'bun:test'
import {
  COMPACT_VIEWPORT_WIDTH,
  WORKSPACE_ICON_RAIL_WIDTH,
  WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT,
  getTopBarLeftInset,
  shouldShowWorkspaceIconRail,
} from '../workspace-rail'

describe('shouldShowWorkspaceIconRail', () => {
  it('is hidden when the setting is disabled', () => {
    expect(shouldShowWorkspaceIconRail(false, 1200)).toBe(false)
  })

  it('is hidden below the compact viewport breakpoint', () => {
    expect(shouldShowWorkspaceIconRail(true, COMPACT_VIEWPORT_WIDTH - 1)).toBe(
      false,
    )
  })

  it('is shown at and above the compact viewport breakpoint', () => {
    expect(shouldShowWorkspaceIconRail(true, COMPACT_VIEWPORT_WIDTH)).toBe(
      true,
    )
    expect(shouldShowWorkspaceIconRail(true, 1200)).toBe(true)
  })
})

describe('getTopBarLeftInset', () => {
  it('insets the top bar by the rail width only when the rail is visible', () => {
    expect(getTopBarLeftInset(false)).toBe(0)
    expect(getTopBarLeftInset(true)).toBe(WORKSPACE_ICON_RAIL_WIDTH)
  })
})

describe('workspace selector rail event', () => {
  it('exports the shared event name used by settings and App', () => {
    expect(WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT).toBe(
      'craft-workspace-selector-rail-changed',
    )
  })
})
