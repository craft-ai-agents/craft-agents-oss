/**
 * Hook Security Utilities
 *
 * Shell input sanitization and safety checks for command hooks.
 */

// Characters that could be used for shell injection
const DANGEROUS_CHARS = /[;&|`$(){}[\]!<>\\]/g;

/**
 * Sanitize a string for safe use in shell commands.
 * Removes or escapes dangerous characters that could enable injection.
 *
 * Use this when interpolating event data into command strings.
 */
export function sanitizeForShell(input: string): string {
  // Replace dangerous characters with underscores
  return input.replace(DANGEROUS_CHARS, '_');
}

/**
 * Check if a command string contains potentially dangerous patterns.
 * Returns an array of warning messages.
 */
export function checkCommandSafety(command: string): string[] {
  const warnings: string[] = [];

  // Check for common dangerous patterns
  if (/rm\s+(-rf?|--recursive)\s/.test(command)) {
    warnings.push('Command contains recursive delete (rm -rf)');
  }

  if (/>\s*\/dev\//.test(command)) {
    warnings.push('Command writes to device files');
  }

  if (/chmod\s+777/.test(command)) {
    warnings.push('Command sets world-writable permissions');
  }

  if (/curl.*\|\s*(sh|bash)/.test(command)) {
    warnings.push('Command pipes remote content to shell');
  }

  if (/eval\s/.test(command)) {
    warnings.push('Command uses eval');
  }

  return warnings;
}

/**
 * Validate that a command is within acceptable bounds.
 * Returns null if valid, or an error message if not.
 */
export function validateCommand(command: string): string | null {
  if (!command || command.trim().length === 0) {
    return 'Command is empty';
  }

  if (command.length > 10_000) {
    return 'Command exceeds maximum length (10,000 characters)';
  }

  return null;
}
