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
import { WorkflowRunner, type WorkflowRunEvent, type WorkflowRunnerDeps } from './runner.ts';

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
      sessions.set(id, { id, prompts: [], output, aborted: false, options: _options });
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
    expect(h.promptsSent[0]!.prompt).toBe('Research cats');
    expect(h.promptsSent[1]!.prompt).toBe('Write about: STEP_ONE_OUT');

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
    expect(h.promptsSent[1]!.prompt).toBe('Write about: ONE');
  });
});
