import { appendFileSync } from 'fs';

const LOG_FILE = '/tmp/craft-debug.log';

let debugEnabled = false;

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
 * Debug logging utility that writes to a file for viewing with `tail -f`.
 * Only logs when debug mode is enabled via --debug flag.
 */
export function debug(message: string, ...args: unknown[]): void {
  if (!debugEnabled) return;

  const timestamp = new Date().toISOString();
  const formatted = args.length > 0
    ? `${timestamp} ${message} ${args.map(a =>
        typeof a === 'object' ? JSON.stringify(a) : String(a)
      ).join(' ')}\n`
    : `${timestamp} ${message}\n`;

  try {
    appendFileSync(LOG_FILE, formatted);
  } catch {
    // Silently ignore if we can't write to the log file
  }
}
