import { describe, it, expect } from 'bun:test'
import { actions } from '../definitions'

describe('navigation focus shortcuts', () => {
  it('stay inputSafe so mod+1/2/3 work while typing in inputs', () => {
    expect(actions['nav.focusSidebar'].defaultHotkey).toBe('mod+1')
    expect(actions['nav.focusSidebar'].inputSafe).toBe(true)

    expect(actions['nav.focusNavigator'].defaultHotkey).toBe('mod+2')
    expect(actions['nav.focusNavigator'].inputSafe).toBe(true)

    expect(actions['nav.focusChat'].defaultHotkey).toBe('mod+3')
    expect(actions['nav.focusChat'].inputSafe).toBe(true)
  })
})
