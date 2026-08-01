import { describe, expect, it } from 'bun:test'
import { getInitialSessionsView } from '../shell-navigation'

describe('Sessions workspace view', () => {
  it('lands on Board without choosing a global navigation route', () => {
    expect(getInitialSessionsView()).toBe('board')
  })
})
