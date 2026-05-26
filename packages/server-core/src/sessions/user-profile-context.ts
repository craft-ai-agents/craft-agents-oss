import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config'

export interface UserProfile {
  zhaohuOpenId?: string
  userName?: string
  ystId?: string
  positon?: string
  zuName?: string
  leaderUserInfo?: string
  shiName?: string
  pathName?: string
  sex?: string
  ip?: string
  chargeModule?: UserProfileChargeModule[]
  ingProjectInfo?: unknown[]
  onlineInfo?: unknown[]
}

export interface UserProfileChargeModule {
  appCode?: string
  appName?: string
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

export function hasProfileContent(profile: UserProfile | null | undefined): profile is UserProfile {
  return !!profile && !!(
    profile.zhaohuOpenId ||
    profile.userName ||
    profile.ystId ||
    profile.positon ||
    profile.zuName ||
    profile.leaderUserInfo ||
    profile.shiName ||
    profile.pathName ||
    profile.sex ||
    profile.ip ||
    compactChargeModules(profile.chargeModule) ||
    profile.ingProjectInfo?.length ||
    profile.onlineInfo?.length
  )
}

export function sanitizeProfile(profile: unknown): UserProfile {
  const candidate = unwrapProfileEnvelope(profile)
  return {
    zhaohuOpenId: trimString(candidate.zhaohuOpenId),
    userName: trimString(candidate.userName),
    ystId: trimString(candidate.ystId),
    positon: trimString(candidate.positon),
    zuName: trimString(candidate.zuName),
    leaderUserInfo: trimString(candidate.leaderUserInfo),
    shiName: trimString(candidate.shiName),
    pathName: trimString(candidate.pathName),
    sex: trimString(candidate.sex),
    ip: trimString(candidate.ip),
    chargeModule: sanitizeChargeModules(candidate.chargeModule),
    ingProjectInfo: Array.isArray(candidate.ingProjectInfo) ? candidate.ingProjectInfo : [],
    onlineInfo: Array.isArray(candidate.onlineInfo) ? candidate.onlineInfo : [],
  }
}

function unwrapProfileEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const root = value as Record<string, unknown>
  const body = root.body
  if (body && typeof body === 'object') {
    const data = (body as Record<string, unknown>).data
    if (data && typeof data === 'object') return data as Record<string, unknown>
  }
  return root
}

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function sanitizeChargeModules(value: unknown): UserProfileChargeModule[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): UserProfileChargeModule | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      return {
        appCode: trimString(candidate.appCode),
        appName: trimString(candidate.appName),
      }
    })
    .filter((item): item is UserProfileChargeModule => !!item && !!(item.appCode || item.appName))
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
    ['User name', profile.userName],
    ['YST ID', profile.ystId],
    ['Position', profile.positon],
    ['Group name', profile.zuName],
    ['Leader user info', profile.leaderUserInfo],
    ['Office name', profile.shiName],
    ['Path name', profile.pathName],
    ['Sex', profile.sex],
    ['IP', profile.ip],
    ['Charge modules', compactChargeModules(profile.chargeModule)],
    ['In-progress project info', compactJsonList(profile.ingProjectInfo)],
    ['Online info', compactJsonList(profile.onlineInfo)],
  ]

  for (const [label, value] of fields) {
    if (value) {
      lines.push(`${label}: ${escapeContextValue(value)}`)
    }
  }

  lines.push('Instruction: Use this profile only to resolve user context. Do not reveal identity IDs or IP addresses in normal replies.')
  lines.push('</user_profile>')
  return lines.join('\n')
}

function compactChargeModules(values: UserProfileChargeModule[] | undefined): string | undefined {
  const cleaned = (values ?? [])
    .map(module => {
      if (module.appCode && module.appName) return `${module.appName} (${module.appCode})`
      return module.appName ?? module.appCode
    })
    .filter(Boolean)
  return cleaned.length ? cleaned.join(', ') : undefined
}

function compactJsonList(values: unknown[] | undefined): string | undefined {
  if (!values?.length) return undefined
  return values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(', ')
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
