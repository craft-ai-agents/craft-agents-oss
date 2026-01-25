/**
 * Sanitize sensitive credentials from error messages and logs
 *
 * This module provides utilities to prevent credential exposure in logs,
 * console output, crash reports, and debug output.
 */

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Sanitize sensitive credentials from error messages and logs.
 *
 * Replaces sensitive values with redacted versions (first 3 + last 3 chars).
 * Works on Error objects, strings, and arbitrary values.
 *
 * @param error - The error or value to sanitize
 * @param sensitiveValues - Array of sensitive strings to redact (e.g., tokens, passwords)
 * @returns Sanitized error/value with credentials redacted
 *
 * @example
 * ```typescript
 * const token = '123456:ABC-DEF1234567890'
 * const error = new Error(`Invalid token ${token}`)
 *
 * const sanitized = sanitizeError(error, [token])
 * // Error: Invalid token 123***890
 * ```
 */
export function sanitizeError(error: unknown, sensitiveValues: string[]): unknown {
  // Handle non-Error values
  if (!(error instanceof Error)) {
    // If it's a string, sanitize it
    if (typeof error === 'string') {
      let sanitized = error
      for (const value of sensitiveValues) {
        if (value && value.length > 6) {
          const redacted = `${value.slice(0, 3)}***${value.slice(-3)}`
          sanitized = sanitized.replace(new RegExp(escapeRegex(value), 'g'), redacted)
        } else if (value && value.length > 0) {
          // For short values, just show ***
          sanitized = sanitized.replace(new RegExp(escapeRegex(value), 'g'), '***')
        }
      }
      return sanitized
    }
    // For other types, return as-is
    return error
  }

  // Clone the error object to avoid mutating the original
  const sanitized = Object.create(Object.getPrototypeOf(error))
  Object.assign(sanitized, error)

  // Sanitize message
  let message = error.message
  for (const value of sensitiveValues) {
    if (value && value.length > 6) {
      const redacted = `${value.slice(0, 3)}***${value.slice(-3)}`
      message = message.replace(new RegExp(escapeRegex(value), 'g'), redacted)
    } else if (value && value.length > 0) {
      message = message.replace(new RegExp(escapeRegex(value), 'g'), '***')
    }
  }
  sanitized.message = message

  // Sanitize stack trace if present
  if (error.stack) {
    let stack = error.stack
    for (const value of sensitiveValues) {
      if (value && value.length > 6) {
        const redacted = `${value.slice(0, 3)}***${value.slice(-3)}`
        stack = stack.replace(new RegExp(escapeRegex(value), 'g'), redacted)
      } else if (value && value.length > 0) {
        stack = stack.replace(new RegExp(escapeRegex(value), 'g'), '***')
      }
    }
    sanitized.stack = stack
  }

  return sanitized
}

/**
 * Sanitize a log message or string by redacting sensitive values.
 *
 * @param message - The message to sanitize
 * @param sensitiveValues - Array of sensitive strings to redact
 * @returns Sanitized message with credentials redacted
 *
 * @example
 * ```typescript
 * const token = '123456:ABC-DEF1234567890'
 * const message = `Connecting with token: ${token}`
 *
 * const sanitized = sanitizeMessage(message, [token])
 * // "Connecting with token: 123***890"
 * ```
 */
export function sanitizeMessage(message: string, sensitiveValues: string[]): string {
  let sanitized = message
  for (const value of sensitiveValues) {
    if (value && value.length > 6) {
      const redacted = `${value.slice(0, 3)}***${value.slice(-3)}`
      sanitized = sanitized.replace(new RegExp(escapeRegex(value), 'g'), redacted)
    } else if (value && value.length > 0) {
      sanitized = sanitized.replace(new RegExp(escapeRegex(value), 'g'), '***')
    }
  }
  return sanitized
}
