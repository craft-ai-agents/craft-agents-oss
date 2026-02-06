/**
 * Craft Agent Hooks - Public API
 *
 * Slim barrel file that re-exports from decomposed modules:
 * - types.ts: All type definitions
 * - validation.ts: Config validation functions
 * - sdk-bridge.ts: SDK environment variable building
 * - utils.ts: Shared utilities (toSnakeCase, expandEnvVars, etc.)
 * - hook-system.ts: HookSystem facade (main entry point)
 * - event-bus.ts: WorkspaceEventBus
 * - handlers/: CommandHandler, PromptHandler, EventLogHandler
 */

// ============================================================================
// Types
// ============================================================================

export type {
  AppEvent,
  AgentEvent,
  HookEvent,
  CommandHookDefinition,
  PromptHookDefinition,
  HookDefinition,
  HookMatcher,
  HooksConfig,
  CommandHookResult,
  PromptReferences,
  PromptHookResult,
  HookExecutionResult,
  PendingPrompt,
  HookResult,
  HooksValidationResult,
  SdkHookInput,
  SdkHookCallback,
  SdkHookCallbackMatcher,
  SessionMetadataSnapshot,
} from './types.ts';

export { APP_EVENTS, AGENT_EVENTS } from './types.ts';

// ============================================================================
// Validation
// ============================================================================

export {
  validateHooksConfig,
  validateHooksContent,
  validateHooks,
} from './validation.ts';

// ============================================================================
// SDK Bridge
// ============================================================================

export { buildEnvFromSdkInput } from './sdk-bridge.ts';

// ============================================================================
// Utilities
// ============================================================================

export { parsePromptReferences } from './utils.ts';

// ============================================================================
// Legacy Functional API (deprecated - use HookSystem instead)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/debug.ts';
import { matchesCron } from './cron-matcher.ts';
import { sanitizeForShell } from './security.ts';
import {
  setPermissionsContext,
  clearPermissionsContext,
  executeCommand,
} from './command-executor.ts';
import { toSnakeCase, expandEnvVars, getMatchValue } from './utils.ts';
import { parsePromptReferences } from './utils.ts';
import { validateHooksConfig } from './validation.ts';
import type {
  HookEvent,
  AppEvent,
  AgentEvent,
  HooksConfig,
  HookMatcher,
  HookDefinition,
  CommandHookDefinition,
  PromptHookDefinition,
  HookExecutionResult,
  PendingPrompt,
  HookResult,
  SdkHookInput,
  SdkHookCallbackMatcher,
} from './types.ts';
import { APP_EVENTS, AGENT_EVENTS } from './types.ts';
import { buildEnvFromSdkInput } from './sdk-bridge.ts';

const log = createLogger('hooks');

// ---- Global State (legacy) ----
let config: HooksConfig | null = null;
let context: { sessionId?: string; workspaceId?: string; workingDir?: string } = {};

/** @deprecated Use HookSystem instead */
export interface InitHooksResult {
  success: boolean;
  errors: string[];
  hookCount: number;
}

/**
 * Initialize hooks from workspace.
 * @deprecated Use `new HookSystem(options)` instead.
 */
export function initHooks(options: {
  workspaceRootPath: string;
  sessionId?: string;
  workspaceId?: string;
  workingDir?: string;
  activeSourceSlugs?: string[];
}): InitHooksResult {
  const configPath = join(options.workspaceRootPath, 'hooks.json');
  log.debug(`[hooks] initHooks called: configPath=${configPath}`);

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

    const hookCount = Object.values(config.hooks).reduce(
      (sum, matchers) => sum + (matchers?.reduce((s, m) => s + m.hooks.length, 0) ?? 0),
      0
    );

    log.debug(`[hooks] Loaded ${hookCount} hooks from ${configPath}`);
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
 * Clear hooks (for cleanup/testing).
 * @deprecated Use `hookSystem.dispose()` instead.
 */
export function clearHooks(): void {
  config = null;
  context = {};
  clearPermissionsContext();
}

/**
 * Check if event is an app event (vs agent event).
 */
export function isAppEvent(event: string): event is AppEvent {
  return APP_EVENTS.includes(event as AppEvent);
}

/**
 * Get agent hooks (to pass to Claude SDK).
 * @deprecated Use `hookSystem.buildSdkHooks()` instead.
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

/**
 * Emit a hook event.
 * @deprecated Use `hookSystem.emit()` or `hookSystem.updateSessionMetadata()` instead.
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

  type HookWithMeta = { hook: HookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };
  const matchingHooks: HookWithMeta[] = [];

  if (event === 'SchedulerTick') {
    for (const m of matchers) {
      const cronMatches = m.cron && matchesCron(m.cron, m.timezone);
      if (m.cron && cronMatches) {
        for (const hook of m.hooks) {
          matchingHooks.push({ hook, permissionMode: m.permissionMode, labels: m.labels });
        }
      }
    }
  } else {
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

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CRAFT_EVENT: event,
    CRAFT_EVENT_DATA: JSON.stringify(data),
  };

  if (context.sessionId) env.CRAFT_SESSION_ID = context.sessionId;
  if (context.workspaceId) env.CRAFT_WORKSPACE_ID = context.workspaceId;
  if (context.workingDir) env.CRAFT_WORKING_DIR = context.workingDir;

  for (const [key, value] of Object.entries(data)) {
    const strValue = String(value);
    env[`CRAFT_${toSnakeCase(key).toUpperCase()}`] = typeof value === 'string' ? sanitizeForShell(strValue) : strValue;
  }

  type CommandWithMeta = { hook: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };
  type PromptWithMeta = { hook: PromptHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all'; labels?: string[] };

  const commandHooks: CommandWithMeta[] = matchingHooks
    .filter((h): h is HookWithMeta & { hook: CommandHookDefinition } => h.hook.type === 'command');
  const promptHooks: PromptWithMeta[] = matchingHooks
    .filter((h): h is HookWithMeta & { hook: PromptHookDefinition } => h.hook.type === 'prompt');

  if (promptHooks.length > 0 && !isAppEvent(event)) {
    console.warn(`[hooks] Prompt hooks are only supported for App events, ignoring ${promptHooks.length} prompt(s) for ${event}`);
  }

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

  const promptResults: HookExecutionResult[] = [];
  const pendingPrompts: PendingPrompt[] = [];

  if (isAppEvent(event)) {
    for (const { hook, labels } of promptHooks) {
      const expandedPrompt = expandEnvVars(hook.prompt, env);
      const references = parsePromptReferences(expandedPrompt);

      promptResults.push({
        type: 'prompt',
        prompt: hook.prompt,
        expandedPrompt,
        references,
      });

      const expandedLabels = labels?.map(label => expandEnvVars(label, env));

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

/**
 * Build SDK hooks callbacks from hooks.json definitions.
 * @deprecated Use `hookSystem.buildSdkHooks()` instead.
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
        const env = buildEnvFromSdkInput(event, input);
        const result = await executeHooksForSdkMatcher(matcher, event, env, options.signal);
        return result;
      }],
    }));
  }

  return sdkHooks;
}

async function executeHooksForSdkMatcher(
  matcher: HookMatcher,
  event: AgentEvent,
  env: Record<string, string>,
  signal?: AbortSignal
): Promise<{ continue: boolean; reason?: string }> {
  const commandHooks = matcher.hooks.filter((h): h is CommandHookDefinition => h.type === 'command');

  if (commandHooks.length === 0) {
    return { continue: true };
  }

  for (const hook of commandHooks) {
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
      continue;
    }

    if (!result.success) {
      console.warn(`[hooks] Command failed in ${event}: ${hook.command}`, result.stderr);
    }
  }

  return { continue: true };
}

/**
 * Get the current hooks config (for external access).
 * @deprecated Use `hookSystem.getConfig()` instead.
 */
export function getHooksConfig(): HooksConfig | null {
  return config;
}

// ============================================================================
// Re-exports from sub-modules
// ============================================================================

// Event logger
export { HookEventLogger, type LoggedHookEvent, type LoggedHookEventInput } from './event-logger.ts';

// Schemas
export { HooksConfigSchema, zodErrorToIssues, VALID_EVENTS } from './schemas.ts';

// Security utilities
export { sanitizeForShell } from './security.ts';

// Cron matching
export { matchesCron } from './cron-matcher.ts';

// Command executor
export {
  setPermissionsContext,
  clearPermissionsContext,
  isCommandAllowed,
  getPermissionsConfig,
  executeCommand,
  type CommandExecutionOptions,
  type CommandExecutionResult,
} from './command-executor.ts';

// Event Bus
export {
  WorkspaceEventBus,
  type EventBus,
  type EventPayloadMap,
  type BaseEventPayload,
  type LabelEventPayload,
  type PermissionModeChangePayload,
  type FlagChangePayload,
  type TodoStateChangePayload,
  type SchedulerTickPayload,
  type LabelConfigChangePayload,
  type GenericEventPayload,
  type EventHandler,
  type AnyEventHandler,
} from './event-bus.ts';

// HookSystem facade
export {
  HookSystem,
  type HookSystemOptions,
  type SessionMetadataSnapshot as HookSystemMetadataSnapshot,
} from './hook-system.ts';

// Handlers
export {
  CommandHandler,
  PromptHandler,
  EventLogHandler,
  type HookHandler,
  type CommandHandlerOptions,
  type PromptHandlerOptions,
  type EventLogHandlerOptions,
  type HooksConfigProvider,
} from './handlers/index.ts';
