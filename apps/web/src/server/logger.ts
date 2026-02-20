/**
 * Logger for web server - replaces the Electron electron-log based logger.
 * Uses simple console output with structured prefixes.
 */

const isDebugMode = process.env.CRAFT_DEBUG === '1' || process.env.NODE_ENV !== 'production'

function createLogger(prefix: string) {
  return {
    info: (...args: unknown[]) => console.info(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => {
      if (isDebugMode) console.debug(`[${prefix}]`, ...args)
    },
  }
}

export const serverLog = createLogger('server')
export const sessionLog = createLogger('session')
export const ipcLog = createLogger('api')
export const windowLog = createLogger('window')
export const searchLog = createLogger('search')

export { isDebugMode }

export function getLogFilePath(): string {
  return '/dev/null'
}
