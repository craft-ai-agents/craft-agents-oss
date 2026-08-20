/**
 * KnowledgeHandler - Processes knowledge + cloud_run.submit actions for App events
 *
 * Subscribes to the event bus (onAny) and, for knowledge App events + CloudRunCompleted,
 * matches automations and delegates writes to injected executors.
 *
 * v1 safety floor lives in the executor (server-core): SiYuan ops only propose.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, AutomationsConfigProvider } from './types.ts';
import {
  type AppEvent,
  type AutomationEvent,
  type CloudRunSubmitAction,
  type KnowledgeAutomationAction,
  type KnowledgeActionRef,
  type CraftActionRef,
} from '../types.ts';
import { matcherMatches, buildEnvFromPayload, expandEnvVars } from '../utils.ts';
import { deriveAutomationName } from '../name-utils.ts';

const log = createLogger('knowledge-handler');

// ============================================================================
// Executor contracts (implemented in server-core)
// ============================================================================

export interface KnowledgeActionExecutorContext {
  event: AutomationEvent;
  payload: Record<string, unknown>;
  matcherId?: string;
  automationName: string;
  workspaceId: string;
  workspaceRootPath: string;
  env: Record<string, string>;
  /** Attribute allow-list from the matcher (set_attribute hint) */
  attributeAllowList?: string[];
}

export interface KnowledgeActionExecutorResult {
  ok: boolean;
  proposalId?: string;
  linkId?: string;
  error?: string;
  /** True when set_attribute name is outside matcher.attributeAllowList */
  outsideAllowList?: boolean;
}

export interface KnowledgeActionExecutor {
  execute(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecutorContext,
  ): Promise<KnowledgeActionExecutorResult>;
}

export interface CloudRunSubmitExecutorContext {
  event: AutomationEvent;
  payload: Record<string, unknown>;
  matcherId?: string;
  automationName: string;
  workspaceId: string;
  workspaceRootPath: string;
  env: Record<string, string>;
}

export interface CloudRunSubmitExecutorResult {
  ok: boolean;
  runId?: string;
  error?: string;
}

export interface CloudRunSubmitExecutor {
  submit(
    action: CloudRunSubmitAction,
    ctx: CloudRunSubmitExecutorContext,
  ): Promise<CloudRunSubmitExecutorResult>;
}

// ============================================================================
// Options
// ============================================================================

export interface KnowledgeHandlerOptions {
  workspaceId: string;
  workspaceRootPath: string;
  knowledgeExecutor: KnowledgeActionExecutor;
  cloudRunSubmitExecutor?: CloudRunSubmitExecutor;
  onError?: (event: AutomationEvent, error: Error) => void;
  onKnowledgeResults?: (results: KnowledgeActionExecutorResult[]) => void;
  onCloudRunResults?: (results: CloudRunSubmitExecutorResult[]) => void;
}

/** Events this handler processes (knowledge lifecycle + cloud run completion). */
const KNOWLEDGE_HANDLER_EVENTS: ReadonlyArray<AppEvent> = [
  'KnowledgeDocumentCreated',
  'KnowledgeDocumentUpdated',
  'KnowledgeAttributeChanged',
  'KnowledgeDatabaseRowChanged',
  'KnowledgeDocumentStale',
  'CloudRunCompleted',
];

// ============================================================================
// Template / env expansion
// ============================================================================

/** Expand {{event.foo.bar}} paths against the event payload. */
function expandEventTemplates(str: string, payload: Record<string, unknown>): string {
  return str.replace(/\{\{\s*event\.([^}]+?)\s*\}\}/g, (_, path: string) => {
    const parts = path.trim().split('.');
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === null || cur === undefined) return '';
    return typeof cur === 'string' ? cur : String(cur);
  });
}

function expandString(
  value: string | undefined,
  env: Record<string, string>,
  payload: Record<string, unknown>,
): string | undefined {
  if (value === undefined) return undefined;
  return expandEnvVars(expandEventTemplates(value, payload), env);
}

function expandRefValue(
  ref: KnowledgeActionRef | CraftActionRef | undefined,
  env: Record<string, string>,
  payload: Record<string, unknown>,
): KnowledgeActionRef | CraftActionRef | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === 'string') {
    return expandString(ref, env, payload);
  }
  const expanded: { scheme: string; kind: string; id: string; provider?: string; connectionId?: string } = {
    scheme: ref.scheme,
    kind: expandString(ref.kind, env, payload) ?? ref.kind,
    id: expandString(ref.id, env, payload) ?? ref.id,
  };
  if ('provider' in ref && typeof ref.provider === 'string') {
    expanded.provider = expandString(ref.provider, env, payload);
  }
  if ('connectionId' in ref && typeof ref.connectionId === 'string') {
    expanded.connectionId = expandString(ref.connectionId, env, payload);
  }
  return expanded as typeof ref;
}

function expandKnowledgeAction(
  action: KnowledgeAutomationAction,
  env: Record<string, string>,
  payload: Record<string, unknown>,
): KnowledgeAutomationAction {
  let attributes: Record<string, string> | undefined;
  if (action.attributes) {
    attributes = {};
    for (const [k, v] of Object.entries(action.attributes)) {
      attributes[expandString(k, env, payload) ?? k] = expandString(v, env, payload) ?? v;
    }
  }

  return {
    ...action,
    notebook: expandString(action.notebook, env, payload),
    path: expandString(action.path, env, payload),
    markdown: expandString(action.markdown, env, payload),
    parentRef: expandRefValue(action.parentRef, env, payload) as KnowledgeAutomationAction['parentRef'],
    targetRef: expandRefValue(action.targetRef, env, payload) as KnowledgeAutomationAction['targetRef'],
    knowledgeRef: expandRefValue(action.knowledgeRef, env, payload) as KnowledgeAutomationAction['knowledgeRef'],
    craftRef: expandRefValue(action.craftRef, env, payload) as KnowledgeAutomationAction['craftRef'],
    relation: expandString(action.relation, env, payload),
    name: expandString(action.name, env, payload),
    value: expandString(action.value, env, payload),
    baseHash: expandString(action.baseHash, env, payload),
    patchMarkdown: expandString(action.patchMarkdown, env, payload),
    runId: expandString(action.runId, env, payload),
    targetNotebook: expandString(action.targetNotebook, env, payload),
    targetPath: expandString(action.targetPath, env, payload),
    attributes,
  };
}

function expandCloudRunAction(
  action: CloudRunSubmitAction,
  env: Record<string, string>,
  payload: Record<string, unknown>,
): CloudRunSubmitAction {
  return {
    ...action,
    skillSlug: expandString(action.skillSlug, env, payload),
    topic: expandString(action.topic, env, payload),
    callbackTag: expandString(action.callbackTag, env, payload),
    sessionId: expandString(action.sessionId, env, payload),
    labels: action.labels?.map((l) => expandString(l, env, payload) ?? l),
  };
}

// ============================================================================
// KnowledgeHandler
// ============================================================================

export class KnowledgeHandler implements AutomationHandler {
  private readonly options: KnowledgeHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;
  private disposed = false;

  constructor(options: KnowledgeHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  subscribe(bus: EventBus): void {
    if (this.disposed) return;
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[KnowledgeHandler] Subscribed to event bus`);
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (this.disposed) return;

    if (!(KNOWLEDGE_HANDLER_EVENTS as readonly string[]).includes(event)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    const payloadRecord = payload as unknown as Record<string, unknown>;
    const env = buildEnvFromPayload(event, payload);

    const knowledgeResults: KnowledgeActionExecutorResult[] = [];
    const cloudResults: CloudRunSubmitExecutorResult[] = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payloadRecord)) continue;

      const automationName = deriveAutomationName(event, matcher);
      const matcherId = matcher.id;

      for (const action of matcher.actions) {
        if (this.disposed) return;

        try {
          if (action.type === 'knowledge') {
            const expanded = expandKnowledgeAction(action, env, payloadRecord);
            const result = await this.options.knowledgeExecutor.execute(expanded, {
              event,
              payload: payloadRecord,
              matcherId,
              automationName,
              workspaceId: this.options.workspaceId,
              workspaceRootPath: this.options.workspaceRootPath,
              env,
              attributeAllowList: matcher.attributeAllowList,
            });
            knowledgeResults.push(result);
            if (!result.ok) {
              log.debug(
                `[KnowledgeHandler] knowledge.${expanded.op} failed: ${result.error ?? 'unknown'}`,
              );
            }
          } else if (action.type === 'cloud_run.submit') {
            const executor = this.options.cloudRunSubmitExecutor;
            if (!executor) {
              const err = 'cloud_run.submit executor not configured';
              cloudResults.push({ ok: false, error: err });
              log.debug(`[KnowledgeHandler] ${err}`);
              continue;
            }
            const expanded = expandCloudRunAction(action, env, payloadRecord);
            const result = await executor.submit(expanded, {
              event,
              payload: payloadRecord,
              matcherId,
              automationName,
              workspaceId: this.options.workspaceId,
              workspaceRootPath: this.options.workspaceRootPath,
              env,
            });
            cloudResults.push(result);
            if (!result.ok) {
              log.debug(`[KnowledgeHandler] cloud_run.submit failed: ${result.error ?? 'unknown'}`);
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          log.error(`[KnowledgeHandler] Action error for ${event}:`, err);
          this.options.onError?.(event, err);
          if (action.type === 'knowledge') {
            knowledgeResults.push({ ok: false, error: err.message });
          } else if (action.type === 'cloud_run.submit') {
            cloudResults.push({ ok: false, error: err.message });
          }
        }
      }
    }

    if (knowledgeResults.length > 0) {
      this.options.onKnowledgeResults?.(knowledgeResults);
    }
    if (cloudResults.length > 0) {
      this.options.onCloudRunResults?.(cloudResults);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug(`[KnowledgeHandler] Disposed`);
  }
}
