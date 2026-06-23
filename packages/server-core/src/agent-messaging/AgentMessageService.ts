import { randomUUID } from 'node:crypto';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import {
  DEFAULT_MAX_DEPTH,
  normalizeMessageAgentInput,
  writeAgentMessageReceipt,
  type AgentMessageReceipt,
  type MessageAgentInput,
  type MessageAgentResult,
} from '@craft-agent/shared/agent-messaging';
import {
  appendOutputSchemaInstruction,
  parseStructuredStepOutput,
} from '@craft-agent/shared/workflows';
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types';
import type { AgentMessageNoticeMetadata } from '@craft-agent/core/types';

export interface AgentMessageRuntimeContext {
  workspaceId: string;
  parentSessionId?: string;
  parentRunId?: string;
  parentStepId?: string;
  callerAgentSlug?: string;
  callerAgentName?: string;
  parentPermissionMode: PermissionMode;
  depth?: number;
  maxDepth?: number;
}

export interface AgentMessageServiceDeps {
  createSession: (workspaceId: string, options: CreateSessionOptions) => Promise<{ id: string }>;
  resolveAgentSessionOptions: (workspaceId: string, agentSlug: string) => Promise<Partial<CreateSessionOptions>>;
  sendMessage: (sessionId: string, prompt: string, options?: { skillSlugs?: string[] }) => Promise<void>;
  abortSession: (sessionId: string) => Promise<void>;
  getLastAssistantText: (sessionId: string) => string;
  getSessionToolUseSummary: (sessionId: string) => { count: number; names: string[] };
  getWorkspaceRootPath: (workspaceId: string) => string;
  resolveUsableSourceSlugs?: (workspaceId: string, sourceSlugs: string[]) => { usable: string[]; unavailable: string[] };
  deliverPassiveMessage?: (sessionId: string, message: string, agentMessage?: AgentMessageNoticeMetadata) => Promise<void>;
  now?: () => string;
}

function summaryFromOutput(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000);
}

function buildDelegationPrompt(
  input: ReturnType<typeof normalizeMessageAgentInput>,
  runtime: Pick<AgentMessageRuntimeContext, 'callerAgentSlug' | 'parentSessionId'>,
): string {
  const parts = [
    'You are executing a delegated RunnerOS agent message.',
    '',
    `Delegating agent: ${runtime.callerAgentSlug ?? 'session'}`,
    `Target agent: ${input.agentSlug}`,
  ];

  if (runtime.parentSessionId) {
    parts.push(
      `Parent session ID: ${runtime.parentSessionId}`,
      '',
      `If you need to send an important progress update, blocker, or clarification back before your final result, use send_agent_message with sessionId "${runtime.parentSessionId}" and deliveryMode "passive".`,
      'Still return the requested final result in this delegated session.',
    );
  }

  parts.push('', 'Task:', input.task);

  if (input.context) {
    parts.push('', 'Context:', input.context);
  }
  if (input.expectedOutput) {
    parts.push('', 'Expected output:', input.expectedOutput);
  }
  if (input.sourceSlugs.length > 0) {
    parts.push('', `Allowed source slugs: ${input.sourceSlugs.join(', ')}`);
  }
  if (input.skillSlugs.length > 0) {
    parts.push('', `Requested skill slugs: ${input.skillSlugs.join(', ')}`);
  }

  parts.push(
    '',
    'Return only the requested result. Do not ask the user follow-up questions unless the task is impossible without them.',
  );

  const prompt = parts.join('\n');
  return input.outputSchema ? appendOutputSchemaInstruction(prompt, input.outputSchema) : prompt;
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function drainAfterAbort<T>(promise: Promise<T>, ms = 5000): Promise<void> {
  try {
    await timeout(promise, ms);
  } catch {
    // The receipt already records the timeout. Draining only prevents a late
    // rejection from escaping after the child session has been aborted.
  }
}

export class AgentMessageService {
  constructor(private readonly deps: AgentMessageServiceDeps) {}

  async messageAgent(
    runtime: AgentMessageRuntimeContext,
    rawInput: MessageAgentInput,
  ): Promise<MessageAgentResult> {
    const depth = runtime.depth ?? 0;
    const maxDepth = runtime.maxDepth ?? DEFAULT_MAX_DEPTH;
    const input = normalizeMessageAgentInput(rawInput, {
      parentPermissionMode: runtime.parentPermissionMode,
      depth,
      maxDepth,
    });
    const now = this.deps.now ?? (() => new Date().toISOString());
    const createdAt = now();
    const receipt: AgentMessageReceipt = {
      schemaVersion: 1,
      id: randomUUID(),
      workspaceId: runtime.workspaceId,
      parentSessionId: runtime.parentSessionId,
      parentRunId: runtime.parentRunId,
      parentStepId: runtime.parentStepId,
      callerAgentSlug: runtime.callerAgentSlug,
      targetAgentSlug: input.agentSlug,
      task: input.task,
      status: 'running',
      policy: {
        permissionMode: input.permissionMode,
        timeoutSeconds: input.timeoutSeconds,
        maxTurns: input.maxTurns,
        maxDepth,
        depth,
        background: input.background,
      },
      constraints: {
        sourceSlugs: input.sourceSlugs,
        skillSlugs: input.skillSlugs,
        outputSchema: input.outputSchema,
      },
      createdAt,
      updatedAt: createdAt,
    };

    const workspaceRootPath = this.deps.getWorkspaceRootPath(runtime.workspaceId);
    const persist = () => writeAgentMessageReceipt(workspaceRootPath, receipt);
    persist();

    const started = Date.now();
    try {
      const agentOptions = await this.deps.resolveAgentSessionOptions(runtime.workspaceId, input.agentSlug);
      if (input.sourceSlugs.length > 0 && this.deps.resolveUsableSourceSlugs) {
        const readiness = this.deps.resolveUsableSourceSlugs(runtime.workspaceId, input.sourceSlugs);
        if (readiness.unavailable.length > 0) {
          throw new Error(`Unavailable source(s): ${readiness.unavailable.join(', ')}`);
        }
      }

      const enabledSourceSlugs = input.sourceSlugs.length > 0
        ? input.sourceSlugs
        : agentOptions.enabledSourceSlugs;
      const agentSkillSlugs = input.skillSlugs.length > 0
        ? input.skillSlugs
        : agentOptions.agentSkillSlugs;
      const baseLaunchReceipt = agentOptions.launchReceipt;
      const baseInjected = baseLaunchReceipt?.injected;

      const child = await this.deps.createSession(runtime.workspaceId, {
        ...agentOptions,
        name: `Delegated: ${input.agentSlug}`,
        hidden: true,
        labels: [`agent-message-depth:${depth + 1}`],
        permissionMode: input.permissionMode,
        enabledSourceSlugs,
        agentSkillSlugs,
        spawnedFromAgent: {
          agentSlug: input.agentSlug,
          agentName: baseLaunchReceipt?.agent?.name ?? input.agentSlug,
          timestamp: Date.now(),
        },
        launchReceipt: {
          ...baseLaunchReceipt,
          createdAt: Date.now(),
          origin: 'agent',
          summary: `Delegated by ${runtime.callerAgentSlug ?? 'session'} via message_agent.`,
          agent: baseLaunchReceipt?.agent ?? {
            slug: input.agentSlug,
            name: input.agentSlug,
          },
          config: {
            ...(baseLaunchReceipt?.config ?? {}),
            permissionMode: input.permissionMode,
            model: agentOptions.model,
            llmConnection: agentOptions.llmConnection,
            thinkingLevel: agentOptions.thinkingLevel,
            workingDirectory: typeof agentOptions.workingDirectory === 'string' ? agentOptions.workingDirectory : undefined,
          },
          injected: {
            ...(baseInjected ?? {}),
            systemPromptChars: baseInjected?.systemPromptChars ?? agentOptions.customSystemPrompt?.length,
            skills: agentSkillSlugs ?? baseInjected?.skills ?? [],
            sources: enabledSourceSlugs ?? baseInjected?.sources ?? [],
            contextDocs: baseInjected?.contextDocs ?? [],
          },
        },
      });

      receipt.childSessionId = child.id;
      receipt.updatedAt = now();
      persist();

      const prompt = buildDelegationPrompt(input, runtime);
      const startSend = () => this.deps.sendMessage(child.id, prompt, { skillSlugs: input.skillSlugs });
      const finish = (sendPromise: Promise<void>) => this.finishDelegatedTurn({
        receipt,
        input,
        runtime,
        sendPromise,
        started,
        persist,
        now,
      });

      if (input.background) {
        await this.notifyBackgroundParentStarted(receipt, runtime);
        void finish(startSend());
        return this.resultFromReceipt(receipt, started);
      }

      return await finish(startSend());
    } catch (error) {
      receipt.status = 'failed';
      receipt.error = {
        code: 'message-agent-failed',
        message: error instanceof Error ? error.message : String(error),
      };
      receipt.updatedAt = now();
      receipt.completedAt = receipt.updatedAt;
      persist();
      return this.resultFromReceipt(receipt, started);
    }
  }

  private async finishDelegatedTurn(input: {
    receipt: AgentMessageReceipt;
    input: ReturnType<typeof normalizeMessageAgentInput>;
    runtime: AgentMessageRuntimeContext;
    sendPromise: Promise<void>;
    started: number;
    persist: () => void;
    now: () => string;
  }): Promise<MessageAgentResult> {
    const { receipt, runtime, sendPromise, started, persist, now } = input;
    const delegatedInput = input.input;

    try {
      const sent = await timeout(sendPromise, delegatedInput.timeoutSeconds * 1000);

      if (sent.timedOut) {
        if (receipt.childSessionId) {
          await this.deps.abortSession(receipt.childSessionId);
        }
        void drainAfterAbort(sendPromise);
        receipt.status = 'timed-out';
        receipt.error = { code: 'timeout', message: `Delegated agent timed out after ${delegatedInput.timeoutSeconds}s.` };
        receipt.updatedAt = now();
        receipt.completedAt = receipt.updatedAt;
        persist();
        await this.notifyBackgroundParent(receipt, runtime);
        return this.resultFromReceipt(receipt, started);
      }

      const text = receipt.childSessionId ? this.deps.getLastAssistantText(receipt.childSessionId) : '';
      let output: unknown = text;
      if (delegatedInput.outputSchema) {
        const parsed = parseStructuredStepOutput(text, delegatedInput.outputSchema);
        if (!parsed.ok) {
          receipt.status = 'failed';
          receipt.error = { code: parsed.code, message: parsed.message };
          receipt.updatedAt = now();
          receipt.completedAt = receipt.updatedAt;
          persist();
          await this.notifyBackgroundParent(receipt, runtime);
          return this.resultFromReceipt(receipt, started);
        }
        output = parsed.value;
      }

      const toolSummary = receipt.childSessionId
        ? this.deps.getSessionToolUseSummary(receipt.childSessionId)
        : { count: 0, names: [] };
      receipt.status = 'succeeded';
      receipt.result = {
        output,
        summary: summaryFromOutput(output),
        toolUseCount: toolSummary.count,
        toolNames: toolSummary.names,
      };
      receipt.updatedAt = now();
      receipt.completedAt = receipt.updatedAt;
      persist();
      await this.notifyBackgroundParent(receipt, runtime);
      return this.resultFromReceipt(receipt, started);
    } catch (error) {
      receipt.status = 'failed';
      receipt.error = {
        code: 'message-agent-failed',
        message: error instanceof Error ? error.message : String(error),
      };
      receipt.updatedAt = now();
      receipt.completedAt = receipt.updatedAt;
      persist();
      await this.notifyBackgroundParent(receipt, runtime);
      return this.resultFromReceipt(receipt, started);
    }
  }

  private async notifyBackgroundParent(
    receipt: AgentMessageReceipt,
    runtime: AgentMessageRuntimeContext,
  ): Promise<void> {
    if (!receipt.policy.background || !runtime.parentSessionId || !this.deps.deliverPassiveMessage) return;

    const lines = [
      `Background agent "${receipt.targetAgentSlug}" ${receipt.status === 'succeeded' ? 'finished' : 'stopped'}.`,
      `receiptId: ${receipt.id}`,
      receipt.childSessionId ? `childSessionId: ${receipt.childSessionId}` : undefined,
      receipt.result?.summary ? `summary: ${receipt.result.summary}` : undefined,
      receipt.error ? `error: ${receipt.error.code}: ${receipt.error.message}` : undefined,
    ].filter(Boolean);

    try {
      await this.deps.deliverPassiveMessage(runtime.parentSessionId, lines.join('\n'), {
        receiptId: receipt.id,
        childSessionId: receipt.childSessionId,
        targetAgentSlug: receipt.targetAgentSlug,
        status: receipt.status,
      });
    } catch {
      // Notification is best-effort; the receipt is the durable source of truth.
    }
  }

  private async notifyBackgroundParentStarted(
    receipt: AgentMessageReceipt,
    runtime: AgentMessageRuntimeContext,
  ): Promise<void> {
    if (!receipt.policy.background || !runtime.parentSessionId || !this.deps.deliverPassiveMessage) return;

    const lines = [
      `Background agent "${receipt.targetAgentSlug}" started.`,
      `receiptId: ${receipt.id}`,
      receipt.childSessionId ? `childSessionId: ${receipt.childSessionId}` : undefined,
    ].filter(Boolean);

    try {
      await this.deps.deliverPassiveMessage(runtime.parentSessionId, lines.join('\n'), {
        receiptId: receipt.id,
        childSessionId: receipt.childSessionId,
        targetAgentSlug: receipt.targetAgentSlug,
        status: 'running',
      });
    } catch {
      // Notification is best-effort; the receipt is the durable source of truth.
    }
  }

  private resultFromReceipt(receipt: AgentMessageReceipt, started: number): MessageAgentResult {
    return {
      ok: receipt.status === 'succeeded' || receipt.status === 'running',
      status: receipt.status,
      receiptId: receipt.id,
      childSessionId: receipt.childSessionId,
      agentSlug: receipt.targetAgentSlug,
      output: receipt.result?.output,
      summary: receipt.result?.summary,
      toolUseCount: receipt.result?.toolUseCount ?? 0,
      toolNames: receipt.result?.toolNames ?? [],
      durationMs: Math.max(0, Date.now() - started),
      error: receipt.error,
    };
  }
}
