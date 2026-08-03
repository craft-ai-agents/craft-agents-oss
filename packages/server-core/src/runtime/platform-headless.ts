/**
 * Headless PlatformServices — runs under Bun without Electron.
 *
 * Uses sharp for image processing, console for logging.
 * GUI-only methods (openPath, openExternal, quit, etc.) are left undefined —
 * handlers guard them with optional chaining and capabilities handle client-side ops.
 */

import { join } from 'path'
import type { PlatformServices, Logger } from './platform'

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
      if (process.env.ARCHSTUDIO_DEBUG === 'true' || process.env.ARCHSTUDIO_IS_PACKAGED !== 'true') {
        console.debug(fmt('debug', args))
      }
    },
  }
}

/**
 * Create PlatformServices for headless (Bun) mode.
 *
 * Environment variables:
 * - ARCHSTUDIO_APP_ROOT — override appRootPath (default: cwd)
 * - ARCHSTUDIO_RESOURCES_PATH — override resourcesPath (default: cwd/resources)
 * - ARCHSTUDIO_IS_PACKAGED — 'true' for production (default: false)
 * - ARCHSTUDIO_VERSION — app version string (default: '0.0.0-dev')
 * - ARCHSTUDIO_DEBUG — 'true' to enable debug logging
 */
export function createHeadlessPlatform(options?: { appVersion?: string }): PlatformServices {
  const logger = createConsoleLogger()
  const isDebugMode = process.env.ARCHSTUDIO_DEBUG === 'true' || process.env.ARCHSTUDIO_IS_PACKAGED !== 'true'

  return {
    appRootPath: process.env.ARCHSTUDIO_APP_ROOT || process.cwd(),
    resourcesPath: process.env.ARCHSTUDIO_RESOURCES_PATH || join(process.cwd(), 'resources'),
    isPackaged: process.env.ARCHSTUDIO_IS_PACKAGED === 'true',
    appVersion: process.env.ARCHSTUDIO_VERSION || options?.appVersion || '0.0.0-dev',

    imageProcessor: {
      async getMetadata(buffer) {
        const sharp = (await import('sharp')).default
        const m = await sharp(buffer).metadata().catch(() => null)
        return (m?.width && m?.height) ? { width: m.width, height: m.height } : null
      },
      async process(input, opts = {}) {
        const sharp = (await import('sharp')).default
        let pipeline = sharp(input)
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
