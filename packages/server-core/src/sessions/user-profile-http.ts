import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config'
import { UserProfile, UserProfileProvider, sanitizeProfile, hasProfileContent } from './user-profile-context'

/**
 * Fetches user profile data from a remote HTTP API, validates it,
 * and writes the result to the local user-profile.json file.
 */
export class HttpUserProfileProvider implements UserProfileProvider {
  private readonly apiUrl: string
  private readonly fetchFn: typeof fetch
  private readonly profilePath: string

  constructor(options: HttpUserProfileProviderOptions = {}) {
    this.apiUrl = options.apiUrl ?? process.env.CRAFT_USER_PROFILE_API_URL ?? 'http://localhost:3099/api/user/profile'
    this.fetchFn = options.fetchFn ?? globalThis.fetch
    this.profilePath = options.profilePath ?? process.env.CRAFT_USER_PROFILE_PATH ?? join(CONFIG_DIR, 'user-profile.json')
  }

  async fetchUserProfile(): Promise<UserProfile | null> {
    const response = await this.fetchFn(this.apiUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: failed to fetch user profile from ${this.apiUrl}`)
    }

    const raw: unknown = await response.json()
    const profile = sanitizeProfile(raw as UserProfile)

    if (!hasProfileContent(profile)) {
      return null
    }

    this.writeToFile(profile)
    return profile
  }

  private writeToFile(profile: UserProfile): void {
    mkdirSync(dirname(this.profilePath), { recursive: true })
    writeFileSync(this.profilePath, JSON.stringify(profile, null, 2), 'utf-8')
  }
}

export interface HttpUserProfileProviderOptions {
  apiUrl?: string
  fetchFn?: typeof fetch
  profilePath?: string
}

/**
 * Reads the current user-profile.json from disk and returns it.
 * Does not trigger any network request.
 */
export function readLocalUserProfile(profilePath?: string): UserProfile | null {
  const path = profilePath ?? process.env.CRAFT_USER_PROFILE_PATH ?? join(CONFIG_DIR, 'user-profile.json')
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as UserProfile
  const profile = sanitizeProfile(raw)
  return hasProfileContent(profile) ? profile : null
}

/**
 * Periodic refresh loop that fetches the user profile from an HTTP API
 * on a configurable interval.
 */
export class UserProfileRefreshLoop {
  private readonly provider: HttpUserProfileProvider
  private readonly intervalMs: number
  private readonly onError?: (error: unknown) => void
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: UserProfileRefreshLoopOptions) {
    this.provider = options.provider
    this.intervalMs = options.intervalMs ?? (Number(process.env.CRAFT_USER_PROFILE_REFRESH_MS) || 43_200_000)
    this.onError = options.onError
  }

  /** Start the refresh loop. Fires an immediate first fetch. */
  start(): void {
    this.refresh().catch(() => {})
    this.timer = setInterval(() => {
      this.refresh().catch(() => {})
    }, this.intervalMs)
  }

  /** Stop the refresh loop. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Trigger a single manual refresh. Returns the fetched profile or null. */
  async refresh(): Promise<UserProfile | null> {
    try {
      return await this.provider.fetchUserProfile()
    } catch (error) {
      this.onError?.(error)
      return null
    }
  }
}

export interface UserProfileRefreshLoopOptions {
  provider: HttpUserProfileProvider
  intervalMs?: number
  onError?: (error: unknown) => void
}
