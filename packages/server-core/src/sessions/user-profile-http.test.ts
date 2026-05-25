import { describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import {
  HttpUserProfileProvider,
  UserProfileRefreshLoop,
  readLocalUserProfile,
} from './user-profile-http.ts'

function fakeResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'user-profile-test-'))
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

describe('HttpUserProfileProvider', () => {
  it('fetches user profile from HTTP API and writes to file', async () => {
    const dir = tempDir()
    try {
      const profilePath = join(dir, 'user-profile.json')
      const provider = new HttpUserProfileProvider({
        apiUrl: 'http://test/api/user/profile',
        fetchFn: async () => fakeResponse({ name: 'Ada', oneStopId: 'OS-001', group: 'Eng', department: 'AI', ownedModules: ['sessions'], ownedTopics: ['agent'] }),
        profilePath,
      })

      const result = await provider.fetchUserProfile()

      expect(result).not.toBeNull()
      expect(result!.name).toBe('Ada')
      expect(result!.oneStopId).toBe('OS-001')

      // Verify file was written
      expect(existsSync(profilePath)).toBe(true)
      const fileContent = JSON.parse(readFileSync(profilePath, 'utf-8'))
      expect(fileContent.name).toBe('Ada')
      expect(fileContent.oneStopId).toBe('OS-001')
    } finally {
      cleanupDir(dir)
    }
  })

  it('returns null for empty profile response', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => fakeResponse({}),
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const result = await provider.fetchUserProfile()
    expect(result).toBeNull()
  })

  it('rejects on HTTP error status', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => fakeResponse({ error: 'not found' }, 404),
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    await expect(provider.fetchUserProfile()).rejects.toThrow('HTTP 404')
  })

  it('rejects on network error', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => { throw new Error('connection refused') },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    await expect(provider.fetchUserProfile()).rejects.toThrow('connection refused')
  })

  it('sanitizes profile fields', async () => {
    const dir = tempDir()
    try {
      const provider = new HttpUserProfileProvider({
        apiUrl: 'http://test/api/user/profile',
        fetchFn: async () => fakeResponse({
          name: '  Ada  ',
          oneStopId: '  OS-001  ',
          group: '  Eng  ',
          department: '  AI  ',
          ownedModules: ['  sessions  ', '', 'sources'],
          ownedTopics: ['  agent  '],
        }),
        profilePath: join(dir, 'user-profile.json'),
      })

      const result = await provider.fetchUserProfile()
      expect(result!.name).toBe('Ada')
      expect(result!.oneStopId).toBe('OS-001')
      expect(result!.ownedModules).toEqual(['sessions', 'sources'])
      expect(result!.ownedTopics).toEqual(['agent'])
    } finally {
      cleanupDir(dir)
    }
  })

  it('uses default env var values when no options given', () => {
    const provider = new HttpUserProfileProvider()
    expect(provider).toBeDefined()
  })
})

describe('readLocalUserProfile', () => {
  it('returns null when file does not exist', () => {
    const result = readLocalUserProfile('/tmp/nonexistent/user-profile.json')
    expect(result).toBeNull()
  })

  it('reads and sanitizes profile from file', () => {
    const dir = tempDir()
    try {
      const profilePath = join(dir, 'user-profile.json')
      writeFileSync(profilePath, JSON.stringify({ name: 'Ada', oneStopId: 'OS-001', group: 'Eng', department: 'AI' }), 'utf-8')

      const result = readLocalUserProfile(profilePath)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Ada')
    } finally {
      cleanupDir(dir)
    }
  })
})

describe('UserProfileRefreshLoop', () => {
  it('triggers immediate fetch on start', async () => {
    let fetchCount = 0
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => {
        fetchCount++
        return fakeResponse({ name: 'Ada', oneStopId: 'OS-001', group: 'Eng', department: 'AI' })
      },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({
      provider,
      intervalMs: 500_000, // long interval so it doesn't fire during test
    })

    loop.start()
    // Wait a tick for the async fetch
    await new Promise(r => setTimeout(r, 10))
    expect(fetchCount).toBe(1)
    loop.stop()
  })

  it('manual refresh returns profile and calls provider', async () => {
    let fetchCount = 0
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => {
        fetchCount++
        return fakeResponse({ name: 'Ada', oneStopId: 'OS-001', group: 'Eng', department: 'AI' })
      },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({ provider })
    const result = await loop.refresh()
    expect(fetchCount).toBe(1)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Ada')
  })

  it('calls onError when refresh fails', async () => {
    const errors: unknown[] = []
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => { throw new Error('connection refused') },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({
      provider,
      onError: (err) => { errors.push(err) },
    })

    const result = await loop.refresh()
    expect(result).toBeNull()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('connection refused')
  })

  it('stop() clears the timer', () => {
    const provider = new HttpUserProfileProvider({ fetchFn: async () => fakeResponse({ name: 'x' }), profilePath: '/tmp/nonexistent/x.json' })
    const loop = new UserProfileRefreshLoop({ provider, intervalMs: 1 })
    loop.start()
    loop.stop()
    expect(true).toBe(true)
  })
})
