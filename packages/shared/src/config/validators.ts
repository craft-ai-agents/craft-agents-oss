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
 * - agents/{slug}/config.json: Workspace-scoped agent configs
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// Config Directory
// ============================================================

const CONFIG_DIR = join(homedir(), '.craft-agent');
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

const AuthTypeSchema = z.enum(['api_key', 'oauth_token', 'craft_credits']);

const TokenDisplayModeSchema = z.enum(['hidden', 'total', 'separate']);

const ModeSchema = z.enum(['safe']);

const CumulativeUsageSchema = z.object({
  totalCostUsd: z.number().min(0),
  totalInputTokens: z.number().int().min(0),
  totalOutputTokens: z.number().int().min(0),
  lastUpdated: z.number().int().min(0),
});

// Permission mode for sessions
const PermissionModeSchema = z.enum(['safe', 'ask', 'allow-all']);

export const StoredConfigSchema = z.object({
  authType: AuthTypeSchema.optional(),
  workspaces: z.array(WorkspaceSchema).min(0),
  activeWorkspaceId: z.string().nullable(),
  activeSessionId: z.string().nullable(),
  model: z.string().optional(),
  extendedCacheTtl: z.boolean().optional(),
  tokenDisplay: TokenDisplayModeSchema.optional(),
  showCost: z.boolean().optional(),
  cumulativeUsage: CumulativeUsageSchema.optional(),
  defaultPermissionMode: PermissionModeSchema.optional(),
  // Note: defaultWorkingDirectory is now per-workspace in workspace config.json
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
 */
export function validateAll(workspaceId?: string): ValidationResult {
  const results: ValidationResult[] = [
    validateConfig(),
    validatePreferences(),
  ];

  // Include workspace-scoped validations if workspaceId is provided
  if (workspaceId) {
    results.push(validateAllSources(workspaceId));
    results.push(validateAllAgents(workspaceId));
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

import { getWorkspaceSourcesPath, getWorkspaceAgentsPath } from '../workspaces/storage.ts';

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
  env: z.record(z.string()).optional(),
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
      body: z.record(z.unknown()).optional(),
      headers: z.record(z.string()).optional(),
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

// --- agents/{slug}/config.json ---

const AgentSourceRefSchema = z.object({
  type: z.enum(['url', 'local']),
  url: z.string().url().optional(),
  lastSynced: z.number().int().min(0).optional(),
});

export const FolderAgentConfigSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^\.?[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens (optional leading dot for builtins)'),
  enabled: z.boolean(),
  source: AgentSourceRefSchema.optional(),
  useSources: z.array(z.string()).optional(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

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
 * Validate an agent config object
 */
export function validateAgentConfig(config: unknown): ValidationResult {
  const result = FolderAgentConfigSchema.safeParse(config);

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
 * Validate an agent folder (workspace-scoped)
 */
export function validateAgent(workspaceId: string, slug: string): ValidationResult {
  const agentsDir = getWorkspaceAgentsPath(workspaceId);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const file = `agents/${slug}/config.json`;
  const dir = join(agentsDir, slug);
  const configPath = join(dir, 'config.json');
  const instructionsPath = join(dir, 'instructions.md');

  if (!existsSync(dir)) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Agent folder '${slug}' does not exist`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Check config.json
  if (!existsSync(configPath)) {
    errors.push({
      file,
      path: '',
      message: 'config.json not found',
      severity: 'error',
      suggestion: 'Create a config.json file in the agent folder',
    });
  } else {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const content = JSON.parse(raw);
      const configResult = validateAgentConfig(content);
      errors.push(...configResult.errors);
      warnings.push(...configResult.warnings);

      // Check if slug matches folder name
      if (content.slug && content.slug !== slug) {
        warnings.push({
          file,
          path: 'slug',
          message: `Slug '${content.slug}' does not match folder name '${slug}'`,
          severity: 'warning',
          suggestion: `Update slug to '${slug}' or rename the folder`,
        });
      }
    } catch (e) {
      errors.push({
        file,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      });
    }
  }

  // Check instructions.md
  if (!existsSync(instructionsPath)) {
    warnings.push({
      file: `agents/${slug}/instructions.md`,
      path: '',
      message: 'instructions.md not found',
      severity: 'warning',
      suggestion: 'Create an instructions.md file with agent behavior instructions',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
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

/**
 * Validate all agents in a workspace
 */
export function validateAllAgents(workspaceId: string): ValidationResult {
  const agentsDir = getWorkspaceAgentsPath(workspaceId);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!existsSync(agentsDir)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'agents/',
        path: '',
        message: 'Agents directory does not exist (no agents configured)',
        severity: 'warning',
      }],
    };
  }

  const entries = readdirSync(agentsDir);
  const agentFolders = entries.filter((entry) => {
    const entryPath = join(agentsDir, entry);
    return statSync(entryPath).isDirectory();
  });

  if (agentFolders.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file: 'agents/',
        path: '',
        message: 'No agents configured',
        severity: 'warning',
      }],
    };
  }

  for (const folder of agentFolders) {
    const result = validateAgent(workspaceId, folder);
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
