/**
 * Mode Types and Constants
 *
 * Pure types and UI configuration for permission modes.
 * This file has NO runtime dependencies - safe for browser bundling.
 *
 * For runtime mode management functions, use './mode-manager.ts'
 */

import { z } from 'zod';

// ============================================================
// Permission Mode Types
// ============================================================

/**
 * Available permission modes
 * - 'safe': Read-only, blocks writes, never prompts (green)
 * - 'ask': Prompts for dangerous operations (amber)
 * - 'allow-all': Everything allowed, no prompts (violet)
 */
export type PermissionMode = 'safe' | 'ask' | 'allow-all';

/**
 * Order of modes for cycling with SHIFT+TAB
 */
export const PERMISSION_MODE_ORDER: PermissionMode[] = ['safe', 'ask', 'allow-all'];

// ============================================================
// Permissions Config Types (Browser-safe Zod schemas)
// ============================================================

/**
 * API endpoint rule - method + path pattern
 */
const ApiEndpointRuleSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().describe('Regex pattern for API path'),
  comment: z.string().optional(),
});

export type ApiEndpointRule = z.infer<typeof ApiEndpointRuleSchema>;

/**
 * Pattern with optional comment
 */
const PatternSchema = z.union([
  z.string(),
  z.object({
    pattern: z.string(),
    comment: z.string().optional(),
  }),
]);

/**
 * Permissions JSON configuration schema
 */
export const PermissionsConfigSchema = z.object({
  /** Additional tools to block (supports plain strings or { pattern, comment } objects) */
  blockedTools: z.array(PatternSchema).optional(),
  /** Bash command patterns to allow (regex strings) */
  allowedBashPatterns: z.array(PatternSchema).optional(),
  /** MCP tool patterns to allow (regex strings) */
  allowedMcpPatterns: z.array(PatternSchema).optional(),
  /** API endpoint rules - method + path pattern */
  allowedApiEndpoints: z.array(ApiEndpointRuleSchema).optional(),
  /** File paths to allow writes in Explore mode (glob patterns) */
  allowedWritePaths: z.array(PatternSchema).optional(),
});

export type PermissionsConfigFile = z.infer<typeof PermissionsConfigSchema>;

// ============================================================
// Mode Config Types
// ============================================================

/**
 * Compiled API endpoint rule for runtime checking
 */
export interface CompiledApiEndpointRule {
  method: string;
  pathPattern: RegExp;
}

/**
 * Safe mode configuration - defines behavior for read-only mode
 */
export interface ModeConfig {
  /** Tools that are always blocked in safe mode (Write, Edit, etc.) */
  blockedTools: Set<string>;
  /** Tools blocked via permissions.json only - used in ask/allow-all modes */
  customBlockedTools?: Set<string>;
  /** Read-only Bash command patterns (commands matching these are allowed) */
  readOnlyBashPatterns: RegExp[];
  /** Read-only MCP patterns (tools matching these are allowed) */
  readOnlyMcpPatterns: RegExp[];
  /** Fine-grained API endpoint rules (method + path pattern) */
  allowedApiEndpoints: CompiledApiEndpointRule[];
  /** File paths allowed for writes in Explore mode (glob patterns) */
  allowedWritePaths?: string[];
  /** User-friendly name */
  displayName: string;
  /** Keyboard shortcut hint */
  shortcutHint: string;
}

// ============================================================
// Safe Mode Configuration (Browser-safe - pure data)
// ============================================================

/**
 * Minimal fallback configuration for safe mode.
 *
 * The actual patterns are loaded from ~/.craft-agent/permissions/default.json
 * at runtime by PermissionsConfigCache. This fallback ensures the app works
 * even if the JSON file is missing or invalid.
 *
 * To customize allowed commands, edit ~/.craft-agent/permissions/default.json
 */
export const SAFE_MODE_CONFIG: ModeConfig = {
  // Tools that are always blocked (no read-only variant) - these are hardcoded
  // as they represent fundamental write operations that should never be allowed
  // in Explore mode regardless of user configuration
  blockedTools: new Set([
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
  ]),
  // Empty fallbacks - actual patterns loaded from default.json
  // If default.json is missing, no bash commands will be auto-allowed in Explore mode
  readOnlyBashPatterns: [],
  readOnlyMcpPatterns: [],
  allowedApiEndpoints: [],
  displayName: 'Safe Mode',
  shortcutHint: 'SHIFT+TAB',
};

/**
 * Display configuration for each mode
 */
export const PERMISSION_MODE_CONFIG: Record<PermissionMode, {
  displayName: string;
  shortName: string;
  description: string;
  /** SVG path data for the icon (viewBox 0 0 24 24, stroke-based) */
  svgPath: string;
  /** Tailwind color classes for consistent theming */
  colorClass: {
    /** Text color class (e.g., 'text-info') */
    text: string;
    /** Background color class (e.g., 'bg-info') */
    bg: string;
    /** Border color class (e.g., 'border-info') */
    border: string;
  };
}> = {
  'safe': {
    displayName: 'Explore',
    shortName: 'Explore',
    description: 'Read-only exploration. Blocks writes, never prompts.',
    // Compass icon from Lucide
    svgPath: 'M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
    colorClass: {
      text: 'text-foreground/60',
      bg: 'bg-foreground/60',
      border: 'border-foreground/60',
    },
  },
  'ask': {
    displayName: 'Ask to Edit',
    shortName: 'Ask',
    description: 'Prompts before making edits.',
    // Info icon from Lucide
    svgPath: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4m0 4h.01',
    colorClass: {
      text: 'text-info',
      bg: 'bg-info',
      border: 'border-info',
    },
  },
  'allow-all': {
    displayName: 'Auto',
    shortName: 'Auto',
    description: 'Automatic execution, no prompts.',
    // Repeat icon from Lucide (loop)
    svgPath: 'm17 1 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    colorClass: {
      text: 'text-accent',
      bg: 'bg-accent',
      border: 'border-accent',
    },
  },
};
