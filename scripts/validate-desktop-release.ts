import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateDesktopReleaseConfig } from '../packages/shared/src/deployment'

export function validateProductionRelease(config: unknown, env: Record<string, string | undefined>, platform: string): void {
  const release = validateDesktopReleaseConfig(config)
  if (release.channel !== 'production') throw new Error('Production packaging requires channel=production')
  if (release.accountServerUrl !== 'https://v2.jonwork.com') throw new Error('Jonwork production account service must use https://v2.jonwork.com')
  if (!release.updatesEnabled || release.updateServerUrl !== 'https://v2.jonwork.com/desktop/updates/') {
    throw new Error('Jonwork production updates must use https://v2.jonwork.com/desktop/updates/')
  }
  if (release.sharingEnabled || release.shareServerUrl) throw new Error('Public sharing is not enabled for the v2/ERP deployment')
  if (env.CRAFT_DEV_RUNTIME || env.VITE_DEV_SERVER_URL) throw new Error('Development runtime flags are not allowed in a production release')
  // These are confidential-client credentials, not distributable public IDs.
  for (const key of ['GOOGLE_OAUTH_CLIENT_SECRET', 'SLACK_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_SECRET']) {
    if (env[key]) throw new Error(`Remove ${key} from the desktop build environment; use a server-side OAuth broker`)
  }
  if (platform === 'win32' && !env.CSC_LINK && !env.WIN_CSC_LINK && !env.CSC_NAME) throw new Error('Windows production packaging requires a signing identity')
  if (platform === 'darwin' && (!env.CSC_LINK && !env.CSC_NAME)) throw new Error('macOS production packaging requires a signing identity')
  if (platform === 'darwin' && !(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
    && !(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)) throw new Error('macOS production packaging requires notarization credentials')
}

if (import.meta.main) {
  try {
    const root = resolve(import.meta.dir, '..')
    const config = JSON.parse(readFileSync(resolve(root, 'packages/shared/src/desktop-release.json'), 'utf8'))
    const platform = process.argv.find(arg => arg.startsWith('--platform='))?.split('=')[1] ?? process.platform
    if (process.argv.includes('--production')) validateProductionRelease(config, process.env, platform)
    else validateDesktopReleaseConfig(config)
    console.log('Desktop release configuration validated. Service availability and signed-package acceptance must be verified separately.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Desktop release validation failed')
    process.exitCode = 1
  }
}
