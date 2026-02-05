/**
 * Craft Agent Hooks - Simple Implementation
 *
 * KISS version: One file, minimal types, just works.
 *
 * Usage:
 *   1. Create hooks.json in your workspace
 *   2. Call initHooks({ workspaceRootPath: '...' })
 *   3. Call emitHook('StatusChange', { oldStatus: 'todo', newStatus: 'done' })
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/debug.ts';
import { HooksConfigSchema, zodErrorToIssues } from './schemas.ts';
import { isValidLabelId } from '../labels/storage.ts';
import { extractLabelId } from '../labels/values.ts';
import { sanitizeForShell } from './security.ts';
import { matchesCron } from './cron-matcher.ts';
import {
  setPermissionsContext,
  clearPermissionsContext,
  isCommandAllowed,
  getPermissionsConfig,
  executeCommand,
} from './command-executor.ts';
import { Cron } from 'croner';
import type { ValidationResult, ValidationIssue } from '../config/validators.ts';
import type { PermissionsContext } from '../agent/permissions-config.ts';

// Use shared debug infrastructure (controlled via CRAFT_DEBUG=1)
const log = createLogger('hooks');

// ============================================================================
// Types (minimal)
// ============================================================================

/** App events - handled by Craft */
export type AppEvent =
  | 'LabelAdd'
  | 'LabelRemove'
  | 'LabelConfigChange'
  | 'PermissionModeChange'
  | 'FlagChange'
  | 'TodoStateChange'
  | 'SchedulerTick';

/** Agent events - passed to Claude SDK */
export type AgentEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup';

export type HookEvent = AppEvent | AgentEvent;

const APP_EVENTS: AppEvent[] = ['LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'TodoStateChange', 'SchedulerTick'];
const AGENT_EVENTS: AgentEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup'
];

/** A command hook - executes a shell command */
export interface CommandHookDefinition {
  type: 'command';
  command: string;
  timeout?: number;
}

/** A prompt hook - sends a prompt to Craft Agent (App events only) */
export interface PromptHookDefinition {
  type: 'prompt';
  prompt: string;
}

export type HookDefinition = CommandHookDefinition | PromptHookDefinition;

export interface HookMatcher {
  /** Regex pattern for matching event data (not used for SchedulerTick) */
  matcher?: string;
  /** Cron expression for SchedulerTick events (5-field format) */
  cron?: string;
  /** IANA timezone for cron evaluation (e.g., "Europe/Budapest", "America/New_York") */
  timezone?: string;
  /** Permission mode for command hooks. 'allow-all' bypasses security checks. */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Labels to apply to sessions created by prompt hooks */
  labels?: string[];
  hooks: HookDefinition[];
}

export interface HooksConfig {
  hooks: Partial<Record<HookEvent, HookMatcher[]>>;
}

/** Result of a command hook execution */
export interface CommandHookResult {
  type: 'command';
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  blocked?: boolean;
}

/** References parsed from a prompt (@name for sources and skills) */
export interface PromptReferences {
  /**
   * All @name references found in the prompt.
   * These could be sources (@linear, @github) or skills (@commit, @review-pr).
   * The caller should resolve which are sources vs skills based on available configurations.
   */
  mentions: string[];
}

/** Result of a prompt hook - returns the prompt to be executed by caller */
export interface PromptHookResult {
  type: 'prompt';
  prompt: string;
  /** The expanded prompt with environment variables substituted */
  expandedPrompt: string;
  /** References to sources and skills found in the prompt */
  references: PromptReferences;
}

export type HookExecutionResult = CommandHookResult | PromptHookResult;

/** A pending prompt with its metadata */
export interface PendingPrompt {
  /** The session ID this prompt should be sent to */
  sessionId: string | undefined;
  /** The expanded prompt text */
  prompt: string;
  /**
   * All @mentions found in the prompt (sources and skills).
   * The caller should resolve which are sources vs skills based on available configurations.
   */
  mentions: string[];
  /** Labels to apply to the created session */
  labels?: string[];
}

export interface HookResult {
  event: string;
  matched: number;
  results: HookExecutionResult[];
  /** Prompts that should be executed by Craft Agent (with metadata) */
  pendingPrompts: PendingPrompt[];
}

// ============================================================================
// Validation (schemas imported from ./schemas.ts)
// ============================================================================

/** Internal validation result that includes the parsed config */
export type HooksValidationResult = {
  valid: boolean;
  errors: string[];
  config: HooksConfig | null;
};

/**
 * Validate hooks config (internal - returns parsed config)
 */
export function validateHooksConfig(content: unknown): HooksValidationResult {
  const result = HooksConfigSchema.safeParse(content);

  if (result.success) {
    return { valid: true, errors: [], config: result.data as HooksConfig };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { valid: false, errors, config: null };
}

/**
 * Validate hooks config from a JSON string (no disk reads).
 * Used by PreToolUse hook to validate before writing to disk.
 * Follows the same pattern as other config validators in validators.ts.
 */
export function validateHooksContent(jsonString: string): ValidationResult {
  const file = 'hooks.json';
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Parse JSON
  let content: unknown;
  try {
    content = JSON.parse(jsonString);
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
  const result = HooksConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, file));
    return { valid: false, errors, warnings };
  }

  // Semantic validations
  const config = result.data;

  // Check for empty hooks array
  const hookCount = Object.values(config.hooks).reduce(
    (sum, matchers) => sum + (matchers?.length ?? 0),
    0
  );
  if (hookCount === 0) {
    warnings.push({
      file,
      path: 'hooks',
      message: 'No hooks configured',
      severity: 'warning',
      suggestion: 'Add hook definitions under event names like StatusChange, LabelAdd, etc.',
    });
  }

  // Validate regex patterns, cron expressions, and timezones in matchers
  for (const [event, matchers] of Object.entries(config.hooks)) {
    if (!matchers) continue;
    for (let i = 0; i < matchers.length; i++) {
      const matcher = matchers[i];
      if (!matcher) continue;
      if (matcher.matcher) {
        // ReDoS prevention: limit regex complexity
        const MAX_REGEX_LENGTH = 500;
        if (matcher.matcher.length > MAX_REGEX_LENGTH) {
          errors.push({
            file,
            path: `hooks.${event}[${i}].matcher`,
            message: `Regex pattern too long (${matcher.matcher.length} chars, max ${MAX_REGEX_LENGTH})`,
            severity: 'error',
            suggestion: 'Simplify the regex pattern or split into multiple matchers',
          });
        } else {
          try {
            // Validate regex syntax
            new RegExp(matcher.matcher);

            // Warn about potentially catastrophic backtracking patterns
            const riskyPatterns = /(\.\*){2,}|(\.\+){2,}|\(\.\*\)\+|\(\.\+\)\*/;
            if (riskyPatterns.test(matcher.matcher)) {
              warnings.push({
                file,
                path: `hooks.${event}[${i}].matcher`,
                message: 'Regex pattern may cause performance issues (nested quantifiers)',
                severity: 'warning',
                suggestion: 'Avoid patterns like .*.*, .+.+, or (.*)+',
              });
            }
          } catch (e) {
            errors.push({
              file,
              path: `hooks.${event}[${i}].matcher`,
              message: `Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`,
              severity: 'error',
              suggestion: 'Fix the regex pattern or remove the matcher to match all events',
            });
          }
        }
      }

      // Validate cron expressions
      if (matcher.cron) {
        try {
          new Cron(matcher.cron);
        } catch (e) {
          errors.push({
            file,
            path: `hooks.${event}[${i}].cron`,
            message: `Invalid cron expression: ${e instanceof Error ? e.message : 'Unknown error'}`,
            severity: 'error',
            suggestion: 'Use standard 5-field cron format: minute hour day-of-month month day-of-week',
          });
        }
      }

      // Validate timezone
      if (matcher.timezone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: matcher.timezone });
        } catch {
          errors.push({
            file,
            path: `hooks.${event}[${i}].timezone`,
            message: `Invalid timezone: ${matcher.timezone}`,
            severity: 'error',
            suggestion: 'Use IANA timezone format like "Europe/Budapest" or "America/New_York"',
          });
        }
      }

      // Warn if cron is used on non-SchedulerTick event
      if (matcher.cron && event !== 'SchedulerTick') {
        warnings.push({
          file,
          path: `hooks.${event}[${i}].cron`,
          message: `Cron expressions are only used for SchedulerTick events`,
          severity: 'warning',
          suggestion: `Move this hook to the SchedulerTick event or use matcher instead`,
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
 * Validate hooks.json from workspace path (reads from disk).
 * Follows the same pattern as other validators in validators.ts.
 */
export function validateHooks(workspaceRoot: string): ValidationResult {
  const configPath = join(workspaceRoot, 'hooks.json');
  const file = 'hooks.json';

  // Hooks config is optional - no config means no hooks (valid state)
  if (!existsSync(configPath)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file,
        path: '',
        message: 'hooks.json does not exist (no hooks configured)',
        severity: 'warning',
      }],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
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

  // First validate content (JSON + schema)
  const contentResult = validateHooksContent(raw);
  if (!contentResult.valid) {
    return contentResult;
  }

  // Additional workspace-aware validations
  const warnings = [...contentResult.warnings];

  // Validate labels exist in workspace
  try {
    const config = JSON.parse(raw) as { hooks?: Record<string, Array<{ labels?: string[] }>> };
    if (config.hooks) {
      for (const [event, matchers] of Object.entries(config.hooks)) {
        if (!matchers) continue;
        for (let i = 0; i < matchers.length; i++) {
          const matcher = matchers[i];
          if (matcher?.labels) {
            for (const label of matcher.labels) {
              // Extract label ID (handles "priority::3" -> "priority")
              const labelId = extractLabelId(label);
              if (!isValidLabelId(workspaceRoot, labelId)) {
                warnings.push({
                  file,
                  path: `hooks.${event}[${i}].labels`,
                  message: `Label "${labelId}" does not exist in workspace`,
                  severity: 'warning',
                  suggestion: `Create this label in labels/config.json or use an existing label ID`,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // JSON already validated, this shouldn't happen
  }

  return {
    valid: contentResult.valid,
    errors: contentResult.errors,
    warnings,
  };
}

// ============================================================================
// State
// ============================================================================

let config: HooksConfig | null = null;
let context: { sessionId?: string; workspaceId?: string; workingDir?: string } = {};

// ============================================================================
// Init & Config
// ============================================================================

export interface InitHooksResult {
  success: boolean;
  errors: string[];
  hookCount: number;
}

/**
 * Initialize hooks from workspace
 */
export function initHooks(options: {
  workspaceRootPath: string;
  sessionId?: string;
  workspaceId?: string;
  workingDir?: string;
  /** Active source slugs for source-specific permission rules */
  activeSourceSlugs?: string[];
}): InitHooksResult {
  const configPath = join(options.workspaceRootPath, 'hooks.json');
  log.debug(`[hooks] initHooks called: configPath=${configPath}`);

  // Set up permissions context for command validation
  setPermissionsContext({
    workspaceRootPath: options.workspaceRootPath,
    activeSourceSlugs: options.activeSourceSlugs,
  });

  if (!existsSync(configPath)) {
    log.debug(`[hooks] No hooks.json found at ${configPath}`);
    config = { hooks: {} };
    context = {
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      workingDir: options.workingDir,
    };
    return { success: true, errors: [], hookCount: 0 };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const validation = validateHooksConfig(raw);

    if (!validation.valid) {
      console.warn('[hooks] Invalid hooks.json:', validation.errors);
      config = { hooks: {} };
      context = {
        sessionId: options.sessionId,
        workspaceId: options.workspaceId,
        workingDir: options.workingDir,
      };
      return { success: false, errors: validation.errors, hookCount: 0 };
    }

    config = validation.config!;
    context = {
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      workingDir: options.workingDir,
    };

    // Count total hooks
    const hookCount = Object.values(config.hooks).reduce(
      (sum, matchers) => sum + (matchers?.reduce((s, m) => s + m.hooks.length, 0) ?? 0),
      0
    );

    log.debug(`[hooks] Loaded ${hookCount} hooks from ${configPath}`);
    log.debug(`[hooks] Events configured: ${Object.keys(config.hooks).join(', ')}`);
    for (const [event, matchers] of Object.entries(config.hooks)) {
      log.debug(`[hooks]   ${event}: ${matchers?.length || 0} matchers`);
      for (const m of matchers || []) {
        log.debug(`[hooks]     - cron=${m.cron}, timezone=${m.timezone}, hooks=${m.hooks.length}`);
      }
    }

    return { success: true, errors: [], hookCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    console.warn('[hooks] Failed to load hooks.json:', error);
    config = { hooks: {} };
    context = {
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      workingDir: options.workingDir,
    };
    return { success: false, errors: [`Failed to parse JSON: ${error}`], hookCount: 0 };
  }
}

/**
 * Clear hooks (for cleanup/testing)
 */
export function clearHooks(): void {
  config = null;
  context = {};
  clearPermissionsContext();
}

/**
 * Check if event is an app event (vs agent event)
 */
export function isAppEvent(event: string): event is AppEvent {
  return APP_EVENTS.includes(event as AppEvent);
}

/**
 * Get agent hooks (to pass to Claude SDK)
 */
export function getAgentHooks(): Partial<Record<AgentEvent, HookMatcher[]>> {
  if (!config) return {};

  const result: Partial<Record<AgentEvent, HookMatcher[]>> = {};
  for (const event of AGENT_EVENTS) {
    if (config.hooks[event]) {
      result[event] = config.hooks[event];
    }
  }
  return result;
}

// ============================================================================
// Emit
// ============================================================================

/**
 * Emit a hook event
 *
 * @param event - Event name (e.g., 'StatusChange', 'LabelAdd')
 * @param data - Event-specific data (passed as env vars)
 * @returns HookResult with command results and pending prompts for Craft Agent
 */
export async function emitHook(
  event: HookEvent,
  data: Record<string, unknown>
): Promise<HookResult> {
  log.debug(`[hooks] emitHook called: event=${event}, config exists=${!!config}`);
  if (!config) {
    log.debug(`[hooks] No config, returning early`);
    return { event, matched: 0, results: [], pendingPrompts: [] };
  }

  const matchers = config.hooks[event] ?? [];
  log.debug(`[hooks] Found ${matchers.length} matchers for event ${event}`);

  // Find matching hooks with their permission mode and labels
  type HookWithMeta = { hook: HookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };
  const matchingHooks: HookWithMeta[] = [];

  if (event === 'SchedulerTick') {
    // Use cron matching for SchedulerTick events
    log.debug(`[hooks] Checking ${matchers.length} SchedulerTick matchers`);
    for (const m of matchers) {
      log.debug(`[hooks] Matcher: cron=${m.cron}, timezone=${m.timezone}`);
      const cronMatches = m.cron && matchesCron(m.cron, m.timezone);
      log.debug(`[hooks] Cron matches: ${cronMatches}`);
      if (m.cron && cronMatches) {
        for (const hook of m.hooks) {
          matchingHooks.push({ hook, permissionMode: m.permissionMode, labels: m.labels });
        }
      }
    }
    log.debug(`[hooks] SchedulerTick: ${matchingHooks.length} hooks matched`);
  } else {
    // Use regex matching for other events
    const matchValue = getMatchValue(event, data);
    for (const m of matchers) {
      if (!m.matcher || new RegExp(m.matcher).test(matchValue)) {
        for (const hook of m.hooks) {
          matchingHooks.push({ hook, permissionMode: m.permissionMode, labels: m.labels });
        }
      }
    }
  }

  if (matchingHooks.length === 0) {
    return { event, matched: 0, results: [], pendingPrompts: [] };
  }

  // Build env vars (for command execution and prompt expansion)
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CRAFT_EVENT: event,
    CRAFT_EVENT_DATA: JSON.stringify(data),
  };

  if (context.sessionId) env.CRAFT_SESSION_ID = context.sessionId;
  if (context.workspaceId) env.CRAFT_WORKSPACE_ID = context.workspaceId;
  if (context.workingDir) env.CRAFT_WORKING_DIR = context.workingDir;

  // Add data fields as individual env vars
  for (const [key, value] of Object.entries(data)) {
    env[`CRAFT_${toSnakeCase(key).toUpperCase()}`] = String(value);
  }

  // Separate command and prompt hooks (with metadata)
  type CommandWithMeta = { hook: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };
  type PromptWithMeta = { hook: PromptHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };

  const commandHooks: CommandWithMeta[] = matchingHooks
    .filter((h): h is HookWithMeta & { hook: CommandHookDefinition } => h.hook.type === 'command');
  const promptHooks: PromptWithMeta[] = matchingHooks
    .filter((h): h is HookWithMeta & { hook: PromptHookDefinition } => h.hook.type === 'prompt');

  // Validate: prompt hooks are only valid for App events
  if (promptHooks.length > 0 && !isAppEvent(event)) {
    console.warn(`[hooks] Prompt hooks are only supported for App events, ignoring ${promptHooks.length} prompt(s) for ${event}`);
  }

  // Execute command hooks in parallel (with permission check via executeCommand)
  const commandResults: HookExecutionResult[] = await Promise.all(
    commandHooks.map(async ({ hook, permissionMode }) => {
      const result = await executeCommand(hook.command, {
        env,
        timeout: hook.timeout ?? 60000,
        cwd: context.workingDir,
        permissionMode,
      });

      if (result.blocked) {
        console.warn(`[hooks] Blocked command: ${hook.command} - ${result.stderr}`);
      }

      return {
        type: 'command' as const,
        command: hook.command,
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        blocked: result.blocked,
      };
    })
  );

  // Process prompt hooks (only for App events)
  const promptResults: HookExecutionResult[] = [];
  const pendingPrompts: PendingPrompt[] = [];

  if (isAppEvent(event)) {
    for (const { hook, labels } of promptHooks) {
      // Expand environment variables in the prompt
      const expandedPrompt = expandEnvVars(hook.prompt, env);

      // Parse references to sources and skills
      const references = parsePromptReferences(expandedPrompt);

      promptResults.push({
        type: 'prompt',
        prompt: hook.prompt,
        expandedPrompt,
        references,
      });

      // Expand environment variables in labels (e.g., "scheduled::$CRAFT_LOCAL_TIME" -> "scheduled::17:30")
      const expandedLabels = labels?.map(label => {
        const expanded = expandEnvVars(label, env);
        console.log(`[hooks] Label expansion: "${label}" -> "${expanded}" (CRAFT_LOCAL_TIME=${env.CRAFT_LOCAL_TIME})`);
        return expanded;
      });

      pendingPrompts.push({
        sessionId: context.sessionId,
        prompt: expandedPrompt,
        mentions: references.mentions,
        labels: expandedLabels,
      });
    }
  }

  return {
    event,
    matched: matchingHooks.length,
    results: [...commandResults, ...promptResults],
    pendingPrompts,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getMatchValue(event: HookEvent, data: Record<string, unknown>): string {
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove':
      return String(data.label ?? '');
    case 'LabelConfigChange':
      return ''; // Always matches
    case 'PermissionModeChange':
      return String(data.newMode ?? '');
    case 'FlagChange':
      return String(data.isFlagged ?? false);
    case 'TodoStateChange':
      return String(data.newStatus ?? '');
    case 'PreToolUse':
    case 'PostToolUse':
      return String(data.toolName ?? '');
    case 'SchedulerTick':
      // SchedulerTick uses cron matching, not regex
      return '';
    default:
      return JSON.stringify(data);
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Expand environment variables in a string.
 * Supports both $VAR and ${VAR} syntax.
 */
function expandEnvVars(str: string, env: Record<string, string>): string {
  return str
    // Replace ${VAR} syntax
    .replace(/\$\{([^}]+)\}/g, (_, varName) => env[varName] ?? '')
    // Replace $VAR syntax (word boundary)
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, varName) => env[varName] ?? '');
}

/**
 * Parse @mentions from a prompt (sources and skills both use @name syntax).
 *
 * Syntax:
 * - @name - references a source or skill (e.g., @linear, @github, @commit, @review-pr)
 *
 * References are case-insensitive and support hyphens (e.g., @my-source, @my-skill).
 * The caller should resolve which mentions are sources vs skills based on available configurations.
 */
export function parsePromptReferences(prompt: string): PromptReferences {
  const mentions: string[] = [];

  // Match @name (word characters and hyphens)
  // Avoid matching email addresses by requiring whitespace or start of string before @
  const matches = prompt.matchAll(/(?:^|[\s(])@([a-zA-Z][a-zA-Z0-9-]*)/g);
  for (const match of matches) {
    const captured = match[1];
    if (captured) {
      const mention = captured.toLowerCase();
      if (!mentions.includes(mention)) {
        mentions.push(mention);
      }
    }
  }

  return { mentions };
}

// ============================================================================
// SDK Hook Integration
// ============================================================================

/**
 * SDK hook input type - union of all possible SDK event inputs
 */
export interface SdkHookInput {
  hook_event_name: string;
  // Tool events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
  // Session events
  source?: string;  // startup, resume, clear, compact
  model?: string;
  // Subagent events
  agent_id?: string;
  agent_type?: string;
  // User prompt events
  prompt?: string;
  // Notification events
  message?: string;
  title?: string;
  // Error events
  error?: string;
}

/**
 * Build environment variables from SDK hook input.
 * Maps SDK input fields to CRAFT_* environment variables.
 */
export function buildEnvFromSdkInput(event: AgentEvent, input: SdkHookInput): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CRAFT_EVENT: event,
  };

  // Add context if available
  if (context.sessionId) env.CRAFT_SESSION_ID = context.sessionId;
  if (context.workspaceId) env.CRAFT_WORKSPACE_ID = context.workspaceId;
  if (context.workingDir) env.CRAFT_WORKING_DIR = context.workingDir;

  // Map SDK input fields to env vars based on event type
  // User-provided values are sanitized to prevent shell injection
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name; // Tool names are internal, not user input
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.tool_response) env.CRAFT_TOOL_RESPONSE = sanitizeForShell(input.tool_response);
      break;

    case 'PostToolUseFailure':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name;
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.error) env.CRAFT_ERROR = sanitizeForShell(input.error);
      break;

    case 'UserPromptSubmit':
      // User prompts are user-controlled and must be sanitized
      if (input.prompt) env.CRAFT_PROMPT = sanitizeForShell(input.prompt);
      break;

    case 'SessionStart':
      if (input.source) env.CRAFT_SOURCE = input.source; // Internal values
      if (input.model) env.CRAFT_MODEL = input.model;
      break;

    case 'SubagentStart':
    case 'SubagentStop':
      if (input.agent_id) env.CRAFT_AGENT_ID = input.agent_id; // Internal values
      if (input.agent_type) env.CRAFT_AGENT_TYPE = input.agent_type;
      break;

    case 'Notification':
      // Notification content could contain user data
      if (input.message) env.CRAFT_MESSAGE = sanitizeForShell(input.message);
      if (input.title) env.CRAFT_TITLE = sanitizeForShell(input.title);
      break;

    // SessionEnd, Stop, PreCompact, PermissionRequest, Setup have no additional fields
    default:
      break;
  }

  return env;
}

/**
 * SDK hook callback signature (matches Claude SDK HookCallback type)
 */
export type SdkHookCallback = (
  input: SdkHookInput,
  toolUseId: string,
  options: { signal?: AbortSignal }
) => Promise<{ continue: boolean; reason?: string }>;

/**
 * SDK hook matcher format (matches Claude SDK HookCallbackMatcher type)
 */
export interface SdkHookCallbackMatcher {
  matcher?: string;
  timeout?: number;
  hooks: SdkHookCallback[];
}

/**
 * Execute hooks for a matcher and return SDK-compatible result.
 * Runs command hooks and returns appropriate response.
 */
async function executeHooksForSdkMatcher(
  matcher: HookMatcher,
  event: AgentEvent,
  env: Record<string, string>,
  signal?: AbortSignal
): Promise<{ continue: boolean; reason?: string }> {
  // Filter to command hooks only (prompt hooks not supported for SDK events)
  const commandHooks = matcher.hooks.filter((h): h is CommandHookDefinition => h.type === 'command');

  if (commandHooks.length === 0) {
    return { continue: true };
  }

  // Execute command hooks
  for (const hook of commandHooks) {
    // Check for abort
    if (signal?.aborted) {
      return { continue: false, reason: 'Aborted' };
    }

    const result = await executeCommand(hook.command, {
      env,
      timeout: hook.timeout ?? 60000,
      cwd: context.workingDir,
      permissionMode: matcher.permissionMode,
    });

    if (result.blocked) {
      console.warn(`[hooks] Blocked command in ${event}: ${hook.command} - ${result.stderr}`);
      continue; // Skip this hook but continue with others
    }

    if (!result.success) {
      console.warn(`[hooks] Command failed in ${event}: ${hook.command}`, result.stderr);
      // Continue with other hooks even if one fails
    }
  }

  return { continue: true };
}

/**
 * Build SDK hooks callbacks from hooks.json definitions.
 * This is the bridge between hooks.json and the Claude SDK hook system.
 *
 * Returns a partial record of event name → array of hook matchers in SDK format.
 * The caller should merge these with any internal hooks.
 */
export function buildSdkHooks(): Partial<Record<AgentEvent, SdkHookCallbackMatcher[]>> {
  if (!config) return {};

  const sdkHooks: Partial<Record<AgentEvent, SdkHookCallbackMatcher[]>> = {};

  for (const event of AGENT_EVENTS) {
    const matchers = config.hooks[event];
    if (!matchers?.length) continue;

    sdkHooks[event] = matchers.map(matcher => ({
      matcher: matcher.matcher,
      timeout: 30,
      hooks: [async (input: SdkHookInput, _toolUseId: string, options: { signal?: AbortSignal }) => {
        // Build environment variables from SDK input
        const env = buildEnvFromSdkInput(event, input);

        // Execute hooks using existing command execution
        const result = await executeHooksForSdkMatcher(matcher, event, env, options.signal);

        return result;
      }],
    }));
  }

  return sdkHooks;
}

/**
 * Get the current hooks config (for external access)
 */
export function getHooksConfig(): HooksConfig | null {
  return config;
}

// Re-export emitter for convenience
export { HookEmitter, type SessionMetadataChange, type HookEmitterOptions, type HookEmitResult, type SessionMetadataSnapshot } from './emitter.ts';

// Re-export event logger
export { HookEventLogger, type LoggedHookEvent, type LoggedHookEventInput } from './event-logger.ts';

// Re-export schemas for external validation
export { HooksConfigSchema, zodErrorToIssues, VALID_EVENTS } from './schemas.ts';

// Re-export security utilities
export { sanitizeForShell } from './security.ts';

// Re-export cron matching
export { matchesCron } from './cron-matcher.ts';

// Re-export command executor utilities
export {
  setPermissionsContext,
  clearPermissionsContext,
  isCommandAllowed,
  getPermissionsConfig,
  executeCommand,
  type CommandExecutionOptions,
  type CommandExecutionResult,
} from './command-executor.ts';
