/**
 * Pi SDK settings for Craft-embedded sessions.
 *
 * `createAgentSession` defaults to `SettingsManager.create(cwd, agentDir)`, which
 * merges the *working directory's* `.pi/settings.json` (project scope, trusted by
 * default) on top of `agentDir/settings.json`, and persists every SDK-side
 * settings write (e.g. `setModel` → defaultProvider/defaultModel) into the
 * session's `.pi-agent/` folder. Neither is wanted here: Craft owns model,
 * thinking level and compaction for its sessions, a repo checked out as the
 * working directory must not be able to flip retry/compaction/tool defaults,
 * and nothing should be written next to the session transcript.
 *
 * The in-memory manager starts from the SDK defaults and pins the retry policy
 * explicitly. The main process surfaces the resulting `auto_retry_*` events —
 * see `packages/shared/src/agent/backend/pi/event-adapter.ts`.
 *
 * The working directory is never a trusted Pi project: trust would auto-load
 * `<cwd>/.pi/extensions` (code that runs in this process and can hook every
 * provider request), `.pi`/`.agents` skills, prompts and `SYSTEM.md` from
 * whatever repository the user opened. Craft owns the system prompt, skills
 * and tools for its sessions, so none of that is wanted.
 */
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { LLM_QUERY_TIMEOUT_MS } from '../../shared/src/agent/llm-tool.ts';

type PiSettings = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>;

export type CraftPiSessionPurpose = 'main' | 'ephemeral';

/**
 * Finish inside the host RPC timeout so the subprocess has time to serialize a
 * targeted result and the host can clear its pending request before its own
 * deadline fires.
 */
export const CRAFT_PI_EPHEMERAL_QUERY_DEADLINE_MS = LLM_QUERY_TIMEOUT_MS - 5_000;

/**
 * Main-chat retry policy for transient provider/transport errors.
 *
 * Agent-level (`AgentSession._prepareRetry`, classifier `isRetryableAssistantError`
 * in pi-ai): re-runs a failed assistant turn with exponential backoff
 * `baseDelayMs * 2^(attempt-1)`. Four retries wait 2 s + 4 s + 8 s + 16 s ≈ 30 s.
 *
 * Provider-level (`retryProviderRequest` in pi-ai): pre-stream retries for
 * 408/409/429/5xx honoring `retry-after` up to `maxRetryDelayMs`, mirroring the
 * OpenAI/Anthropic SDK default of 2. (Pi SDK default: 0.)
 */
export const CRAFT_PI_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 4,
  baseDelayMs: 2_000,
  // Cap for one agent-level backoff sleep (`retryDelayMs` in pi-ai, SDK default
  // 60 s). Four retries at a 2 s base never reach it; pinned so the policy is
  // fully explicit.
  maxAgentDelayMs: 60_000,
  provider: {
    maxRetries: 2,
    maxRetryDelayMs: 60_000,
  },
} as const;

/**
 * Smaller retry budget for utility sessions (`call_llm`, titles, summaries).
 *
 * These calls have an end-to-end 120-second RPC budget and a 115-second child
 * deadline. In the worst configured case, provider-directed sleeps consume at
 * most 60 seconds (two 10-second sleeps in each of three agent attempts) and
 * agent backoff consumes another 6 seconds, leaving headroom for request and
 * cleanup latency.
 */
export const CRAFT_PI_EPHEMERAL_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 60_000,
  provider: {
    maxRetries: 2,
    maxRetryDelayMs: 10_000,
  },
} as const;

export const CRAFT_PI_EPHEMERAL_MAX_BACKOFF_MS =
  CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetries *
    CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetryDelayMs *
    (CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.maxRetries + 1) +
  CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.baseDelayMs *
    (2 ** CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.maxRetries - 1);

/** Settings applied to one Pi session, isolated from project/global Pi files. */
export function buildCraftPiSettings(purpose: CraftPiSessionPurpose = 'main'): PiSettings {
  const retry = purpose === 'ephemeral'
    ? CRAFT_PI_EPHEMERAL_RETRY_SETTINGS
    : CRAFT_PI_RETRY_SETTINGS;

  return {
    // Deliver all steers pending at a turn boundary in one model call.
    steeringMode: 'all',
    retry: {
      enabled: retry.enabled,
      maxRetries: retry.maxRetries,
      baseDelayMs: retry.baseDelayMs,
      maxAgentDelayMs: retry.maxAgentDelayMs,
      provider: { ...retry.provider },
    },
    // PiAgent re-asserts auto-compaction on every subprocess start
    // (requestSetAutoCompaction(true)); keep the SDK default explicit here so
    // the intent is visible next to the retry policy.
    compaction: { enabled: true },
    // Pi >=1.0 keeps the prompt cache warm while a run is in progress (a long
    // tool call, a pending permission prompt) by replaying the last request
    // with a 1-token output cap shortly before the cache expires, only when
    // the expected saving is at least $0.05. Keep that SDK default for chats;
    // utility sessions are one-shot and disposed right after their prompt.
    cacheWarming: purpose === 'ephemeral' ? 'off' : 'streaming',
  };
}

const isPositiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/**
 * Pi compacts once context exceeds `contextWindow − reserveTokens` and has no
 * threshold setting of its own, so Craft's "Compact context at" (config.json
 * `autoCompactWindow`) becomes a per-model reserve. Never below Pi's own
 * reserve: a window at or beyond the model's limit keeps Pi's default trigger.
 */
export function compactionReserveFor(
  contextWindow: unknown,
  baseReserve: number,
  autoCompactWindow: number | undefined,
): number {
  if (!isPositiveInt(contextWindow) || !isPositiveInt(autoCompactWindow)) return baseReserve;
  return Math.max(baseReserve, contextWindow - autoCompactWindow);
}

export interface CraftSettingsManagerOptions {
  /** Compact once context reaches this many tokens (config.json `autoCompactWindow`). */
  autoCompactWindow?: number;
}

/**
 * Fresh in-memory settings manager for one Pi session. Cheap to create; not
 * shared between the main session and `queryLlm` ephemeral sessions so a
 * `setModel` on one can never leak a "default model" into the other.
 */
export function createCraftSettingsManager(
  purpose: CraftPiSessionPurpose = 'main',
  { autoCompactWindow }: CraftSettingsManagerOptions = {},
): SettingsManager {
  const manager = SettingsManager.inMemory(buildCraftPiSettings(purpose), { projectTrusted: false });
  if (!isPositiveInt(autoCompactWindow)) return manager;

  // The reserve depends on the active model's window, which can change mid-session.
  // Every SDK compaction check (and Craft's context bar) reads it through
  // getCompactionSettings(model), so this one hook covers all model switches.
  // SettingsManager has a private constructor, so it can't be subclassed instead.
  const getCompactionSettings = manager.getCompactionSettings.bind(manager);
  manager.getCompactionSettings = (model) => {
    const settings = getCompactionSettings(model);
    const contextWindow = (model as { contextWindow?: unknown } | undefined)?.contextWindow;
    return {
      ...settings,
      reserveTokens: compactionReserveFor(contextWindow, settings.reserveTokens, autoCompactWindow),
    };
  };
  return manager;
}
