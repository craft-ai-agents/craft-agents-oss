/**
 * Headless PlatformServices — runs under Bun without Electron.
 *
 * Uses sharp for image processing, console for logging.
 * GUI-only methods (openPath, openExternal, quit, etc.) are left undefined —
 * handlers guard them with optional chaining and capabilities handle client-side ops.
 */

import { join } from 'path'
import type { PlatformServices, Logger } from './platform'
import { resolveInheritedAppEnv, sourceCheckoutRoot } from './inherited-app-env'
import { ensureDecodableImage } from '../services/heic'

/**
 * Simple console-based logger matching the Logger interface.
 * Prefixes each line with ISO timestamp and level for structured grepping.
 */
function createConsoleLogger(): Logger {
  const fmt = (level: string, args: unknown[]) => {
    const ts = new Date().toISOString()
    const parts = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    return `${ts} ${level.toUpperCase().padEnd(5)} ${parts}`
  }
  return {
    info: (...args) => console.log(fmt('info', args)),
    warn: (...args) => console.warn(fmt('warn', args)),
    error: (...args) => console.error(fmt('error', args)),
    debug: (...args) => {
      if (process.env.CRAFT_DEBUG === 'true' || process.env.CRAFT_IS_PACKAGED !== 'true') {
        console.debug(fmt('debug', args))
      }
    },
  }
}

/**
 * Create PlatformServices for headless (Bun) mode.
 *
 * Environment variables:
 * - CRAFT_APP_ROOT — override appRootPath (default: cwd). Ignored, together with every CRAFT_*
 *   path inside it, when this server runs from a source checkout and the value points into
 *   another one: that is a running Craft app's root inherited through an agent shell
 *   (see inherited-app-env.ts).
 * - CRAFT_RESOURCES_PATH — override resourcesPath (default: cwd/resources)
 * - CRAFT_IS_PACKAGED — 'true' for production (default: false)
 * - CRAFT_VERSION — app version string (default: '0.0.0-dev')
 * - CRAFT_DEBUG — 'true' to enable debug logging
 */
export function createHeadlessPlatform(options?: { appVersion?: string }): PlatformServices {
  const logger = createConsoleLogger()
  const sourceRoot = sourceCheckoutRoot()
  const inherited = resolveInheritedAppEnv(process.env, sourceRoot, process.cwd())
  if (inherited.ignoredAppRoot) {
    for (const key of inherited.dropKeys) delete process.env[key]
    logger.warn(
      `Ignoring CRAFT_APP_ROOT=${inherited.ignoredAppRoot}: it points outside this server's checkout (${sourceRoot}), ` +
      `most likely inherited from a running Craft app. Dropped: ${inherited.dropKeys.join(', ')}. Using ${inherited.appRootPath}.`,
    )
  }
  // Republish so tools this server spawns (agent shells, scripts) resolve the same root.
  process.env.CRAFT_APP_ROOT = inherited.appRootPath
  // A server running from source is never packaged, whatever an inherited env says (the packaged
  // app exports CRAFT_IS_PACKAGED, which resolveScriptRuntime also reads from the env).
  if (sourceRoot && (process.env.CRAFT_IS_PACKAGED === 'true' || process.env.CRAFT_IS_PACKAGED === '1')) {
    logger.warn(`Ignoring CRAFT_IS_PACKAGED=${process.env.CRAFT_IS_PACKAGED}: this server runs from the source checkout ${sourceRoot}.`)
    process.env.CRAFT_IS_PACKAGED = 'false'
  }
  const isPackaged = !sourceRoot && process.env.CRAFT_IS_PACKAGED === 'true'
  const isDebugMode = process.env.CRAFT_DEBUG === 'true' || !isPackaged

  return {
    appRootPath: inherited.appRootPath,
    resourcesPath: process.env.CRAFT_RESOURCES_PATH || join(process.cwd(), 'resources'),
    isPackaged,
    appVersion: process.env.CRAFT_VERSION || options?.appVersion || '0.0.0-dev',

    imageProcessor: {
      async getMetadata(buffer) {
        const sharp = (await import('sharp')).default
        const decodable = await ensureDecodableImage(buffer)
        const m = await sharp(decodable).metadata().catch(() => null)
        return (m?.width && m?.height) ? { width: m.width, height: m.height } : null
      },
      async process(input, opts = {}) {
        const sharp = (await import('sharp')).default
        const decodable = await ensureDecodableImage(input)
        let pipeline = sharp(decodable)
        if (opts.resize) {
          pipeline = pipeline.resize(opts.resize.width, opts.resize.height, {
            fit: opts.fit ?? 'inside',
          })
        }
        if (opts.format === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: opts.quality ?? 90 })
        } else {
          pipeline = pipeline.png()
        }
        return pipeline.toBuffer()
      },
    },

    logger,
    isDebugMode,

    captureError: (err) => {
      logger.error('[captureError]', err.message, err.stack)
    },

    // GUI methods intentionally undefined — headless mode.
    // Handlers guard these with optional chaining (?.) or capability routing.
    // openPath, openExternal, showItemInFolder, quit, systemDarkMode → undefined
  }
}
