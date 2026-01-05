import { appendFileSync } from 'fs';

const LOG_FILE = '/tmp/craft-debug.log';

let debugEnabled = false;

/**
 * Runtime environment detection
 */
type Environment = 'electron-main' | 'electron-renderer' | 'tui' | 'cli';

function detectEnvironment(): Environment {
  // Electron main process
  if (typeof process !== 'undefined' && (process as any).type === 'browser') {
    return 'electron-main';
  }
  // Electron renderer process
  if (typeof process !== 'undefined' && (process as any).type === 'renderer') {
    return 'electron-renderer';
  }
  // TUI (Ink-based) - set by TUI entry point
  if (typeof process !== 'undefined' && process.env.CRAFT_TUI === '1') {
    return 'tui';
  }
  // Default: CLI/scripts
  return 'cli';
}

/**
 * Enable debug logging. Call this when --debug flag is passed.
 */
export function enableDebug(): void {
  debugEnabled = true;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Format a log message with timestamp and optional scope.
 */
function formatMessage(scope: string | undefined, message: string, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const scopeStr = scope ? `[${scope}] ` : '';
  const argsStr = args.length > 0
    ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    : '';
  return `${timestamp} ${scopeStr}${message}${argsStr}\n`;
}

/**
 * Output log based on environment.
 *
 * | Environment       | Console | File |
 * |-------------------|---------|------|
 * | electron-main     | ✓       | ✓    |
 * | electron-renderer | ✓       | -    |
 * | tui               | -       | ✓    |
 * | cli               | ✓       | -    |
 */
function output(formatted: string): void {
  const env = detectEnvironment();

  // Console output (except TUI which uses stdout for Ink)
  if (env !== 'tui') {
    if (env === 'electron-renderer') {
      // Use console.log in renderer for DevTools
      console.log(formatted.trim());
    } else {
      // Use stderr in main/cli to avoid stdout interference
      process.stderr.write(formatted);
    }
  }

  // File output (TUI and Electron main)
  if (env === 'tui' || env === 'electron-main') {
    try {
      appendFileSync(LOG_FILE, formatted);
    } catch {
      // Silently ignore file write errors
    }
  }
}

/**
 * Debug logging utility that auto-routes based on environment.
 * Only logs when debug mode is enabled via --debug flag.
 *
 * Output routing:
 * - Electron main: console + file
 * - Electron renderer: console (DevTools)
 * - TUI: file only (avoids stdout/stderr interference with Ink)
 * - CLI/scripts: console only
 *
 * @example
 * debug('Processing request')
 * debug('User data', { id: 123 })
 */
export function debug(message: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  output(formatMessage(undefined, message, args));
}

/**
 * Create a scoped logger for a specific module.
 * Scope appears in brackets: [scope] message
 *
 * @example
 * const log = createLogger('agent');
 * log.debug('Starting session');
 * log.info('Connected to MCP');
 * log.error('Failed to connect', error);
 */
export function createLogger(scope: string) {
  const logWithLevel = (level: string, message: string, args: unknown[]) => {
    if (!debugEnabled) return;
    const levelStr = level.toUpperCase().padEnd(5);
    output(formatMessage(scope, `${levelStr} ${message}`, args));
  };

  return {
    debug: (message: string, ...args: unknown[]) => logWithLevel('debug', message, args),
    info: (message: string, ...args: unknown[]) => logWithLevel('info', message, args),
    warn: (message: string, ...args: unknown[]) => logWithLevel('warn', message, args),
    error: (message: string, ...args: unknown[]) => logWithLevel('error', message, args),
  };
}
