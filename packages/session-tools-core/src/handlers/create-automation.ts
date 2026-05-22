import { Cron } from 'croner';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export type CreateAutomationEventName =
  | 'SchedulerTick'
  | 'WebhookReceive'
  | 'FileWatch'
  | 'PollUrl'
  | 'MessageReceive';

export interface CreateAutomationPromptAction {
  type: 'prompt';
  prompt: string;
  agentSlug?: string;
  bindMessagingChannel?: boolean;
  llmConnection?: string;
  model?: string;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface CreateAutomationWebhookAction {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyFormat?: 'json' | 'form' | 'raw';
  body?: unknown;
  captureResponse?: boolean;
  auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };
}

export interface CreateAutomationPulseAction {
  type: 'pulse';
  driverAgentSlug?: string;
  goalSlugs?: string[];
  diffWindowMinutes?: number;
  notify?: {
    bell?: boolean;
    conciergeChat?: boolean;
    messagingChannel?: string;
    minUrgencyForChannel?: 'low' | 'normal' | 'high';
  };
}

export type CreateAutomationAction =
  | CreateAutomationPromptAction
  | CreateAutomationWebhookAction
  | CreateAutomationPulseAction;

export interface CreateAutomationMatcher {
  name?: string;
  slug?: string;
  secretEnv?: string;
  allowUnauthenticated?: boolean;
  allowedMethods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  cron?: string;
  timezone?: string;
  watchPath?: string;
  watchGlob?: string;
  watchChangeTypes?: ('add' | 'change' | 'remove')[];
  pollUrl?: string;
  pollIntervalSec?: number;
  matcher?: string;
  enabled?: boolean;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  actions: CreateAutomationAction[];
  [key: string]: unknown;
}

export interface CreateAutomationToolInput {
  workspaceId?: string;
  eventName: CreateAutomationEventName;
  matcher: CreateAutomationMatcher;
}

export interface CreateAutomationResult {
  ok: boolean;
  slug?: string;
  eventName?: string;
  nextFireAt?: string;
  error?: string;
}

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  'SchedulerTick',
  'WebhookReceive',
  'FileWatch',
  'PollUrl',
  'MessageReceive',
]);

const WEBHOOK_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SECRET_ENV_RE = /^[A-Z_][A-Z0-9_]*$/;
const THINKING_LEVELS = new Set(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const URGENCIES = new Set(['low', 'normal', 'high']);
/** Minimum gap between consecutive Pulse fires (spec section 7). */
const PULSE_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Kept in sync with `normalizeStandardFiveFieldCron` in
 * `@craft-agent/shared/automations/cron-matcher.ts`. This package
 * deliberately does NOT import `@craft-agent/shared` (it's the cross-
 * backend "core" used by both Claude in-process and Codex subprocess —
 * see `update-preferences.ts:5`). Any change here must mirror there.
 */
export function normalizeStandardFiveFieldCron(expr: string | undefined): string | null {
  const trimmed = expr?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;
  if (trimmed.startsWith('@')) return null;
  return trimmed;
}

export async function handleCreateAutomation(
  ctx: SessionToolContext,
  args: CreateAutomationToolInput,
): Promise<ToolResult> {
  if (!ctx.createAutomation) {
    return errorResponse('create_automation is not available in this context.');
  }

  if (!args.eventName || !SUPPORTED_EVENTS.has(args.eventName)) {
    return errorResponse(
      `Unsupported eventName: "${args.eventName}". Use one of: SchedulerTick, WebhookReceive, FileWatch, PollUrl, MessageReceive.`,
    );
  }

  if (!args.matcher || typeof args.matcher !== 'object') {
    return errorResponse('matcher is required.');
  }

  const actions = args.matcher.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return errorResponse('matcher.actions must contain at least one action.');
  }

  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      return errorResponse('Each action must be an object with a "type" field.');
    }
    if (action.type === 'prompt') {
      if (!action.prompt || action.prompt.trim().length === 0) {
        return errorResponse('Prompt actions require a non-empty "prompt" string.');
      }
      if (action.thinkingLevel !== undefined && !THINKING_LEVELS.has(action.thinkingLevel)) {
        return errorResponse(
          `Invalid thinkingLevel "${action.thinkingLevel}". Use one of: off, low, medium, high, xhigh, max.`,
        );
      }
      if (action.agentSlug !== undefined && !SLUG_RE.test(action.agentSlug)) {
        return errorResponse(
          `Invalid agentSlug "${action.agentSlug}". Use lowercase letters, digits, hyphens (1-64 chars, no leading/trailing hyphen).`,
        );
      }
    } else if (action.type === 'webhook') {
      if (!action.url || typeof action.url !== 'string') {
        return errorResponse('Webhook actions require a "url" string.');
      }
    } else if (action.type === 'pulse') {
      if (args.eventName !== 'SchedulerTick') {
        return errorResponse('Pulse actions are only supported on SchedulerTick automations.');
      }
      const pulse = action as CreateAutomationPulseAction;
      if (pulse.driverAgentSlug !== undefined && !SLUG_RE.test(pulse.driverAgentSlug)) {
        return errorResponse(
          `Invalid driverAgentSlug "${pulse.driverAgentSlug}". Use lowercase letters, digits, hyphens (1-64 chars, no leading/trailing hyphen).`,
        );
      }
      if (pulse.goalSlugs !== undefined) {
        if (!Array.isArray(pulse.goalSlugs)) {
          return errorResponse('Pulse goalSlugs must be an array of context-doc slugs.');
        }
        for (const slug of pulse.goalSlugs) {
          if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
            return errorResponse(
              `Invalid goalSlug "${slug}". Use lowercase letters, digits, hyphens (1-64 chars, no leading/trailing hyphen).`,
            );
          }
        }
      }
      if (pulse.diffWindowMinutes !== undefined) {
        if (typeof pulse.diffWindowMinutes !== 'number' || !Number.isFinite(pulse.diffWindowMinutes) || pulse.diffWindowMinutes <= 0 || pulse.diffWindowMinutes > 1440) {
          return errorResponse('Pulse diffWindowMinutes must be a positive number ≤ 1440.');
        }
      }
      if (pulse.notify?.minUrgencyForChannel !== undefined && !URGENCIES.has(pulse.notify.minUrgencyForChannel)) {
        return errorResponse('Pulse notify.minUrgencyForChannel must be "low", "normal", or "high".');
      }
    } else {
      return errorResponse(`Unsupported action type: "${(action as { type?: string }).type}". Use "prompt", "webhook", or "pulse".`);
    }
  }

  if (args.eventName === 'SchedulerTick') {
    const cron = normalizeStandardFiveFieldCron(args.matcher.cron);
    if (!cron) {
      return errorResponse('SchedulerTick automations require a valid 5-field standard cron expression.');
    }
    let cronInstance: Cron;
    try {
      cronInstance = new Cron(cron);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(`Invalid cron expression "${args.matcher.cron}": ${msg}`);
    }

    const hasPulse = actions.some((a) => a && (a as { type?: string }).type === 'pulse');
    if (hasPulse) {
      const fires: Date[] = [];
      let cursor: Date | null = new Date();
      for (let i = 0; i < 5; i++) {
        const next = cronInstance.nextRun(cursor ?? undefined);
        if (!next) break;
        fires.push(next);
        cursor = next;
      }
      for (let i = 1; i < fires.length; i++) {
        const a = fires[i];
        const b = fires[i - 1];
        if (!a || !b) continue;
        const gap = a.getTime() - b.getTime();
        if (gap < PULSE_MIN_INTERVAL_MS) {
          return errorResponse(
            `Pulse cadence floor: SchedulerTick must fire no faster than every 10 minutes (got a ${Math.round(gap / 1000)}s gap).`,
          );
        }
      }
    }
  }

  if (args.eventName === 'WebhookReceive') {
    if (!args.matcher.slug) {
      return errorResponse('WebhookReceive automations require a "slug".');
    }
    if (!WEBHOOK_SLUG_RE.test(args.matcher.slug)) {
      return errorResponse(
        `Invalid webhook slug "${args.matcher.slug}". Use lowercase letters, digits, and hyphens (1-64 chars, no leading/trailing hyphen).`,
      );
    }
    if (args.matcher.secretEnv && !SECRET_ENV_RE.test(args.matcher.secretEnv)) {
      return errorResponse(
        'Invalid secretEnv. Use an uppercase env var name containing only letters, digits, and underscores, not starting with a digit.',
      );
    }
    if (!args.matcher.secretEnv && args.matcher.allowUnauthenticated !== true) {
      return errorResponse(
        'WebhookReceive automations require secretEnv unless allowUnauthenticated is explicitly true.',
      );
    }
  }

  try {
    const result = await ctx.createAutomation(args);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to create automation.');
    }
    const nextLine = result.nextFireAt ? ` Next fire: ${result.nextFireAt}.` : '';
    return successResponse(
      `Created automation in event ${result.eventName ?? args.eventName}.${nextLine}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(`Failed to create automation: ${msg}`);
  }
}
