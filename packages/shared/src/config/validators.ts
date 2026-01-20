/**
 * Config Validators
 *
 * Zod schemas and validation utilities for config files.
 * Used by agents to validate config changes before they take effect.
 *
 * Validates:
 * - config.json: Main app configuration
 * - preferences.json: User preferences
 * - sources/{slug}/config.json: Workspace-scoped source configs
 * - permissions.json: Permission rules for Explore mode
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './paths.ts';

// ============================================================
// Config Directory
// ============================================================

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

// ============================================================
// Validation Result Types
// ============================================================

export interface ValidationIssue {
  file: string;
  path: string;  // JSON path like "workspaces[0].name"
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  fixed?: string[];
}

// ============================================================
// Zod Schemas
// ============================================================

// --- config.json ---

const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  createdAt: z.number().int().positive(),
  sessionId: z.string().optional(),
  iconUrl: z.string().optional(),
});

const AuthTypeSchema = z.enum(['api_key', 'oauth_token']);

export const StoredConfigSchema = z.object({
  authType: AuthTypeSchema.optional(),
  workspaces: z.array(WorkspaceSchema).min(0),
  activeWorkspaceId: z.string().nullable(),
  activeSessionId: z.string().nullable(),
  model: z.string().optional(),
  // Note: tokenDisplay, showCost, cumulativeUsage, defaultPermissionMode removed
  // Permission mode and cyclable modes are now per-workspace in workspace config.json
});

// --- preferences.json ---

const LocationSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
});

export const UserPreferencesSchema = z.object({
  name: z.string().optional(),
  timezone: z.string().optional(),  // TODO: Could validate against IANA timezone list
  location: LocationSchema.optional(),
  language: z.string().optional(),
  notes: z.string().optional(),
  updatedAt: z.number().int().min(0).optional(),
});

// ============================================================
// Validation Functions
// ============================================================

/**
 * Convert Zod error to ValidationIssues
 */
function zodErrorToIssues(error: z.ZodError, file: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || 'root',
    message: issue.message,
    severity: 'error' as const,
  }));
}

/**
 * Validate config.json
 */
export function validateConfig(): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Check if file exists
  if (!existsSync(CONFIG_FILE)) {
    return {
      valid: false,
      errors: [{
        file: 'config.json',
        path: '',
        message: 'Config file does not exist',
        severity: 'error',
        suggestion: 'Run setup to create initial configuration',
      }],
      warnings: [],
    };
  }

  // Parse JSON
  let content: unknown;
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    content = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file: 'config.json',
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = StoredConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, 'config.json'));
  } else {
    const config = result.data;

    // Semantic validations
    if (config.activeWorkspaceId && config.workspaces.length > 0) {
      const activeExists = config.workspaces.some(w => w.id === config.activeWorkspaceId);
      if (!activeExists) {
        errors.push({
          file: 'config.json',
          path: 'activeWorkspaceId',
          message: `Active workspace ID '${config.activeWorkspaceId}' does not exist in workspaces array`,
          severity: 'error',
          suggestion: 'Set activeWorkspaceId to an existing workspace ID or null',
        });
      }
    }

  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate preferences.json
 */
export function validatePreferences(): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Check if file exists (preferences are optional)
  if (!existsSync(PREFERENCES_FILE)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'preferences.json',
        path: '',
        message: 'Preferences file does not exist (using defaults)',
        severity: 'warning',
      }],
    };
  }

  // Parse JSON
  let content: unknown;
  try {
    const raw = readFileSync(PREFERENCES_FILE, 'utf-8');
    content = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file: 'preferences.json',
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = UserPreferencesSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, 'preferences.json'));
  } else {
    const prefs = result.data;

    // Warn about missing recommended fields
    if (!prefs.name) {
      warnings.push({
        file: 'preferences.json',
        path: 'name',
        message: 'User name is not set',
        severity: 'warning',
        suggestion: 'Setting a name helps personalize agent responses',
      });
    }

    if (!prefs.timezone) {
      warnings.push({
        file: 'preferences.json',
        path: 'timezone',
        message: 'Timezone is not set',
        severity: 'warning',
        suggestion: 'Setting timezone helps with date/time formatting',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all config files
 * @param workspaceId - Optional workspace ID for source validation
 * @param workspaceRoot - Optional workspace root path for skill and status validation
 */
export function validateAll(workspaceId?: string, workspaceRoot?: string): ValidationResult {
  const results: ValidationResult[] = [
    validateConfig(),
    validatePreferences(),
  ];

  // Include workspace-scoped validations if workspaceId is provided
  if (workspaceId) {
    results.push(validateAllSources(workspaceId));
  }

  // Include skill, status, and permissions validation if workspaceRoot is provided
  if (workspaceRoot) {
    results.push(validateAllSkills(workspaceRoot));
    results.push(validateStatuses(workspaceRoot));
    results.push(validateAllPermissions(workspaceRoot));
  }

  const allErrors = results.flatMap(r => r.errors);
  const allWarnings = results.flatMap(r => r.warnings);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

// ============================================================
// Source & Agent Validators (Folder-Based Architecture)
// ============================================================

import { getWorkspaceSourcesPath } from '../workspaces/storage.ts';

// --- sources/{slug}/config.json ---

const SourceTypeSchema = z.enum(['mcp', 'api', 'local']);

// MCP source supports two transport types:
// - HTTP/SSE: requires url and authType
// - Stdio: requires command (and optional args, env)
const McpSourceConfigSchema = z.object({
  transport: z.enum(['http', 'sse', 'stdio']).optional(),
  // HTTP/SSE fields
  url: z.string().url().optional(),
  authType: z.enum(['oauth', 'bearer', 'none']).optional(),
  clientId: z.string().optional(),
  // Stdio fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
}).refine(
  (data) => {
    if (data.transport === 'stdio') {
      // Stdio transport requires command
      return !!data.command;
    } else {
      // HTTP/SSE transport (default) requires url and authType
      return !!data.url && !!data.authType;
    }
  },
  {
    message: 'MCP config requires either (url + authType) for HTTP/SSE or (command) for stdio transport',
  }
);

const ApiSourceConfigSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(['bearer', 'header', 'query', 'basic', 'none']),
  headerName: z.string().optional(),
  queryParam: z.string().optional(),
  authScheme: z.string().optional(),
  testEndpoint: z
    .object({
      method: z.enum(['GET', 'POST']),
      path: z.string(),
      body: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  googleService: z.enum(['gmail', 'calendar', 'drive', 'docs', 'sheets']).optional(),
  googleScopes: z.array(z.string()).optional(),
});

const LocalSourceConfigSchema = z.object({
  path: z.string().min(1),
  format: z.string().optional(),
});

export const FolderSourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  enabled: z.boolean(),
  provider: z.string().min(1),
  type: SourceTypeSchema,
  mcp: McpSourceConfigSchema.optional(),
  api: ApiSourceConfigSchema.optional(),
  local: LocalSourceConfigSchema.optional(),
  isAuthenticated: z.boolean().optional(),
  lastTestedAt: z.number().int().min(0).optional(),
  // Timestamps are optional - manually created configs may not have them
  // Storage functions add these automatically when saving
  createdAt: z.number().int().min(0).optional(),
  updatedAt: z.number().int().min(0).optional(),
}).refine(
  (data) => {
    // Ensure correct config block exists for type
    switch (data.type) {
      case 'mcp': return !!data.mcp;
      case 'api': return !!data.api;
      case 'local': return !!data.local;
    }
  },
  { message: 'Config must include type-specific configuration (mcp, api, or local)' }
);

/**
 * Validate a source config object
 */
export function validateSourceConfig(config: unknown): ValidationResult {
  const result = FolderSourceConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true, errors: [], warnings: [] };
  }

  return {
    valid: false,
    errors: zodErrorToIssues(result.error, 'config.json'),
    warnings: [],
  };
}

/**
 * Validate a source folder (workspace-scoped)
 */
export function validateSource(workspaceId: string, slug: string): ValidationResult {
  const sourcesDir = getWorkspaceSourcesPath(workspaceId);
  const file = `sources/${slug}/config.json`;
  const configPath = join(sourcesDir, slug, 'config.json');

  if (!existsSync(join(sourcesDir, slug))) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Source folder '${slug}' does not exist`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  if (!existsSync(configPath)) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: 'config.json not found',
        severity: 'error',
        suggestion: 'Create a config.json file in the source folder',
      }],
      warnings: [],
    };
  }

  let content: unknown;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    content = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  const result = validateSourceConfig(content);

  // Add warnings for missing guide.md
  const guidePath = join(sourcesDir, slug, 'guide.md');
  if (!existsSync(guidePath)) {
    result.warnings.push({
      file: `sources/${slug}/guide.md`,
      path: '',
      message: 'guide.md not found (recommended for usage guidelines)',
      severity: 'warning',
    });
  }

  return result;
}

/**
 * Validate all sources in a workspace
 */
export function validateAllSources(workspaceId: string): ValidationResult {
  const sourcesDir = getWorkspaceSourcesPath(workspaceId);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!existsSync(sourcesDir)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'sources/',
        path: '',
        message: 'Sources directory does not exist (no sources configured)',
        severity: 'warning',
      }],
    };
  }

  const entries = readdirSync(sourcesDir);
  const sourceFolders = entries.filter((entry) => {
    const entryPath = join(sourcesDir, entry);
    return statSync(entryPath).isDirectory();
  });

  if (sourceFolders.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'sources/',
        path: '',
        message: 'No sources configured',
        severity: 'warning',
      }],
    };
  }

  for (const folder of sourceFolders) {
    const result = validateSource(workspaceId, folder);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Skill Validators
// ============================================================

import matter from 'gray-matter';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { basename, extname } from 'path';
import type { WorkspaceStatusConfig, StatusConfig } from '../statuses/types.ts';

/**
 * Schema for skill metadata (SKILL.md frontmatter)
 */
export const SkillMetadataSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  description: z.string().min(1, 'Skill description is required'),
  globs: z.array(z.string()).optional(),
  alwaysAllow: z.array(z.string()).optional(),
});

/**
 * Find icon file in skill directory
 */
function findSkillIconForValidation(skillDir: string): string | null {
  const iconExtensions = ['.svg', '.png', '.jpg', '.jpeg'];

  for (const ext of iconExtensions) {
    const iconPath = join(skillDir, `icon${ext}`);
    if (existsSync(iconPath)) {
      return iconPath;
    }
  }

  return null;
}

/**
 * Validate a skill folder
 * @param workspaceRoot - Absolute path to workspace root folder
 * @param slug - Skill directory name
 */
export function validateSkill(workspaceRoot: string, slug: string): ValidationResult {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');
  const file = `skills/${slug}/SKILL.md`;

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // 1. Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    errors.push({
      file: `skills/${slug}`,
      path: 'slug',
      message: 'Slug must be lowercase alphanumeric with hyphens',
      severity: 'error',
      suggestion: 'Rename folder to use lowercase letters, numbers, and hyphens only',
    });
  }

  // 2. Check directory exists
  if (!existsSync(skillDir)) {
    return {
      valid: false,
      errors: [{
        file: `skills/${slug}`,
        path: '',
        message: `Skill folder '${slug}' does not exist`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // 3. Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: 'SKILL.md not found',
        severity: 'error',
        suggestion: 'Create a SKILL.md file with YAML frontmatter',
      }],
      warnings: [],
    };
  }

  // 4. Parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Cannot read file: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // 5. Parse frontmatter
  let frontmatter: unknown;
  let body: string;
  try {
    const parsed = matter(content);
    frontmatter = parsed.data;
    body = parsed.content;
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: 'frontmatter',
        message: `Invalid YAML frontmatter: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // 6. Validate frontmatter schema
  const metaResult = SkillMetadataSchema.safeParse(frontmatter);
  if (!metaResult.success) {
    errors.push(...zodErrorToIssues(metaResult.error, file));
  }

  // 7. Check content is not empty
  if (!body || body.trim().length === 0) {
    errors.push({
      file,
      path: 'content',
      message: 'Skill content is empty (nothing after frontmatter)',
      severity: 'error',
      suggestion: 'Add skill instructions after the YAML frontmatter',
    });
  }

  // 8. Validate icon if present
  const iconPath = findSkillIconForValidation(skillDir);
  if (iconPath) {
    const ext = extname(iconPath).toLowerCase();
    if (!['.svg', '.png', '.jpg', '.jpeg'].includes(ext)) {
      warnings.push({
        file: `skills/${slug}/${basename(iconPath)}`,
        path: '',
        message: `Unexpected icon format: ${ext}`,
        severity: 'warning',
        suggestion: 'Use .svg, .png, or .jpg for icons',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all skills in a workspace
 * @param workspaceRoot - Absolute path to workspace root folder
 */
export function validateAllSkills(workspaceRoot: string): ValidationResult {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!existsSync(skillsDir)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'skills/',
        path: '',
        message: 'Skills directory does not exist (no skills configured)',
        severity: 'warning',
      }],
    };
  }

  const entries = readdirSync(skillsDir);
  const skillFolders = entries.filter((entry) => {
    const entryPath = join(skillsDir, entry);
    return statSync(entryPath).isDirectory();
  });

  if (skillFolders.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'skills/',
        path: '',
        message: 'No skills configured',
        severity: 'warning',
      }],
    };
  }

  for (const folder of skillFolders) {
    const result = validateSkill(workspaceRoot, folder);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Status Validators
// ============================================================

const STATUS_CONFIG_DIR = 'statuses';
const STATUS_CONFIG_FILE = 'statuses/config.json';
const STATUS_ICONS_DIR = 'statuses/icons';

/** Required fixed statuses that must always exist */
const REQUIRED_FIXED_STATUS_IDS = ['todo', 'done', 'cancelled'] as const;

/**
 * Zod schema for status icon configuration
 * Supports two formats:
 * - Simple string (emoji or URL) - stored directly in icon field
 * - Object with type/value (for explicit file references)
 */
const StatusIconSchema = z.union([
  // Simple string: emoji or URL
  z.string(),
  // Object format: { type: "file" | "emoji", value: "..." }
  z.object({
    type: z.enum(['file', 'emoji']),
    value: z.string().min(1),
  }),
]);

/**
 * Zod schema for individual status configuration
 */
const StatusConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Status ID must be lowercase alphanumeric with hyphens'),
  label: z.string().min(1, 'Status label is required'),
  color: z.string().optional(),
  icon: StatusIconSchema.optional(),
  category: z.enum(['open', 'closed']),
  isFixed: z.boolean(),
  isDefault: z.boolean(),
  order: z.number().int().min(0),
});

/**
 * Zod schema for workspace status configuration
 */
const WorkspaceStatusConfigSchema = z.object({
  version: z.number().int().min(1),
  statuses: z.array(StatusConfigSchema),
  defaultStatusId: z.string().min(1),
});

/**
 * Validate statuses configuration for a workspace
 * @param workspaceRoot - Absolute path to workspace root folder
 */
export function validateStatuses(workspaceRoot: string): ValidationResult {
  const configPath = join(workspaceRoot, STATUS_CONFIG_FILE);
  const iconsDir = join(workspaceRoot, STATUS_ICONS_DIR);
  const file = STATUS_CONFIG_FILE;

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Check if config file exists (optional - defaults are used if missing)
  if (!existsSync(configPath)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file,
        path: '',
        message: 'Status config does not exist (using defaults)',
        severity: 'warning',
        suggestion: 'Statuses will use default configuration. Edit to customize.',
      }],
    };
  }

  // Parse JSON
  let content: unknown;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    content = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = WorkspaceStatusConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, file));
    return { valid: false, errors, warnings };
  }

  const config = result.data;

  // Semantic validations

  // 1. Check required fixed statuses exist
  const statusIds = new Set(config.statuses.map(s => s.id));
  for (const requiredId of REQUIRED_FIXED_STATUS_IDS) {
    if (!statusIds.has(requiredId)) {
      errors.push({
        file,
        path: 'statuses',
        message: `Required fixed status '${requiredId}' is missing`,
        severity: 'error',
        suggestion: `Add the '${requiredId}' status - it's required for the system to function`,
      });
    }
  }

  // 2. Check for duplicate IDs
  const seenIds = new Set<string>();
  for (const status of config.statuses) {
    if (seenIds.has(status.id)) {
      errors.push({
        file,
        path: `statuses[id=${status.id}]`,
        message: `Duplicate status ID '${status.id}'`,
        severity: 'error',
        suggestion: 'Each status must have a unique ID',
      });
    }
    seenIds.add(status.id);
  }

  // 3. Check defaultStatusId references an existing status
  if (!statusIds.has(config.defaultStatusId)) {
    errors.push({
      file,
      path: 'defaultStatusId',
      message: `Default status '${config.defaultStatusId}' does not exist in statuses array`,
      severity: 'error',
      suggestion: 'Set defaultStatusId to an existing status ID (typically "todo")',
    });
  }

  // 4. Check fixed statuses have correct isFixed flag
  for (const status of config.statuses) {
    const shouldBeFixed = (REQUIRED_FIXED_STATUS_IDS as readonly string[]).includes(status.id);
    if (shouldBeFixed && !status.isFixed) {
      warnings.push({
        file,
        path: `statuses[id=${status.id}].isFixed`,
        message: `Status '${status.id}' should have isFixed: true`,
        severity: 'warning',
        suggestion: 'This is a required system status and should be marked as fixed',
      });
    }
  }

  // 5. Validate icon file references exist
  for (const status of config.statuses) {
    if (status.icon && typeof status.icon === 'object' && status.icon.type === 'file') {
      const iconPath = join(iconsDir, status.icon.value);
      if (!existsSync(iconPath)) {
        warnings.push({
          file,
          path: `statuses[id=${status.id}].icon`,
          message: `Icon file '${status.icon.value}' not found`,
          severity: 'warning',
          suggestion: `Create the icon file at ${STATUS_ICONS_DIR}/${status.icon.value}`,
        });
      }
    }
  }

  // 6. Check that at least one status is in each category
  const hasOpen = config.statuses.some(s => s.category === 'open');
  const hasClosed = config.statuses.some(s => s.category === 'closed');
  if (!hasOpen) {
    errors.push({
      file,
      path: 'statuses',
      message: 'No status with category "open" - sessions will not appear in inbox',
      severity: 'error',
    });
  }
  if (!hasClosed) {
    warnings.push({
      file,
      path: 'statuses',
      message: 'No status with category "closed" - sessions cannot be archived',
      severity: 'warning',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Permissions Validators
// ============================================================

import { PermissionsConfigSchema } from '../agent/mode-types.ts';
import {
  validatePermissionsConfig,
  getWorkspacePermissionsPath,
  getSourcePermissionsPath,
  getAppPermissionsDir,
} from '../agent/permissions-config.ts';

/**
 * Internal: Validate a single permissions.json file
 * Checks JSON syntax, Zod schema, and regex pattern validity.
 */
function validatePermissionsFile(filePath: string, displayFile: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // File is optional - missing is just a warning
  if (!existsSync(filePath)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: displayFile,
        path: '',
        message: 'Permissions file does not exist (using defaults)',
        severity: 'warning',
      }],
    };
  }

  // Parse JSON
  let content: unknown;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    content = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file: displayFile,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = PermissionsConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, displayFile));
    return { valid: false, errors, warnings };
  }

  // Validate regex patterns (semantic validation)
  const regexErrors = validatePermissionsConfig(result.data);
  for (const regexError of regexErrors) {
    errors.push({
      file: displayFile,
      path: regexError.split(':')[0] || '',
      message: regexError,
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate workspace-level permissions.json
 * @param workspaceRoot - Absolute path to workspace root folder
 */
export function validateWorkspacePermissions(workspaceRoot: string): ValidationResult {
  const permissionsPath = getWorkspacePermissionsPath(workspaceRoot);
  return validatePermissionsFile(permissionsPath, 'permissions.json');
}

/**
 * Validate source-level permissions.json
 * @param workspaceRoot - Absolute path to workspace root folder
 * @param sourceSlug - Source slug
 */
export function validateSourcePermissions(workspaceRoot: string, sourceSlug: string): ValidationResult {
  const permissionsPath = getSourcePermissionsPath(workspaceRoot, sourceSlug);
  return validatePermissionsFile(permissionsPath, `sources/${sourceSlug}/permissions.json`);
}

/**
 * Validate app-level default permissions
 */
export function validateDefaultPermissions(): ValidationResult {
  const permissionsPath = join(getAppPermissionsDir(), 'default.json');
  return validatePermissionsFile(permissionsPath, 'permissions/default.json');
}

/**
 * Validate all permissions files in a workspace
 * Includes: app-level default, workspace-level, and all source-level permissions
 */
export function validateAllPermissions(workspaceRoot: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Validate app-level default permissions
  const defaultResult = validateDefaultPermissions();
  errors.push(...defaultResult.errors);
  warnings.push(...defaultResult.warnings);

  // Validate workspace-level permissions
  const wsResult = validateWorkspacePermissions(workspaceRoot);
  errors.push(...wsResult.errors);
  warnings.push(...wsResult.warnings);

  // Validate all source-level permissions
  const sourcesDir = join(workspaceRoot, 'sources');
  if (existsSync(sourcesDir)) {
    const entries = readdirSync(sourcesDir);
    for (const entry of entries) {
      const entryPath = join(sourcesDir, entry);
      if (statSync(entryPath).isDirectory()) {
        const srcResult = validateSourcePermissions(workspaceRoot, entry);
        errors.push(...srcResult.errors);
        warnings.push(...srcResult.warnings);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format validation result as text for agent response
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid && result.warnings.length === 0) {
    lines.push('All configuration files are valid.');
    return lines.join('\n');
  }

  if (result.valid) {
    lines.push('Configuration is valid with warnings:');
  } else {
    lines.push('Configuration has errors:');
  }

  lines.push('');

  // Errors first
  if (result.errors.length > 0) {
    lines.push('**Errors:**');
    for (const error of result.errors) {
      lines.push(`- \`${error.file}\` at \`${error.path}\`: ${error.message}`);
      if (error.suggestion) {
        lines.push(`  → ${error.suggestion}`);
      }
    }
    lines.push('');
  }

  // Then warnings
  if (result.warnings.length > 0) {
    lines.push('**Warnings:**');
    for (const warning of result.warnings) {
      lines.push(`- \`${warning.file}\` at \`${warning.path}\`: ${warning.message}`);
      if (warning.suggestion) {
        lines.push(`  → ${warning.suggestion}`);
      }
    }
  }

  return lines.join('\n');
}
