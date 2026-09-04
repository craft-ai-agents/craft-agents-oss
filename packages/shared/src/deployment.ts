import bundledConfig from './desktop-release.json'

export interface DesktopReleaseConfig {
  schemaVersion: 1
  channel: 'internal' | 'production'
  accountServerUrl: string
  allowCustomAccountServer: boolean
  updatesEnabled: boolean
  updateServerUrl: string
  sharingEnabled: boolean
  shareServerUrl: string
}

/** Public build configuration only. Credentials must never be added here. */
export function validateDesktopReleaseConfig(value: unknown): DesktopReleaseConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop release configuration')
  const config = value as Record<string, unknown>
  const keys = ['schemaVersion', 'channel', 'accountServerUrl', 'allowCustomAccountServer', 'updatesEnabled', 'updateServerUrl', 'sharingEnabled', 'shareServerUrl']
  if (Object.keys(config).some(key => !keys.includes(key)) || config.schemaVersion !== 1
    || !['internal', 'production'].includes(String(config.channel))) throw new Error('Unsupported desktop release configuration')
  for (const key of ['allowCustomAccountServer', 'updatesEnabled', 'sharingEnabled']) {
    if (typeof config[key] !== 'boolean') throw new Error(`Invalid release flag: ${key}`)
  }
  for (const key of ['accountServerUrl', 'updateServerUrl', 'shareServerUrl']) {
    if (typeof config[key] !== 'string') throw new Error(`Invalid release endpoint: ${key}`)
    const input = config[key] as string
    if (!input) continue
    let url: URL
    try { url = new URL(input) } catch { throw new Error(`Invalid release endpoint: ${key}`) }
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || input !== input.trim() || host === 'thecraftagents.com' || host.endsWith('.thecraftagents.com')
      || host === 'craft.do' || host.endsWith('.craft.do')
      || ['localhost', '127.0.0.1', '[::1]'].includes(host)
      || host === 'example.com' || host.endsWith('.example.com') || host.endsWith('.invalid')) {
      throw new Error(`Release endpoint must be an owned HTTPS service: ${key}`)
    }
    if (key !== 'updateServerUrl' && url.pathname !== '/') throw new Error(`Release endpoint must be a root origin: ${key}`)
  }
  if (config.channel === 'production' && !config.accountServerUrl) throw new Error('Production requires accountServerUrl')
  if (config.updatesEnabled && !config.updateServerUrl) throw new Error('Updates require updateServerUrl')
  if (config.sharingEnabled && !config.shareServerUrl) throw new Error('Sharing requires shareServerUrl')
  return Object.freeze({ ...config }) as unknown as DesktopReleaseConfig
}

export const DESKTOP_RELEASE = validateDesktopReleaseConfig(bundledConfig)

export function requireShareServerUrl(): string {
  if (!DESKTOP_RELEASE.sharingEnabled) throw new Error('当前版本未启用公开分享；请导出本地成果文件。')
  return DESKTOP_RELEASE.shareServerUrl.replace(/\/$/, '')
}
