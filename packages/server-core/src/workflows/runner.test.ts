/**
 * Workflows — runner tests
 *
 * Pure unit tests against a mock `WorkflowRunnerDeps`. We never spin up a
 * real SessionManager or hit an LLM. Persistence is verified by routing
 * `getWorkspaceRootPath` at a `mkdtempSync`'d directory and re-reading
 * the on-disk run.json.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRun,
  type LoadedWorkflow,
  type WorkflowMetadata,
  type WorkflowRunSnapshot,
} from '@craft-agent/shared/workflows';
import {
  WorkflowRunner,
  type WorkflowRunEvent,
  type WorkflowRunEventDetail,
  type WorkflowRunnerDeps,
} from './runner.ts';

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'wf-runner-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const WORKSPACE_ID = 'ws-test';

function makeWorkflow(metadata: Partial<WorkflowMetadata> = {}): LoadedWorkflow {
  const md: WorkflowMetadata = {
    name: 'Test',
    description: 'Test workflow',
    trigger: {
      type: 'manual',
      inputs: [{ name: 'topic', type: 'string', required: true }],
    },
    steps: [
      { id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' },
      { id: 'second', agent: 'writer', input: 'Write about: {{steps.first.output}}' },
    ],
    ...metadata,
  };
  return {
    slug: 'test-flow',
    metadata: md,
    body: '',
    path: '/tmp/fake',
    source: 'global',
  };
}

interface SessionRecord {
  id: string;
  prompts: string[];
  output: string;
  aborted: boolean;
  options: unknown;
  toolUseCount: number;
}

interface MockHarness {
  deps: WorkflowRunnerDeps;
  sessions: Map<string, SessionRecord>;
  promptsSent: Array<{ sessionId: string; prompt: string }>;
  events: WorkflowRunEvent[];
  /** Override what `sendMessage` does for a given step index. */
  setStepBehavior: (index: number, fn: (record: SessionRecord) => Promise<void>) => void;
}

function makeHarness(opts: { stepOutputs?: string[] } = {}): MockHarness {
  const sessions = new Map<string, SessionRecord>();
  const promptsSent: Array<{ sessionId: string; prompt: string }> = [];
  const events: WorkflowRunEvent[] = [];
  const stepBehaviors = new Map<number, (record: SessionRecord) => Promise<void>>();
  let stepCounter = 0;

  const deps: WorkflowRunnerDeps = {
    createSession: async (_workspaceId, _options) => {
      const id = `sess-${sessions.size + 1}`;
      const output = opts.stepOutputs?.[sessions.size] ?? `output-${sessions.size + 1}`;
      sessions.set(id, { id, prompts: [], output, aborted: false, options: _options, toolUseCount: 0 });
      return { id };
    },
    resolveAgentSessionOptions: async (_workspaceId, agentSlug) => ({
      customSystemPrompt: `persona:${agentSlug}`,
      agentSkillSlugs: [`${agentSlug}-skill`],
      enabledSourceSlugs: [`${agentSlug}-source`],
      permissionMode: 'safe',
      spawnedFromAgent: {
        agentSlug,
        agentName: `Agent ${agentSlug}`,
        timestamp: 1,
      },
    }),
    sendMessage: async (sessionId, prompt) => {
      const rec = sessions.get(sessionId);
      if (!rec) throw new Error(`unknown session ${sessionId}`);
      rec.prompts.push(prompt);
      promptsSent.push({ sessionId, prompt });
      const behavior = stepBehaviors.get(stepCounter);
      stepCounter += 1;
      if (behavior) await behavior(rec);
    },
    getLastAssistantText: (sessionId) => {
      const rec = sessions.get(sessionId);
      return rec?.output ?? '';
    },
    getSessionToolUseCount: (sessionId) => {
      return sessions.get(sessionId)?.toolUseCount ?? 0;
    },
    abortSession: async (sessionId) => {
      const rec = sessions.get(sessionId);
      if (rec) rec.aborted = true;
    },
    getWorkspaceRootPath: (_workspaceId) => workspaceRoot,
    emit: (event) => {
      events.push(event);
    },
  };

  return {
    deps,
    sessions,
    promptsSent,
    events,
    setStepBehavior: (index, fn) => stepBehaviors.set(index, fn),
  };
}

/** Wait until the predicate returns true or `maxMs` elapses. */
async function waitFor(pred: () => boolean, maxMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!pred()) throw new Error(`waitFor timed out after ${maxMs}ms`);
}

function lastCompleted(events: WorkflowRunEvent[]): WorkflowRunSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'run.completed') return e.run;
  }
  return undefined;
}

function findUpdatedDetail(
  events: WorkflowRunEvent[],
  kind: WorkflowRunEventDetail['kind'],
): WorkflowRunEventDetail | undefined {
  for (const event of events) {
    if (event.type === 'run.updated' && event.detail?.kind === kind) return event.detail;
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('WorkflowRunner', () => {
  test('happy path: 2-step workflow succeeds and threads outputs via templater', async () => {
    const h = makeHarness({ stepOutputs: ['STEP_ONE_OUT', 'STEP_TWO_OUT'] });
    const runner = new WorkflowRunner(h.deps);

    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    expect(start.state).toBe('running');
    expect(start.steps).toHaveLength(2);

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.state).toBe('succeeded');
    expect(completed.steps[0]!.output).toBe('STEP_ONE_OUT');
    expect(completed.steps[1]!.state).toBe('succeeded');
    expect(completed.steps[1]!.output).toBe('STEP_TWO_OUT');
    expect(h.sessions.get('sess-1')!.options).toMatchObject({
      customSystemPrompt: 'persona:researcher',
      agentSkillSlugs: ['researcher-skill'],
      enabledSourceSlugs: ['researcher-source'],
      permissionMode: 'safe',
      spawnedFromAgent: { agentSlug: 'researcher', agentName: 'Agent researcher' },
    });

    // Templater threading: step 1 received the trigger input, step 2
    // received step 1's output substituted into its prompt.
    expect(h.promptsSent[0]!.prompt).toStartWith('Research cats');
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: STEP_ONE_OUT');

    // Persisted to disk.
    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.state).toBe('succeeded');
    expect(onDisk!.steps[1]!.output).toBe('STEP_TWO_OUT');
  });

  test('cancel mid-run: run is cancelled and active session is aborted exactly once', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    let runId: string | undefined;
    let resolveStep: (() => void) | undefined;
    const stepPending = new Promise<void>((resolve) => {
      resolveStep = resolve;
    });

    // Step 0 waits until we cancel, then resolves.
    h.setStepBehavior(0, async () => {
      await stepPending;
    });

    const start = await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });
    runId = start.id;

    // Wait until the first session has been spawned + sendMessage entered.
    await waitFor(() => h.promptsSent.length === 1);

    await runner.cancel(WORKSPACE_ID, runId);
    const cancelledOnDisk = readRun(workspaceRoot, runId);
    expect(cancelledOnDisk?.state).toBe('cancelled');
    expect(cancelledOnDisk?.steps[0]!.error?.code).toBe('cancelled');
    resolveStep!();

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('cancelled');

    // Only the first session was spawned + aborted; second step never ran.
    expect(h.sessions.size).toBe(1);
    const onlySession = [...h.sessions.values()][0]!;
    expect(onlySession.aborted).toBe(true);
    expect(h.promptsSent).toHaveLength(1);
  });

  test('step throws: run fails, second step is never run, error recorded', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('boom');
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error).toEqual({ code: 'step-threw', message: 'boom' });
    expect(completed.steps[1]!.state).toBe('queued');
    expect(h.sessions.size).toBe(1);
  });

  test('onFailure continue records failed step and runs later steps', async () => {
    const h = makeHarness({ stepOutputs: ['unused', 'RECOVERED'] });
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('recoverable');
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            onFailure: 'continue',
          },
          { id: 'second', agent: 'writer', input: 'Write fallback' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error).toEqual({ code: 'step-threw', message: 'recoverable' });
    expect(completed.steps[1]!.state).toBe('succeeded');
    expect(completed.steps[1]!.output).toBe('RECOVERED');
    expect(h.promptsSent.map((p) => p.prompt.split('\n\n---\n\n')[0])).toEqual(['Research t', 'Write fallback']);

    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({
      kind: 'step.failed',
      stepId: 'first',
      attempts: 1,
      onFailure: 'continue',
      error: { code: 'step-threw', message: 'recoverable' },
    });

    const onDisk = readRun(workspaceRoot, completed.id);
    expect(onDisk?.state).toBe('succeeded');
    expect(onDisk?.steps[0]!.state).toBe('failed');
    expect(onDisk?.steps[1]!.state).toBe('succeeded');
  });

  test('onFailure ask is parsed by the runner but stops without checkpoint support', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    h.setStepBehavior(0, async () => {
      throw new Error('needs human');
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            onFailure: 'ask',
          },
          { id: 'second', agent: 'writer', input: 'Write fallback' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[1]!.state).toBe('queued');
    expect(h.sessions.size).toBe(1);
    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({ onFailure: 'ask' });
  });

  test('structured output: parses JSON and exposes dot-paths to later steps', async () => {
    const h = makeHarness({
      stepOutputs: ['{"title":"Reliable workflows","count":2}', 'DONE'],
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            outputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                count: { type: 'number' },
              },
              required: ['title'],
            },
          },
          { id: 'second', agent: 'writer', input: 'Write about: {{steps.first.output.title}}' },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.output).toEqual({ title: 'Reliable workflows', count: 2 });
    expect(h.promptsSent[0]!.prompt).toContain('Return only JSON');
    expect(h.promptsSent[0]!.prompt).toContain('"title"');
    expect(h.promptsSent[0]!.prompt.lastIndexOf('Return only JSON')).toBeGreaterThan(
      h.promptsSent[0]!.prompt.lastIndexOf('Workflow step completion contract'),
    );
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: Reliable workflows');
  });

  test('structured output retries after invalid JSON and records attempt count', async () => {
    const h = makeHarness({ stepOutputs: ['not json', '{"title":"Recovered"}'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            outputSchema: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
            retries: 1,
          },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.attempts).toBe(2);
    expect(completed.steps[0]!.output).toEqual({ title: 'Recovered' });
    expect(h.sessions.size).toBe(2);
    expect(findUpdatedDetail(h.events, 'step.retrying')).toMatchObject({
      kind: 'step.retrying',
      stepId: 'first',
      attempt: 1,
      maxAttempts: 2,
      error: { code: 'invalid-structured-output' },
    });
  });

  test('retry attempt clears stale output and completion evidence while running', async () => {
    const h = makeHarness({ stepOutputs: ['short', 'long enough'] });
    let releaseSecondAttempt: (() => void) | undefined;
    h.setStepBehavior(1, async () => {
      await new Promise<void>((resolve) => { releaseSecondAttempt = resolve; });
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { minOutputChars: 10 },
          retries: 1,
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => h.promptsSent.length === 2);
    const latest = [...h.events].reverse().find((event) => event.type === 'run.updated') as
      | Extract<WorkflowRunEvent, { type: 'run.updated' }>
      | undefined;
    expect(latest?.run.steps[0]!.attempts).toBe(2);
    expect(latest?.run.steps[0]!.state).toBe('running');
    expect(latest?.run.steps[0]!.output).toBeUndefined();
    expect(latest?.run.steps[0]!.completion).toBeUndefined();

    releaseSecondAttempt!();
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
  });

  test('timeout aborts the attempt and fails when retries are exhausted', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);
    h.setStepBehavior(0, async () => {
      await new Promise(() => {});
    });

    await runner.start({
      workflow: makeWorkflow({
        steps: [
          {
            id: 'first',
            agent: 'researcher',
            input: 'Research {{trigger.topic}}',
            timeout: 0.01,
          },
        ],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'cats' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);

    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.state).toBe('failed');
    expect(completed.steps[0]!.error?.code).toBe('timeout');
    expect(h.sessions.get('sess-1')!.aborted).toBe(true);
    expect(findUpdatedDetail(h.events, 'step.failed')).toMatchObject({
      kind: 'step.failed',
      stepId: 'first',
      attempts: 1,
      onFailure: 'stop',
      error: { code: 'timeout' },
      timeoutSeconds: 0.01,
    });
  });

  test('concurrency: starting a second run for the same workflow+workspace rejects', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.setStepBehavior(0, async () => {
      await gate;
    });

    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });

    // Wait until the first run has actually entered its first step.
    await waitFor(() => h.promptsSent.length === 1);

    await expect(
      runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      }),
    ).rejects.toThrow(/already has an active run/);

    // Drain.
    release!();
    await waitFor(() => lastCompleted(h.events) !== undefined);
  });

  test('initial persist failure rejects start and releases the concurrency slot', async () => {
    const h = makeHarness();
    const blockedPath = join(workspaceRoot, 'not-a-directory');
    writeFileSync(blockedPath, 'blocked');
    let rootPath = blockedPath;
    h.deps.getWorkspaceRootPath = () => rootPath;
    const runner = new WorkflowRunner(h.deps);

    await expect(
      runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      }),
    ).rejects.toThrow();

    rootPath = workspaceRoot;
    await runner.start({
      workflow: makeWorkflow(),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 't' },
    });
    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect(lastCompleted(h.events)!.state).toBe('succeeded');
  });

  test('unexpected loop crash marks run failed and releases the concurrency slot', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const h = makeHarness();
    const blockedPath = join(workspaceRoot, 'not-a-directory');
    writeFileSync(blockedPath, 'blocked');
    let persistCall = 0;
    h.deps.getWorkspaceRootPath = () => {
      persistCall += 1;
      return persistCall === 2 ? blockedPath : workspaceRoot;
    };
    const runner = new WorkflowRunner(h.deps);

    try {
      const start = await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      });

      await waitFor(() => lastCompleted(h.events) !== undefined);
      const crashed = lastCompleted(h.events)!;
      expect(crashed.id).toBe(start.id);
      expect(crashed.state).toBe('failed');
      expect(crashed.steps[0]!.error?.code).toBe('runner-crashed');

      await runner.start({
        workflow: makeWorkflow(),
        workspaceId: WORKSPACE_ID,
        triggerInputs: { topic: 't' },
      });
      await waitFor(() => h.events.filter((e) => e.type === 'run.completed').length === 2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('uses the run snapshot even if the source workflow object is mutated mid-run', async () => {
    const h = makeHarness({ stepOutputs: ['ONE', 'TWO'] });
    const runner = new WorkflowRunner(h.deps);
    const workflow = makeWorkflow();

    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.setStepBehavior(0, async () => {
      await gate;
    });

    await runner.start({
      workflow,
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'snapshot' },
    });
    await waitFor(() => h.promptsSent.length === 1);

    workflow.metadata.name = 'Mutated';
    workflow.metadata.steps[1]!.input = 'MUTATED {{steps.first.output}}';
    release!();

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.workflowSnapshot.metadata.name).toBe('Test');
    expect(h.promptsSent[1]!.prompt).toStartWith('Write about: ONE');
  });

  test('workflow step sessions are hidden from the main session list', async () => {
    const h = makeHarness();
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({ steps: [{ id: 'first', agent: 'researcher', input: 'Research {{trigger.topic}}' }] }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'hidden' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    expect((h.sessions.get('sess-1')!.options as { hidden?: boolean }).hidden).toBe(true);
  });

  test('completion contract fails a step that does not use tools when required', async () => {
    const h = makeHarness({ stepOutputs: ['Draft text'] });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { requireToolUse: true },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'tool gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('failed');
    expect(completed.steps[0]!.error?.code).toBe('completion-tool-use-required');
    expect(completed.steps[0]!.completion).toEqual({
      outputChars: 'Draft text'.length,
      toolUseCount: 0,
      satisfied: false,
    });
    expect(h.promptsSent[0]!.prompt).toContain('You must use at least one available tool');
  });

  test('completion contract accepts a step with required tool use and enough output', async () => {
    const h = makeHarness({ stepOutputs: ['A sufficiently detailed result'] });
    h.setStepBehavior(0, async (record) => {
      record.toolUseCount = 1;
    });
    const runner = new WorkflowRunner(h.deps);

    await runner.start({
      workflow: makeWorkflow({
        steps: [{
          id: 'first',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}',
          completion: { requireToolUse: true, minOutputChars: 10 },
        }],
      }),
      workspaceId: WORKSPACE_ID,
      triggerInputs: { topic: 'tool gate' },
    });

    await waitFor(() => lastCompleted(h.events) !== undefined);
    const completed = lastCompleted(h.events)!;
    expect(completed.state).toBe('succeeded');
    expect(completed.steps[0]!.completion).toEqual({
      outputChars: 'A sufficiently detailed result'.length,
      toolUseCount: 1,
      satisfied: true,
    });
  });
});
