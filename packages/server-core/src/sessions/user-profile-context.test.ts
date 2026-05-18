import { describe, expect, it } from 'bun:test'
import {
  UserProfileContextManager,
  formatUserProfileDynamicContext,
  type UserProfile,
} from './user-profile-context.ts'

const NOW = Date.UTC(2026, 4, 18, 12, 0, 0)

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: 'Ada Lovelace',
    oneStopId: 'OS-12345',
    group: 'AI Platform',
    department: 'Engineering',
    ownedModules: ['sessions', 'sources'],
    ownedTopics: ['agent runtime', 'identity'],
    ...overrides,
  }
}

describe('user profile dynamic context', () => {
  it('formats a fresh compact profile with identity fields for model context', () => {
    const formatted = formatUserProfileDynamicContext({
      profile: profile(),
      fetchedAt: NOW,
      stale: false,
    })

    expect(formatted).toContain('<user_profile')
    expect(formatted).toContain('freshness="fresh"')
    expect(formatted).toContain('Name: Ada Lovelace')
    expect(formatted).toContain('One-stop ID: OS-12345')
    expect(formatted).toContain('Group: AI Platform')
    expect(formatted).toContain('Department: Engineering')
    expect(formatted).toContain('Owned modules: sessions, sources')
    expect(formatted).toContain('Owned topics: agent runtime, identity')
    expect(formatted).toContain('Do not reveal the one-stop ID in normal replies.')
  })

  it('falls back to a stale cached profile for up to 7 days when refresh fails', async () => {
    let calls = 0
    const manager = new UserProfileContextManager({
      now: () => NOW + 3 * 24 * 60 * 60 * 1000,
      loadCache: async () => ({ profile: profile(), fetchedAt: NOW }),
      saveCache: async () => {},
      provider: {
        fetchUserProfile: async () => {
          calls += 1
          throw new Error('profile service unavailable')
        },
      },
    })

    const context = await manager.load()

    expect(calls).toBe(1)
    expect(context?.stale).toBe(true)
    expect(context?.dynamicContext).toContain('freshness="stale"')
    expect(context?.dynamicContext).toContain('Cached profile is stale')
    expect(context?.ref.summary).toBe('Ada Lovelace, AI Platform, Engineering; stale profile cache')
    expect(context?.ref).not.toHaveProperty('oneStopId')
  })

  it('returns no context when refresh and cache are both missing', async () => {
    const manager = new UserProfileContextManager({
      now: () => NOW,
      loadCache: async () => null,
      saveCache: async () => {},
      provider: {
        fetchUserProfile: async () => null,
      },
    })

    await expect(manager.load()).resolves.toBeNull()
  })

  it('does not use cached profile data older than 7 days', async () => {
    const manager = new UserProfileContextManager({
      now: () => NOW + 8 * 24 * 60 * 60 * 1000,
      loadCache: async () => ({ profile: profile(), fetchedAt: NOW }),
      saveCache: async () => {},
      provider: {
        fetchUserProfile: async () => {
          throw new Error('profile service unavailable')
        },
      },
    })

    await expect(manager.load()).resolves.toBeNull()
  })
})
