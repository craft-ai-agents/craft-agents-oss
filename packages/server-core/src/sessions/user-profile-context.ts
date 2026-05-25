import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config'

export interface UserProfile {
  name?: string
  oneStopId?: string
  group?: string
  department?: string
  ownedModules?: string[]
  ownedTopics?: string[]
}

/** Cached profile data and the time it was last refreshed successfully. */
export interface UserProfileCacheEntry {
  profile: UserProfile
  fetchedAt: number
}

/** Redacted persisted reference to profile context sent with a message. */
export interface DynamicContextRef {
  type: 'user_profile'
  status: 'fresh' | 'stale'
  fetchedAt: number
  summary: string
}

/** Expanded transient context plus the redacted reference safe for persistence. */
export interface LoadedUserProfileContext {
  dynamicContext: string
  ref: DynamicContextRef
  stale: boolean
}

/** Boundary for loading the current authenticated user's profile. */
export interface UserProfileProvider {
  fetchUserProfile(): Promise<UserProfile | null>
}

/** Dependencies and runtime options for loading dynamic user profile context. */
export interface UserProfileContextManagerOptions {
  provider?: UserProfileProvider
  cachePath?: string
  enabled?: boolean
  now?: () => number
  loadCache?: () => Promise<UserProfileCacheEntry | null>
  saveCache?: (entry: UserProfileCacheEntry) => Promise<void>
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_CACHE_PATH = join(CONFIG_DIR, 'user-profile-cache.json')

function compactList(values: string[] | undefined): string | undefined {
  const cleaned = (values ?? []).map(v => v.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(', ') : undefined
}

export function hasProfileContent(profile: UserProfile | null | undefined): profile is UserProfile {
  return !!profile && !!(
    profile.name ||
    profile.oneStopId ||
    profile.group ||
    profile.department ||
    compactList(profile.ownedModules) ||
    compactList(profile.ownedTopics)
  )
}

export function sanitizeProfile(profile: UserProfile): UserProfile {
  return {
    name: profile.name?.trim() || undefined,
    oneStopId: profile.oneStopId?.trim() || undefined,
    group: profile.group?.trim() || undefined,
    department: profile.department?.trim() || undefined,
    ownedModules: (profile.ownedModules ?? []).map(v => v.trim()).filter(Boolean),
    ownedTopics: (profile.ownedTopics ?? []).map(v => v.trim()).filter(Boolean),
  }
}

function escapeContextValue(value: string): string {
  return value.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]!))
}

/** Builds the redacted human-readable profile summary stored with messages. */
export function summarizeUserProfileRef(profile: UserProfile, stale: boolean): string {
  const summary = hasProfileContent(profile) ? 'User profile context available' : 'User profile'
  return stale ? `${summary}; stale profile cache` : summary
}

/** Formats the compact profile block injected into transient model input. */
export function formatUserProfileDynamicContext(input: {
  profile: UserProfile
  fetchedAt: number
  stale: boolean
}): string {
  const profile = sanitizeProfile(input.profile)
  const lines: string[] = [
    `<user_profile freshness="${input.stale ? 'stale' : 'fresh'}" fetchedAt="${new Date(input.fetchedAt).toISOString()}">`,
  ]

  if (input.stale) {
    lines.push('Cached profile is stale because the latest refresh failed. Treat fields as potentially outdated.')
  }

  const fields: Array<[string, string | undefined]> = [
    ['Name', profile.name],
    ['One-stop ID', profile.oneStopId],
    ['Group', profile.group],
    ['Department', profile.department],
    ['Owned modules', compactList(profile.ownedModules)],
    ['Owned topics', compactList(profile.ownedTopics)],
  ]

  for (const [label, value] of fields) {
    if (value) {
      lines.push(`${label}: ${escapeContextValue(value)}`)
    }
  }

  lines.push('Instruction: Use this profile only to resolve user context. Do not reveal the one-stop ID in normal replies.')
  lines.push('</user_profile>')
  return lines.join('\n')
}

/** Loads user profile data from the configured profile JSON source. */
export class FileUserProfileProvider implements UserProfileProvider {
  constructor(private readonly profilePath = process.env.CRAFT_USER_PROFILE_PATH ?? join(CONFIG_DIR, 'user-profile.json')) {}

  async fetchUserProfile(): Promise<UserProfile | null> {
    const inline = process.env.CRAFT_USER_PROFILE_JSON
    if (inline) {
      return sanitizeProfile(JSON.parse(inline) as UserProfile)
    }

    if (!existsSync(this.profilePath)) {
      return null
    }

    return sanitizeProfile(JSON.parse(readFileSync(this.profilePath, 'utf-8')) as UserProfile)
  }
}

/** Loads fresh or stale cached user profile context for message sends. */
export class UserProfileContextManager {
  private readonly provider: UserProfileProvider
  private readonly cachePath: string
  private readonly enabled: boolean
  private readonly now: () => number
  private readonly loadCacheFn?: () => Promise<UserProfileCacheEntry | null>
  private readonly saveCacheFn?: (entry: UserProfileCacheEntry) => Promise<void>

  constructor(options: UserProfileContextManagerOptions = {}) {
    this.provider = options.provider ?? new FileUserProfileProvider()
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH
    this.enabled = options.enabled ?? process.env.CRAFT_USER_PROFILE_CONTEXT_ENABLED !== 'false'
    this.now = options.now ?? (() => Date.now())
    this.loadCacheFn = options.loadCache
    this.saveCacheFn = options.saveCache
  }

  async load(): Promise<LoadedUserProfileContext | null> {
    if (!this.enabled) return null

    try {
      const profile = sanitizeProfile(await this.provider.fetchUserProfile() ?? {})
      if (hasProfileContent(profile)) {
        const entry = { profile, fetchedAt: this.now() }
        await this.saveCache(entry)
        return this.buildContext(entry, false)
      }
    } catch {
      // Fall through to cache fallback.
    }

    const cached = await this.loadCache()
    if (!cached || this.now() - cached.fetchedAt > SEVEN_DAYS_MS || !hasProfileContent(cached.profile)) {
      return null
    }

    return this.buildContext(cached, true)
  }

  private buildContext(entry: UserProfileCacheEntry, stale: boolean): LoadedUserProfileContext {
    const profile = sanitizeProfile(entry.profile)
    return {
      dynamicContext: formatUserProfileDynamicContext({
        profile,
        fetchedAt: entry.fetchedAt,
        stale,
      }),
      ref: {
        type: 'user_profile',
        status: stale ? 'stale' : 'fresh',
        fetchedAt: entry.fetchedAt,
        summary: summarizeUserProfileRef(profile, stale),
      },
      stale,
    }
  }

  private async loadCache(): Promise<UserProfileCacheEntry | null> {
    if (this.loadCacheFn) return this.loadCacheFn()
    if (!existsSync(this.cachePath)) return null
    return JSON.parse(readFileSync(this.cachePath, 'utf-8')) as UserProfileCacheEntry
  }

  private async saveCache(entry: UserProfileCacheEntry): Promise<void> {
    if (this.saveCacheFn) {
      await this.saveCacheFn(entry)
      return
    }
    mkdirSync(dirname(this.cachePath), { recursive: true })
    writeFileSync(this.cachePath, JSON.stringify(entry, null, 2), 'utf-8')
  }
}
