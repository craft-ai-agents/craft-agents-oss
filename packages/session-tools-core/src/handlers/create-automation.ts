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
  llmConnection?: string;
  model?: string;
  thinkingLevel?: 'high' | 'medium' | 'low' | 'disabled';
}

export interface CreateAutomationWebhookAction {
  type: 'webhook';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export type CreateAutomationAction =
  | CreateAutomationPromptAction
  | CreateAutomationWebhookAction;

export interface CreateAutomationMatcher {
  name?: string;
  slug?: string;
  secretEnv?: string;
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
    } else if (action.type === 'webhook') {
      if (!action.url || typeof action.url !== 'string') {
        return errorResponse('Webhook actions require a "url" string.');
      }
    } else {
      return errorResponse(`Unsupported action type: "${(action as { type?: string }).type}". Use "prompt" or "webhook".`);
    }
  }

  if (args.eventName === 'SchedulerTick') {
    const cron = normalizeStandardFiveFieldCron(args.matcher.cron);
    if (!cron) {
      return errorResponse('SchedulerTick automations require a valid 5-field standard cron expression.');
    }
    try {
      new Cron(cron);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(`Invalid cron expression "${args.matcher.cron}": ${msg}`);
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
