import { describe, expect, it } from 'bun:test'
import {
  getLastSkillDestination,
  getSkillDestinationRoute,
  setLastSkillDestination,
} from '../skill-navigation'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('skill-navigation', () => {
  it('defaults the Skills submenu to Local Skills on first use', () => {
    const storage = new MemoryStorage()

    expect(getLastSkillDestination(storage)).toBe('local')
    expect(getSkillDestinationRoute(storage)).toBe('skills/local')
  })

  it('remembers the last selected valid Skills destination', () => {
    const storage = new MemoryStorage()

    setLastSkillDestination(storage, 'marketplace')

    expect(getLastSkillDestination(storage)).toBe('marketplace')
    expect(getSkillDestinationRoute(storage)).toBe('skills/marketplace')
  })

  it('falls back to Local Skills for invalid persisted values', () => {
    const storage = new MemoryStorage()

    storage.setItem('craft-last-skill-destination', JSON.stringify('remote'))

    expect(getLastSkillDestination(storage)).toBe('local')
  })
})
