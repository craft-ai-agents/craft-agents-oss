import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TokenUsage } from '@craft-agent/core/types';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import { parseTaskSpec, saveTaskSpec, readRunLog, readNodeOutput, type TaskSpec } from '@craft-agent/shared/tasks';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import { TaskRunner, type ConductorSessionHost, type TaskRunnerDeps } from './TaskRunner';
import type { DecisionResult } from '@craft-agent/shared/decisions';

// Flush pending microtasks so the runner's async dispatch (create → column → send) settles.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function tu(inputTokens: number, outputTokens: number): TokenUsage {
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, contextTokens: 0, costUsd: 0 };
}

function specOf(raw: unknown): TaskSpec {
  const r = parseTaskSpec(raw);
  if (!r.success) throw new Error('bad fixture: ' + JSON.stringify(r.error.issues));
  return r.data;
}

type CompletionOpts = Pick<SessionCompletionEvent, 'finalText' | 'backgroundWorkRunning' | 'fromUser' | 'tokenUsage'> & { reason?: SessionCompletionEvent['reason'] };

/** Mock host: records calls; the test drives completions via complete(). */
class MockHost implements ConductorSessionHost {
  // A Set iterated as a snapshot, mirroring SessionManager.emitSessionComplete — the Conductor keeps
  // its main subscription AND a one-shot verdict listener attached at the same time while a run is
  // `verifying`, and re-attaches the latter synchronously inside the handler.
  private readonly listeners = new Set<(evt: SessionCompletionEvent) => void>();
  readonly created: { id: string; options: CreateSessionOptions }[] = [];
  readonly sent: { sessionId: string; message: string }[] = [];
  readonly statuses: { sessionId: string; status: string }[] = [];
  readonly columns: { sessionId: string; column: string | null }[] = [];
  readonly nodeCounts: { sessionId: string; count: number }[] = [];
  readonly cancelled: string[] = [];

  async createSession(_workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }> {
    const id = `sess-${options.name}`;
    this.created.push({ id, options });
    return { id };
  }
  async sendMessage(sessionId: string, message: string): Promise<void> {
    this.sent.push({ sessionId, message });
  }
  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    this.statuses.push({ sessionId, status });
  }
  async setKanbanColumn(sessionId: string, column: string | null): Promise<void> {
    this.columns.push({ sessionId, column });
  }
  async setTaskNodeCount(sessionId: string, count: number): Promise<void> {
    this.nodeCounts.push({ sessionId, count });
  }
  async cancelProcessing(sessionId: string): Promise<void> {
    this.cancelled.push(sessionId);
  }
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  workingDirById = new Map<string, string>();
  getSessionWorkingDirectory(sessionId: string): string | undefined {
    return this.workingDirById.get(sessionId);
  }
  parentById = new Map<string, string>();
  getSessionParentId(sessionId: string): string | undefined {
    return this.parentById.get(sessionId);
  }

  // --- test helpers (sessionId is derived from the node title, which defaults to the node id) ---
  sessionIdFor(nodeId: string): string {
    return `sess-${nodeId}`;
  }
  promptFor(nodeId: string): string | undefined {
    return this.sent.find((s) => s.sessionId === this.sessionIdFor(nodeId))?.message;
  }
  dispatchedNames(): string[] {
    return this.created.map((c) => c.options.name!).filter(Boolean);
  }
  complete(nodeId: string, opts: CompletionOpts = {}): void {
    this.completeSession(this.sessionIdFor(nodeId), opts);
  }
  /** Fire a completion for an arbitrary session id (e.g. the orchestrator's verification verdict). */
  completeSession(sessionId: string, opts: CompletionOpts = {}): void {
    const evt: SessionCompletionEvent = {
      sessionId,
      workspaceId: 'ws',
      reason: opts.reason ?? 'complete',
      finalText: opts.finalText,
      backgroundWorkRunning: opts.backgroundWorkRunning,
      fromUser: opts.fromUser,
      tokenUsage: opts.tokenUsage,
    };
    for (const listener of [...this.listeners]) listener(evt);
  }
}

describe('TaskRunner (Conductor)', () => {
  let root: string;
  let host: MockHost;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conductor-test-'));
    host = new MockHost();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeRunner(extra: Partial<Pick<TaskRunnerDeps, 'decide' | 'classifyNodeOutcome' | 'pickRepairNodes'>> = {}) {
    return new TaskRunner({ host, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z', ...extra });
  }

  /** Decision-model stub answering the verdict choice (and optional per-node nouls). */
  function decisionResult(choice: 'pass' | 'fail' | 'unclear', opts: { confidence?: number; probability?: number; rework?: Record<string, number> } = {}): DecisionResult {
    const p = opts.probability ?? 0.95;
    const answers: DecisionResult['answers'] = {
      verdict: {
        type: 'choice',
        choice,
        confidence: opts.confidence ?? 0.9,
        probabilities: { pass: choice === 'pass' ? p : (1 - p) / 2, fail: choice === 'fail' ? p : (1 - p) / 2, unclear: choice === 'unclear' ? p : 0 },
      },
    };
    for (const [id, noul] of Object.entries(opts.rework ?? {})) answers[`rework:${id}`] = { type: 'noul', noul };
    return {
      model: 'jev-1.13.0',
      modelReported: true,
      requestedModel: 'jev-1.13.0',
      answers,
      usage: { inputTokens: 10, outputTokens: 1 },
      latencyMs: 50,
      state: { sha256: 'x', bytes: 10, truncated: false },
    };
  }

  it('runs a dependency chain, feeding each output into the next', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'demo',
        title: 'Demo',
        goal: 'audit then design then implement',
        nodes: [
          { id: 'audit', prompt: 'Audit the code' },
          { id: 'design', depends_on: ['audit'], prompt: 'Design using ${nodes.audit.output}' },
          { id: 'impl', depends_on: ['design'], prompt: 'Implement ${nodes.design.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('demo', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    expect(host.dispatchedNames()).toEqual(['audit']);
    expect(host.promptFor('audit')).toBe('Audit the code');

    host.complete('audit', { finalText: 'AUDIT', tokenUsage: tu(10, 5) });
    await tick();
    expect(host.dispatchedNames()).toEqual(['audit', 'design']);
    expect(host.promptFor('design')).toBe('Design using AUDIT');

    host.complete('design', { finalText: 'DESIGN', tokenUsage: tu(20, 10) });
    await tick();
    expect(host.promptFor('impl')).toBe('Implement DESIGN');

    host.complete('impl', { finalText: 'IMPL', tokenUsage: tu(5, 5) });
    await tick();

    // All nodes done → the run is verifying (not yet terminal) until the orchestrator returns a verdict.
    expect(runner.getRunState('demo', 'r1')!.status).toBe('verifying');
    expect(host.sent.some((s) => s.sessionId === 'orch' && s.message.includes('finished running'))).toBe(true);

    host.completeSession('orch', { finalText: 'Looks correct.\nVERDICT: PASS' });
    await tick();

    const snap = runner.getRunState('demo', 'r1')!;
    expect(snap.status).toBe('completed');
    expect(snap.nodes.every((n) => n.state === 'done')).toBe(true);
    expect(snap.tokensUsed).toBe(55);

    // Run-log + node output persisted.
    const log = readRunLog(root, 'demo', 'r1');
    expect(log[0]).toMatchObject({ kind: 'run-started' });
    expect(log.some((e) => e.kind === 'run-completed')).toBe(true);
    expect(readNodeOutput(root, 'demo', 'r1', 'audit')).toEqual({ text: 'AUDIT' });
  });

  it('passes llmConnection (node value, else the task default) to createSession', async () => {
    // Regression: pi/* models complete instantly with empty output unless the child session is
    // created with the connection slug that serves the model.
    saveTaskSpec(
      root,
      specOf({
        id: 'conn',
        title: 'Conn',
        goal: 'g',
        defaults: { llmConnection: 'default-conn' },
        nodes: [
          { id: 'a', prompt: 'a', model: 'pi/gpt-5.5', llmConnection: 'pi-conn' },
          { id: 'b', prompt: 'b', model: 'claude-opus-4-8' }, // inherits the task default
        ],
      }),
    )
    const runner = makeRunner()
    runner.run('conn', { runId: 'r1' })
    await tick()

    const optsA = host.created.find((c) => c.options.name === 'a')?.options
    const optsB = host.created.find((c) => c.options.name === 'b')?.options
    expect(optsA?.llmConnection).toBe('pi-conn')
    expect(optsB?.llmConnection).toBe('default-conn')
  })

  it('resolves permissionMode: node override → task default → child (never the workspace default)', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'perm',
        title: 'Perm',
        goal: 'g',
        defaults: { permissionMode: 'ask' },
        nodes: [
          { id: 'a', prompt: 'a', permissionMode: 'safe' }, // node override wins
          { id: 'b', prompt: 'b' }, // inherits the task default
        ],
      }),
    )
    const runner = makeRunner()
    runner.run('perm', { runId: 'r1' })
    await tick()

    expect(host.created.find((c) => c.options.name === 'a')?.options.permissionMode).toBe('safe')
    expect(host.created.find((c) => c.options.name === 'b')?.options.permissionMode).toBe('ask')
  })

  it('defaults an omitted permission mode to allow-all (unattended-safe), not undefined/ask', async () => {
    // A hand-authored spec that sets no permission mode must NOT fall through to the workspace default
    // (which could be `ask` → the unattended child would hang). The runner supplies an explicit default.
    saveTaskSpec(
      root,
      specOf({ id: 'perm2', title: 'Perm2', goal: 'g', nodes: [{ id: 'c', prompt: 'c' }] }),
    )
    const runner = makeRunner()
    runner.run('perm2', { runId: 'r1' })
    await tick()

    expect(host.created.find((c) => c.options.name === 'c')?.options.permissionMode).toBe('allow-all')
  })

  it('stamps task/run/node linkage on each dispatched child session', async () => {
    // The manual subtask composer skips Conductor-owned children by checking taskRunId.
    saveTaskSpec(
      root,
      specOf({ id: 'link', title: 'Link', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }),
    )
    const runner = makeRunner()
    runner.run('link', { runId: 'r1', orchestratorSessionId: 'orch' })
    await tick()

    const optsA = host.created.find((c) => c.options.name === 'a')?.options
    expect(optsA?.taskSlug).toBe('link')
    expect(optsA?.taskRunId).toBe('r1')
    expect(optsA?.taskNodeId).toBe('a')
  })

  it('creates a child session per node (createSession announces each to the renderer by default)', async () => {
    // Renderer visibility depends on createSession emitting session_created; the runner's job is
    // simply to create one session per node (the host's createSession owns the announcement).
    saveTaskSpec(
      root,
      specOf({ id: 'announce', title: 'Announce', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] }),
    )
    const runner = makeRunner()
    runner.run('announce', { runId: 'r1' })
    await tick()

    expect(host.created.map((c) => c.id)).toEqual([host.sessionIdFor('a'), host.sessionIdFor('b')])
  })

  it("children inherit the orchestrator's working directory (falling back to spec.cwd)", async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'cwd', title: 'Cwd', goal: 'g', cwd: '/spec/dir', nodes: [{ id: 'a', prompt: 'a' }] }),
    )
    host.workingDirById.set('orch', '/parent/dir')
    const runner = makeRunner()
    runner.run('cwd', { runId: 'r1', orchestratorSessionId: 'orch' })
    await tick()
    // Orchestrator cwd wins over the spec default.
    expect(host.created.find((c) => c.options.name === 'a')?.options.workingDirectory).toBe('/parent/dir')

    // With no orchestrator cwd, the spec's declared cwd is used.
    host.created.length = 0
    host.workingDirById.clear()
    const runner2 = makeRunner()
    runner2.run('cwd', { runId: 'r2', orchestratorSessionId: 'orch' })
    await tick()
    expect(host.created.find((c) => c.options.name === 'a')?.options.workingDirectory).toBe('/spec/dir')
  })

  it('refuses to run on a sub-session, but accepts an orchestrator id it does not know', async () => {
    saveTaskSpec(root, specOf({ id: 'sub', title: 'Sub', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }))
    host.parentById.set('child', 'orch')
    const runner = makeRunner()
    expect(() => runner.run('sub', { runId: 'r1', orchestratorSessionId: 'child' })).toThrow('sub-session of orch')
    await tick()
    expect(host.created).toEqual([])

    runner.run('sub', { runId: 'r2', orchestratorSessionId: 'unknown' })
    await tick()
    expect(host.dispatchedNames()).toEqual(['a'])
  })

  it('moves the orchestrator tile to in-progress on start and done on completion', async () => {
    saveTaskSpec(root, specOf({ id: 'col', title: 'Col', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }))
    const runner = makeRunner()
    runner.run('col', { runId: 'r1', orchestratorSessionId: 'orch', verifyOnComplete: false })
    await tick()
    expect(host.columns).toContainEqual({ sessionId: 'orch', column: 'in-progress' })

    host.complete('a', { finalText: 'A' })
    await tick()
    expect(host.columns).toContainEqual({ sessionId: 'orch', column: 'done' })
  })

  it('runs a fan-out and joins at the synthesizer', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'fan',
        title: 'Fan',
        goal: 'g',
        nodes: [
          { id: 'design', prompt: 'design' },
          { id: 'impl-a', depends_on: ['design'], prompt: 'A: ${nodes.design.output}' },
          { id: 'impl-b', depends_on: ['design'], prompt: 'B: ${nodes.design.output}' },
          { id: 'review', depends_on: ['impl-a', 'impl-b'], prompt: 'review ${nodes.impl-a.output} ${nodes.impl-b.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('fan', { runId: 'r1' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['design']);

    host.complete('design', { finalText: 'D' });
    await tick();
    // Both siblings dispatch in parallel; review waits for the barrier.
    expect(host.dispatchedNames().sort()).toEqual(['design', 'impl-a', 'impl-b']);
    expect(host.promptFor('review')).toBeUndefined();

    host.complete('impl-a', { finalText: 'A' });
    await tick();
    expect(host.promptFor('review')).toBeUndefined(); // still waiting on impl-b

    host.complete('impl-b', { finalText: 'B' });
    await tick();
    expect(host.promptFor('review')).toBe('review A B');

    host.complete('review', { finalText: 'R' });
    await tick();
    expect(runner.getRunState('fan', 'r1')!.status).toBe('completed');
  });

  it('marks a node failed, leaves dependents pending, and settles the run as failed', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'fail',
        title: 'F',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('fail', { runId: 'r1' });
    await tick();

    host.complete('a', { reason: 'error' });
    await tick();

    const snap = runner.getRunState('fail', 'r1')!;
    expect(snap.status).toBe('failed');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('failed');
    expect(snap.nodes.find((n) => n.id === 'b')!.state).toBe('pending');
    expect(host.promptFor('b')).toBeUndefined();
    expect(host.statuses.some((s) => s.sessionId === 'sess-a' && s.status === 'needs-review')).toBe(true);

    const log = readRunLog(root, 'fail', 'r1');
    expect(log.some((e) => e.kind === 'node-finished' && (e as { state?: string }).state === 'failed')).toBe(true);
    expect(log.some((e) => e.kind === 'run-failed')).toBe(true);
  });

  it('honors max_parallel', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'par',
        title: 'P',
        goal: 'g',
        max_parallel: 1,
        nodes: [
          { id: 'x', prompt: 'x' },
          { id: 'y', prompt: 'y' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('par', { runId: 'r1' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['x']); // only one slot

    host.complete('x', { finalText: 'X' });
    await tick();
    expect(host.dispatchedNames()).toEqual(['x', 'y']);

    host.complete('y', { finalText: 'Y' });
    await tick();
    expect(runner.getRunState('par', 'r1')!.status).toBe('completed');
  });

  it('pauses scheduling and resumes', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'pz',
        title: 'Pz',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('pz', { runId: 'r1' });
    await tick();

    runner.pause('pz', 'r1');
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(host.promptFor('b')).toBeUndefined(); // paused → no scheduling
    expect(runner.getRunState('pz', 'r1')!.status).toBe('paused');

    runner.resume('pz', 'r1');
    await tick();
    expect(host.promptFor('b')).toBe('b A');

    host.complete('b', { finalText: 'B' });
    await tick();
    expect(runner.getRunState('pz', 'r1')!.status).toBe('completed');
  });

  it('stops a run and cancels in-flight children', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'st',
        title: 'St',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('st', { runId: 'r1' });
    await tick();

    await runner.stop('st', 'r1');
    const snap = runner.getRunState('st', 'r1')!;
    expect(snap.status).toBe('stopped');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('cancelled');
    expect(host.cancelled).toContain('sess-a');
  });

  it('resumes a run from the persisted run-log after a restart, reusing finished node outputs', async () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'res',
        title: 'Res',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
        ],
      }),
    );
    // First runner: complete 'a' (output persisted), leave 'b' pending, then "crash" (drop the runner).
    const r1 = makeRunner();
    r1.run('res', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    r1.pause('res', 'r1'); // so completing 'a' does not dispatch 'b'
    host.complete('a', { finalText: 'A', tokenUsage: tu(3, 4) });
    await tick();
    expect(readNodeOutput(root, 'res', 'r1', 'a')).toEqual({ text: 'A' });

    // Simulate an app restart: a brand-new runner + host with empty in-memory state.
    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r2.resume('res', 'r1'); // not in memory → rehydrate from the run-log
    await tick();

    // 'a' is reused from disk (NOT re-spawned); only 'b' dispatches, seeded with a's recovered output.
    expect(host2.dispatchedNames()).toEqual(['b']);
    expect(host2.promptFor('b')).toBe('b A');
    // The orchestrator linkage is recovered from the run-log.
    expect(host2.created.find((c) => c.options.name === 'b')?.options.parentSessionId).toBe('orch');

    host2.complete('b', { finalText: 'B' });
    await tick();
    // Resumed run re-verifies (orchestrator recovered from the run-log) before going terminal.
    expect(r2.getRunState('res', 'r1')!.status).toBe('verifying');
    host2.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(r2.getRunState('res', 'r1')!.status).toBe('completed');
  });

  it('retries a failed node up to retry.limit, then fails', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rt', title: 'Rt', goal: 'g', nodes: [{ id: 'a', prompt: 'do a', retry: { limit: 1 } }] }),
    );
    const runner = makeRunner();
    runner.run('rt', { runId: 'r1' });
    await tick();

    // First failure → within budget → re-dispatched (still running, attempt 2).
    host.complete('a', { reason: 'error' });
    await tick();
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(2);
    let snap = runner.getRunState('rt', 'r1')!;
    expect(snap.nodes[0]!.state).toBe('running');
    expect(snap.nodes[0]!.attempt).toBe(2);

    // Second failure → budget exhausted → failed.
    host.complete('a', { reason: 'error' });
    await tick();
    snap = runner.getRunState('rt', 'r1')!;
    expect(snap.status).toBe('failed');
    expect(snap.nodes[0]!.state).toBe('failed');
    expect(readRunLog(root, 'rt', 'r1').some((e) => e.kind === 'node-retry')).toBe(true);
  });

  it('does not retry when retry.limit is 0', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rt0', title: 'Rt0', goal: 'g', nodes: [{ id: 'a', prompt: 'a', retry: { limit: 0 } }] }),
    );
    const runner = makeRunner();
    runner.run('rt0', { runId: 'r1' });
    await tick();
    host.complete('a', { reason: 'error' });
    await tick();
    expect(runner.getRunState('rt0', 'r1')!.status).toBe('failed');
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
  });

  it('feeds the prior failure into the retried prompt and can then succeed', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rtok', title: 'RtOk', goal: 'g', nodes: [{ id: 'a', prompt: 'do a', retry: { limit: 2 } }] }),
    );
    const runner = makeRunner();
    runner.run('rtok', { runId: 'r1' });
    await tick();

    host.complete('a', { reason: 'error' });
    await tick();
    const retryPrompt = host.sent.filter((s) => s.sessionId === 'sess-a')[1]!.message;
    expect(retryPrompt).toContain('Previous attempt failed: error');
    expect(retryPrompt).toContain('do a');

    host.complete('a', { finalText: 'OK' });
    await tick();
    expect(runner.getRunState('rtok', 'r1')!.status).toBe('completed');
  });

  it('does not retry on error when retry.when targets a different failure class', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'rtw', title: 'RtW', goal: 'g', nodes: [{ id: 'a', prompt: 'a', retry: { limit: 3, when: 'empty' } }] }),
    );
    const runner = makeRunner();
    runner.run('rtw', { runId: 'r1' });
    await tick();
    host.complete('a', { reason: 'error' });
    await tick();
    expect(runner.getRunState('rtw', 'r1')!.status).toBe('failed');
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
  });

  it('completes without verifying when there is no orchestrator', async () => {
    saveTaskSpec(root, specOf({ id: 'nov', title: 'NoV', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('nov', { runId: 'r1' }); // no orchestratorSessionId → nothing to verify against
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('nov', 'r1')!.status).toBe('completed');
    expect(readRunLog(root, 'nov', 'r1').some((e) => e.kind === 'run-verifying')).toBe(false);
  });

  it('gates the run on the orchestrator verdict and includes acceptance_criteria in the prompt', async () => {
    saveTaskSpec(
      root,
      specOf({ id: 'vp', title: 'Vp', goal: 'g', acceptance_criteria: 'must be perfect', nodes: [{ id: 'a', prompt: 'do a' }] }),
    );
    const runner = makeRunner();
    runner.run('vp', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('vp', 'r1')!.status).toBe('verifying');
    const vmsg = host.sent.find((s) => s.sessionId === 'orch')!.message;
    expect(vmsg).toContain('must be perfect');
    expect(vmsg).toContain('VERDICT: PASS');

    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('vp', 'r1')!.status).toBe('completed');
  });

  it('re-runs the terminal node once on a FAIL verdict, then completes on PASS', async () => {
    saveTaskSpec(root, specOf({ id: 'vf', title: 'Vf', goal: 'g', nodes: [{ id: 'a', prompt: 'do a' }] }));
    const runner = makeRunner();
    runner.run('vf', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'first' });
    await tick();

    host.completeSession('orch', { finalText: 'Not good enough.\nVERDICT: FAIL — missing X' });
    await tick();
    const snap = runner.getRunState('vf', 'r1')!;
    expect(snap.status).toBe('running');
    expect(snap.nodes[0]!.state).toBe('running');
    expect(snap.nodes[0]!.attempt).toBe(2);
    const retryPrompt = host.sent.filter((s) => s.sessionId === 'sess-a')[1]!.message;
    expect(retryPrompt).toContain('rejected on verification: missing X');

    host.complete('a', { finalText: 'second' });
    await tick();
    expect(runner.getRunState('vf', 'r1')!.status).toBe('verifying');
    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('vf', 'r1')!.status).toBe('completed');
  });

  it('fails the run when FAIL verdicts exhaust the repair budget (max_iterations)', async () => {
    // max_iterations: 1 → one repair allowed; the second FAIL breaches the iteration budget.
    saveTaskSpec(root, specOf({ id: 'vff', title: 'Vff', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'do a' }] }));
    const runner = makeRunner();
    runner.run('vff', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — nope' });
    await tick();
    expect(runner.getRunState('vff', 'r1')!.status).toBe('running'); // first repair in flight

    host.complete('a', { finalText: 'y' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — still nope' });
    await tick();
    expect(runner.getRunState('vff', 'r1')!.status).toBe('failed');
    const log = readRunLog(root, 'vff', 'r1');
    expect(log.filter((e) => e.kind === 'verdict').length).toBe(2);
    expect(log.some((e) => e.kind === 'budget-breach' && (e as { metric?: string }).metric === 'iterations')).toBe(true);
    expect(log.some((e) => e.kind === 'run-failed')).toBe(true);
  });

  it('re-asks on an unparsable verdict and fails only after the re-ask budget is exhausted', async () => {
    saveTaskSpec(root, specOf({ id: 'unp', title: 'Unp', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('unp', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();

    // First malformed reply → re-asked, run stays verifying (not terminal).
    host.completeSession('orch', { finalText: 'I think it is fine but forgot the verdict line.' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('verifying');
    expect(host.sent.filter((s) => s.sessionId === 'orch' && s.message.includes('did not include a parseable verdict')).length).toBe(1);

    // Second malformed reply → re-asked again (MAX_UNPARSED_REASKS = 2).
    host.completeSession('orch', { finalText: 'still no verdict line, sorry' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('verifying');

    // Third malformed reply → budget exhausted → failed.
    host.completeSession('orch', { finalText: 'nope, no verdict again' });
    await tick();
    expect(runner.getRunState('unp', 'r1')!.status).toBe('failed');
    expect(readRunLog(root, 'unp', 'r1').filter((e) => e.kind === 'verdict' && (e as { result?: string }).result === 'unparsed').length).toBe(3);
  });

  it('scopes a repair to the named nodes and their transitive dependents', async () => {
    // Chain a → b → c. A FAIL naming only `b` must re-run b AND c (downstream), but leave a done.
    saveTaskSpec(
      root,
      specOf({
        id: 'scope',
        title: 'Scope',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b ${nodes.a.output}' },
          { id: 'c', depends_on: ['b'], prompt: 'c ${nodes.b.output}' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('scope', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'A' });
    await tick();
    host.complete('b', { finalText: 'B' });
    await tick();
    host.complete('c', { finalText: 'C' });
    await tick();
    expect(runner.getRunState('scope', 'r1')!.status).toBe('verifying');

    host.completeSession('orch', { finalText: 'VERDICT: FAIL — nodes=b — b is wrong' });
    await tick();
    const snap = runner.getRunState('scope', 'r1')!;
    expect(snap.status).toBe('running');
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('done'); // upstream untouched
    expect(snap.nodes.find((n) => n.id === 'b')!.state).toBe('running'); // re-dispatched
    expect(snap.nodes.find((n) => n.id === 'c')!.state).toBe('pending'); // waits on b
    // a ran once; b re-dispatched (2); c not yet re-dispatched.
    expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
    expect(host.created.filter((c) => c.options.name === 'b')).toHaveLength(2);
    expect(host.created.filter((c) => c.options.name === 'c')).toHaveLength(1);
  });

  describe('repair scoping via the decision model', () => {
    const chain = [
      { id: 'a', prompt: 'fetch the data' },
      { id: 'b', depends_on: ['a'], prompt: 'summarize ${nodes.a.output}' },
      { id: 'c', depends_on: ['b'], prompt: 'format ${nodes.b.output}' },
    ];
    const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

    async function failWithoutNodes(slug: string, runner: TaskRunner) {
      saveTaskSpec(root, specOf({ id: slug, title: slug, goal: 'g', nodes: chain }));
      runner.run(slug, { runId: 'r1', orchestratorSessionId: 'orch' });
      await tick();
      for (const id of ['a', 'b', 'c']) {
        host.complete(id, { finalText: id.toUpperCase() });
        await tick();
      }
      host.completeSession('orch', { finalText: 'VERDICT: FAIL — the summary drops the totals' });
      await settle();
      return runner.getRunState(slug, 'r1')!;
    }

    it('repairs only the subtasks the reason implicates, and their dependents', async () => {
      const asked: Array<{ reason: string; ids: string[] }> = [];
      const runner = makeRunner({
        pickRepairNodes: async (reason, nodes) => { asked.push({ reason, ids: nodes.map((n) => n.id) }); return ['b']; },
      });
      const snap = await failWithoutNodes('pick', runner);
      expect(asked).toEqual([{ reason: 'the summary drops the totals', ids: ['a', 'b', 'c'] }]);
      expect(snap.status).toBe('running');
      expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('done');
      expect(snap.nodes.find((n) => n.id === 'b')!.state).toBe('running');
      expect(snap.nodes.find((n) => n.id === 'c')!.state).toBe('pending');
    });

    it('repairs the whole DAG when the model has no answer or fails', async () => {
      for (const [slug, pick] of [
        ['none', async () => null],
        ['boom', async () => { throw new Error('down'); }],
      ] as const) {
        const snap = await failWithoutNodes(slug, makeRunner({ pickRepairNodes: pick }));
        expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('running');
      }
    });

    it('repairs the whole DAG when a narrowed repair fails again', async () => {
      const asked: string[] = [];
      const runner = makeRunner({ pickRepairNodes: async (reason) => { asked.push(reason); return ['c']; } });
      const first = await failWithoutNodes('escalate', runner);
      expect(first.nodes.map((n) => n.state)).toEqual(['done', 'done', 'running']);
      host.complete('c', { finalText: 'C again' });
      await tick();
      host.completeSession('orch', { finalText: 'VERDICT: FAIL — the summary drops the totals' });
      await settle();
      expect(asked).toHaveLength(1);
      expect(runner.getRunState('escalate', 'r1')!.nodes.find((n) => n.id === 'a')!.state).toBe('running');
    });

    it('does not scope a FAIL the decision model read out of a reply without a VERDICT line', async () => {
      let asked = 0;
      const runner = makeRunner({
        decide: async () => decisionResult('fail'),
        pickRepairNodes: async () => { asked++; return ['c']; },
      });
      saveTaskSpec(root, specOf({ id: 'decided-fail', title: 'decided-fail', goal: 'g', nodes: chain }));
      runner.run('decided-fail', { runId: 'r1', orchestratorSessionId: 'orch' });
      await tick();
      for (const id of ['a', 'b', 'c']) {
        host.complete(id, { finalText: id });
        await tick();
      }
      host.completeSession('orch', { finalText: 'Not quite there: the totals are missing.' });
      await settle();
      expect(asked).toBe(0);
      expect(runner.getRunState('decided-fail', 'r1')!.nodes.find((n) => n.id === 'a')!.state).toBe('running');
    });

    it('never consults the model when the verdict names the subtasks', async () => {
      let asked = 0;
      const runner = makeRunner({ pickRepairNodes: async () => { asked++; return ['a']; } });
      saveTaskSpec(root, specOf({ id: 'named', title: 'named', goal: 'g', nodes: chain }));
      runner.run('named', { runId: 'r1', orchestratorSessionId: 'orch' });
      await tick();
      for (const id of ['a', 'b', 'c']) {
        host.complete(id, { finalText: id });
        await tick();
      }
      host.completeSession('orch', { finalText: 'VERDICT: FAIL — nodes=c — formatting' });
      await settle();
      expect(asked).toBe(0);
      expect(runner.getRunState('named', 'r1')!.nodes.find((n) => n.id === 'b')!.state).toBe('done');
    });
  });

  describe('decision-model verdicts (unparsed replies only)', () => {
    async function runToVerifying(slug: string, runner: TaskRunner, nodes: Array<{ id: string; prompt: string; deps?: string[] }>) {
      saveTaskSpec(root, specOf({ id: slug, title: slug, goal: 'g', nodes }));
      runner.run(slug, { runId: 'r1', orchestratorSessionId: 'orch' });
      await tick();
      for (const n of nodes) {
        host.complete(n.id, { finalText: `${n.id} output` });
        await tick();
      }
      expect(runner.getRunState(slug, 'r1')!.status).toBe('verifying');
    }

    it('completes on a confident PASS read out of a reply without a VERDICT line', async () => {
      const requests: unknown[] = [];
      const runner = makeRunner({ decide: async (request) => { requests.push(request); return decisionResult('pass'); } });
      await runToVerifying('dv-pass', runner, [{ id: 'a', prompt: 'a' }]);

      host.completeSession('orch', { finalText: 'Everything checks out, the summary matches the criteria.' });
      await tick();
      expect(runner.getRunState('dv-pass', 'r1')!.status).toBe('completed');
      expect(requests).toHaveLength(1);
      expect(host.sent.some((s) => s.message.includes('did not include a parseable verdict'))).toBe(false);
      const verdicts = readRunLog(root, 'dv-pass', 'r1').filter((e) => e.kind === 'verdict') as Array<{ result: string; via?: string; confidence?: number }>;
      expect(verdicts).toEqual([{ t: '2026-06-07T00:00:00.000Z', kind: 'verdict', result: 'pass', via: 'decision', confidence: 0.9 } as never]);
    });

    it('never consults the model when the reply has a parseable VERDICT line', async () => {
      let calls = 0;
      const runner = makeRunner({ decide: async () => { calls += 1; return decisionResult('fail'); } });
      await runToVerifying('dv-parsed', runner, [{ id: 'a', prompt: 'a' }]);
      host.completeSession('orch', { finalText: 'Reviewed.\nVERDICT: PASS' });
      await tick();
      expect(runner.getRunState('dv-parsed', 'r1')!.status).toBe('completed');
      expect(calls).toBe(0);
      const verdict = readRunLog(root, 'dv-parsed', 'r1').find((e) => e.kind === 'verdict') as { via?: string };
      expect(verdict.via).toBeUndefined();
    });

    it('falls back to the re-ask when the model is unavailable, unsure, or throws', async () => {
      const outcomes: Array<{ decide: () => Promise<DecisionResult | null>; via: 'decision' | undefined }> = [
        { decide: async () => null, via: undefined },                                   // layer off: no decision ran
        { decide: async () => decisionResult('unclear'), via: 'decision' },             // model answered "unclear"
        { decide: async () => decisionResult('pass', { confidence: 0.3 }), via: 'decision' }, // not confident enough
        { decide: async () => { throw new Error('boom'); }, via: undefined },             // failed → no decision
      ];
      for (const [i, { decide, via }] of outcomes.entries()) {
        const slug = `dv-fallback-${i}`;
        const runner = makeRunner({ decide });
        await runToVerifying(slug, runner, [{ id: 'a', prompt: 'a' }]);
        host.completeSession('orch', { finalText: 'hmm, not sure what to say here' });
        await tick();
        expect(runner.getRunState(slug, 'r1')!.status).toBe('verifying');
        expect(host.sent.filter((s) => s.sessionId === 'orch' && s.message.includes('did not include a parseable verdict')).length).toBe(i + 1);
        const verdict = readRunLog(root, slug, 'r1').find((e) => e.kind === 'verdict') as { result: string; via?: string };
        expect(verdict.result).toBe('unparsed');
        expect(verdict.via).toBe(via);
        // Detach this run's verdict listener so the next iteration's orchestrator completion is not
        // also consumed by it (all iterations share one mock host / orchestrator id).
        await runner.stop(slug, 'r1');
      }
    });

    it('repairs only the nodes the model flags on a confident FAIL', async () => {
      const runner = makeRunner({ decide: async () => decisionResult('fail', { rework: { research: 0.1, report: 0.95 } }) });
      await runToVerifying('dv-fail', runner, [
        { id: 'research', prompt: 'r' },
        { id: 'report', prompt: 'p', deps: ['research'] },
      ]);
      const dispatchedBefore = host.created.length;

      host.completeSession('orch', { finalText: 'The research is solid.\nThe report is missing the revenue table and needs another pass.' });
      await tick();
      expect(runner.getRunState('dv-fail', 'r1')!.status).toBe('running');
      // Only `report` was reset and re-dispatched; `research` keeps its output.
      expect(host.created.length).toBe(dispatchedBefore + 1);
      expect(host.created.at(-1)!.options.name).toBe('report');
      const retried = readRunLog(root, 'dv-fail', 'r1').filter((e) => e.kind === 'node-retry') as Array<{ nodeId: string; reason: string }>;
      expect(retried.map((e) => e.nodeId)).toEqual(['report']);
      // The repair reason never quotes the reply (an arbitrary line could mislead the re-run).
      expect(retried[0]!.reason).toContain('no VERDICT line');
      expect(retried[0]!.reason).not.toContain('needs another pass');
      const verdict = readRunLog(root, 'dv-fail', 'r1').find((e) => e.kind === 'verdict') as { result: string; nodes?: string[]; via?: string };
      expect(verdict).toMatchObject({ result: 'fail', nodes: ['report'], via: 'decision' });
    });

    it('ignores a classification that resolves after the run was stopped', async () => {
      let release!: (value: DecisionResult | null) => void;
      const pending = new Promise<DecisionResult | null>((resolve) => { release = resolve; });
      const runner = makeRunner({ decide: () => pending });
      await runToVerifying('dv-stop', runner, [{ id: 'a', prompt: 'a' }]);
      host.completeSession('orch', { finalText: 'no verdict line here' });
      await tick();
      await runner.stop('dv-stop', 'r1');
      release(decisionResult('pass'));
      await tick();
      expect(runner.getRunState('dv-stop', 'r1')!.status).toBe('stopped');
    });
  });

  it('an unparsed re-ask does not consume the repair budget', async () => {
    // max_iterations: 1. An intervening unparsed verdict must not eat the single repair allowance.
    saveTaskSpec(root, specOf({ id: 'unb', title: 'Unb', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('unb', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();

    host.completeSession('orch', { finalText: 'no verdict here' }); // unparsed → re-ask
    await tick();
    expect(runner.getRunState('unb', 'r1')!.status).toBe('verifying');

    host.completeSession('orch', { finalText: 'VERDICT: FAIL — fix it' }); // first real FAIL → repair still allowed
    await tick();
    expect(runner.getRunState('unb', 'r1')!.status).toBe('running');
  });

  it('does not hang in verifying when the verification send rejects', async () => {
    saveTaskSpec(root, specOf({ id: 'snd', title: 'Snd', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('snd', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    // Make the orchestrator verification send reject (the verdict can never arrive).
    const origSend = host.sendMessage.bind(host);
    host.sendMessage = async (sessionId: string, message: string) => {
      if (sessionId === 'orch') throw new Error('send boom');
      return origSend(sessionId, message);
    };
    host.complete('a', { finalText: 'x' });
    await tick();
    await tick();
    expect(runner.getRunState('snd', 'r1')!.status).toBe('failed');
  });

  it('ignores a verdict that arrives after the run was stopped', async () => {
    saveTaskSpec(root, specOf({ id: 'late', title: 'Late', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('late', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    expect(runner.getRunState('late', 'r1')!.status).toBe('verifying');

    await runner.stop('late', 'r1');
    expect(runner.getRunState('late', 'r1')!.status).toBe('stopped');

    // A late verdict for the (now stopped) run must not flip it back to completed/failed.
    host.completeSession('orch', { finalText: 'VERDICT: PASS' });
    await tick();
    expect(runner.getRunState('late', 'r1')!.status).toBe('stopped');
  });

  it('reconstructs the repair counter from the run-log on a cross-restart resume', async () => {
    // max_iterations: 1. Consume the single repair, then "restart": the resumed run must remember
    // repairsUsed=1 (from the persisted FAIL verdict) so the next FAIL fails immediately.
    saveTaskSpec(root, specOf({ id: 'hyd', title: 'Hyd', goal: 'g', max_iterations: 1, nodes: [{ id: 'a', prompt: 'a' }] }));
    const r1 = makeRunner();
    r1.run('hyd', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'x' });
    await tick();
    host.completeSession('orch', { finalText: 'VERDICT: FAIL — redo' }); // consumes the one repair
    await tick();
    expect(r1.getRunState('hyd', 'r1')!.status).toBe('running');

    // Restart: fresh host + runner with empty in-memory state, resume from the run-log.
    const host2 = new MockHost();
    const r2 = new TaskRunner({ host: host2, workspaceId: 'ws', workspaceRoot: root, now: () => '2026-06-07T00:00:00.000Z' });
    r2.resume('hyd', 'r1');
    await tick();
    expect(r2.getRunState('hyd', 'r1')!.status).toBe('verifying');

    // A single FAIL now exhausts the (carried-over) budget immediately.
    host2.completeSession('orch', { finalText: 'VERDICT: FAIL — still bad' });
    await tick();
    expect(r2.getRunState('hyd', 'r1')!.status).toBe('failed');
  });

  it('fails a node that completes with no text despite declaring outputs (instead of marking it done)', async () => {
    // Bug 2: a clean turn-completion is not proof of success. A node that declared `outputs` but
    // produced empty final text delivered nothing — it must fail (→ needs-review), not silently pass.
    saveTaskSpec(
      root,
      specOf({
        id: 'empty',
        title: 'Empty',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a', outputs: [{ name: 'result' }] }],
      }),
    );
    const runner = makeRunner();
    runner.run('empty', { runId: 'r1' });
    await tick();

    host.complete('a', { finalText: '   ' }); // whitespace-only → counts as empty
    await tick();

    const snap = runner.getRunState('empty', 'r1')!;
    expect(snap.nodes.find((n) => n.id === 'a')!.state).toBe('failed');
    expect(snap.status).toBe('failed');
    expect(host.statuses.some((s) => s.sessionId === 'sess-a' && s.status === 'needs-review')).toBe(true);
  });

  it('fails a node whose turn finished without a reply, outputs declared or not', async () => {
    // Found 2026-10-11: a step that ended with no reply was marked done and its dependents started
    // with nothing.
    saveTaskSpec(root, specOf({ id: 'noreply', title: 'NoReply', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('noreply', { runId: 'r1' });
    await tick();

    host.complete('a', { finalText: '' });
    await tick();

    expect(runner.getRunState('noreply', 'r1')!.nodes.find((n) => n.id === 'a')!.state).toBe('failed');
    expect(readRunLog(root, 'noreply', 'r1').some((e) => e.kind === 'node-finished' && e.reason === 'finished without a reply')).toBe(true);
  });

  describe('a step that ended a turn without finishing', () => {
    const chain = (id: string) => specOf({
      id,
      title: id,
      goal: 'g',
      nodes: [
        { id: 'explore', prompt: 'Map the site' },
        { id: 'journeys', prompt: 'Based on the exploration output, write the journeys', depends_on: ['explore'] },
      ],
    });

    // Found 2026-10-11 (analyze-lizaos): the user stopped the exploration step to give it a login;
    // it was marked done with no output 1 ms later, the next steps started without it, and the reply
    // it wrote 40 minutes later was ignored.
    it.each(['interrupted', 'timeout'] as const)('waits for the user after a stop (%s) and finishes with the turn that completes it', async (reason) => {
      saveTaskSpec(root, chain(`stop-${reason}`));
      const runner = makeRunner();
      runner.run(`stop-${reason}`, { runId: 'r1' });
      await tick();

      host.complete('explore', { reason });
      await tick();
      let snap = runner.getRunState(`stop-${reason}`, 'r1')!;
      expect(snap.status).toBe('running');
      expect(snap.nodes.find((n) => n.id === 'explore')!.state).toBe('running');
      expect(host.promptFor('journeys')).toBeUndefined();
      expect(host.statuses).toContainEqual({ sessionId: 'sess-explore', status: 'needs-review' });
      expect(readRunLog(root, `stop-${reason}`, 'r1')).toContainEqual(
        expect.objectContaining({ kind: 'node-waiting', nodeId: 'explore', reason: 'stopped' }),
      );

      host.complete('explore', { finalText: 'SITE MAP' });
      await tick();
      snap = runner.getRunState(`stop-${reason}`, 'r1')!;
      expect(snap.nodes.find((n) => n.id === 'explore')!.state).toBe('done');
      expect(host.promptFor('journeys')).toContain('SITE MAP');
    });

    // A Stop keeps background agents alive; one finishing wakes the session before the user has
    // steered the step. That wake-up turn must not complete it.
    it('keeps a stopped step waiting through a background wake-up until the user\'s turn', async () => {
      saveTaskSpec(root, chain('wake'));
      const runner = makeRunner();
      runner.run('wake', { runId: 'r1' });
      await tick();

      host.complete('explore', { reason: 'interrupted' });
      host.complete('explore', { finalText: 'Agent: MCP latencies.', fromUser: false });
      await tick();
      expect(runner.getRunState('wake', 'r1')!.nodes.find((n) => n.id === 'explore')!.state).toBe('running');
      expect(host.promptFor('journeys')).toBeUndefined();

      host.complete('explore', { finalText: 'Signed in; SITE MAP.', fromUser: true });
      await tick();
      expect(readNodeOutput(root, 'wake', 'r1', 'explore')!.text).toBe('Agent: MCP latencies.\n\nSigned in; SITE MAP.');
    });

    it('waits for its background agents and keeps the reply of every turn', async () => {
      saveTaskSpec(root, chain('bg'));
      const runner = makeRunner();
      runner.run('bg', { runId: 'r1' });
      await tick();

      host.complete('explore', { finalText: 'Portal mapped; two research agents still running.', backgroundWorkRunning: 2 });
      await tick();
      host.complete('explore', { finalText: 'Agent 1: MCP latencies.', backgroundWorkRunning: 1 });
      await tick();
      expect(runner.getRunState('bg', 'r1')!.nodes.find((n) => n.id === 'explore')!.state).toBe('running');
      expect(host.promptFor('journeys')).toBeUndefined();
      expect(host.statuses.some((s) => s.sessionId === 'sess-explore' && s.status === 'needs-review')).toBe(false);

      host.complete('explore', { finalText: 'Agent 2: market landscape.', backgroundWorkRunning: 0 });
      await tick();
      expect(readNodeOutput(root, 'bg', 'r1', 'explore')!.text).toBe(
        'Portal mapped; two research agents still running.\n\nAgent 1: MCP latencies.\n\nAgent 2: market landscape.',
      );
      expect(host.promptFor('journeys')).toContain('Agent 2: market landscape.');
    });

    it('fails on a backend error instead of waiting', async () => {
      saveTaskSpec(root, chain('err'));
      const runner = makeRunner();
      runner.run('err', { runId: 'r1' });
      await tick();
      host.complete('explore', { reason: 'error', backgroundWorkRunning: 1 });
      await tick();
      expect(runner.getRunState('err', 'r1')!.nodes.find((n) => n.id === 'explore')!.state).toBe('failed');
    });
  });

  describe('depends_on hands the upstream reply to the dependent', () => {
    it('adds the reply unless the prompt already places it with ${nodes.<id>.output}', async () => {
      saveTaskSpec(root, specOf({
        id: 'hand',
        title: 'Hand',
        goal: 'g',
        nodes: [
          { id: 'explore', title: 'Explore the platform', prompt: 'Map the site' },
          { id: 'journeys', prompt: 'Based on the exploration output, write the journeys', depends_on: ['explore'] },
          { id: 'inline', prompt: 'Summarize: ${nodes.explore.output}', depends_on: ['explore'] },
        ],
      }));
      const runner = makeRunner();
      runner.run('hand', { runId: 'r1' });
      await tick();
      host.completeSession('sess-Explore the platform', { finalText: 'SITE MAP' }); // the mock names sessions by title
      await tick();

      expect(host.promptFor('journeys')).toBe(
        'Replies of the step this one depends on:\n\n### Explore the platform\nSITE MAP\n\n---\n\nBased on the exploration output, write the journeys',
      );
      expect(host.promptFor('inline')).toBe('Summarize: SITE MAP');
    });

    it('cuts a very long reply and points at the full one', async () => {
      saveTaskSpec(root, specOf({
        id: 'long',
        title: 'Long',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b', depends_on: ['a'] }],
      }));
      const runner = makeRunner();
      runner.run('long', { runId: 'r1' });
      await tick();
      host.complete('a', { finalText: 'x'.repeat(50_000) });
      await tick();

      const prompt = host.promptFor('b')!;
      expect(prompt.length).toBeLessThan(41_000);
      expect(prompt).toContain(`the full reply is in ${join(root, 'tasks', 'long', 'runs', 'r1', 'nodes', 'a.json')}`);
    });
  });

  it('waits out a stopped verification turn instead of reading it as a malformed verdict', async () => {
    saveTaskSpec(root, specOf({ id: 'vstop', title: 'VStop', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
    const runner = makeRunner();
    runner.run('vstop', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();
    host.complete('a', { finalText: 'A' });
    await tick();
    expect(runner.getRunState('vstop', 'r1')!.status).toBe('verifying');
    const asked = host.sent.filter((s) => s.sessionId === 'orch').length;

    host.completeSession('orch', { reason: 'interrupted' });
    await tick();
    host.completeSession('orch', { finalText: 'Checking with two agents.', backgroundWorkRunning: 2 });
    await tick();
    expect(runner.getRunState('vstop', 'r1')!.status).toBe('verifying');
    expect(host.sent.filter((s) => s.sessionId === 'orch')).toHaveLength(asked); // nothing re-asked

    host.completeSession('orch', { finalText: 'All good.\nVERDICT: PASS' });
    await tick();
    expect(runner.getRunState('vstop', 'r1')!.status).toBe('completed');
  });

  describe('child outcome via the decision model', () => {
    type Outcome = 'finished' | 'needs_input' | 'blocked' | null;
    const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

    it('retries a child that asked for input, telling the retry to decide, then completes', async () => {
      saveTaskSpec(root, specOf({ id: 'ask', title: 'Ask', goal: 'g', nodes: [{ id: 'a', prompt: 'do a', retry: { limit: 1 } }] }));
      const answers: Outcome[] = ['needs_input', 'finished'];
      const seen: string[] = [];
      const runner = makeRunner({ classifyNodeOutcome: async (text) => { seen.push(text); return answers.shift() ?? null; } });
      runner.run('ask', { runId: 'r1' });
      await tick();

      host.complete('a', { finalText: 'Which colour should the button be?' });
      await settle();
      expect(seen).toEqual(['Which colour should the button be?']);
      expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(2);
      const retryPrompt = host.sent.filter((s) => s.sessionId === 'sess-a')[1]!.message;
      expect(retryPrompt).toContain('asked for input instead of finishing');

      host.complete('a', { finalText: 'Made it blue.' });
      await settle();
      expect(runner.getRunState('ask', 'r1')!.status).toBe('completed');
    });

    it('fails a child that reports it is blocked when no retry budget remains', async () => {
      saveTaskSpec(root, specOf({ id: 'blk', title: 'Blk', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
      const runner = makeRunner({ classifyNodeOutcome: async () => 'blocked' });
      runner.run('blk', { runId: 'r1' });
      await tick();

      host.complete('a', { finalText: 'I cannot reach the database.' });
      await settle();
      const snap = runner.getRunState('blk', 'r1')!;
      expect(snap.nodes[0]!.state).toBe('failed');
      expect(host.statuses.some((s) => s.sessionId === 'sess-a' && s.status === 'needs-review')).toBe(true);
    });

    it('marks the child done when the model finds it finished, is unavailable, or throws', async () => {
      for (const [slug, classify] of [
        ['fin', async () => 'finished' as const],
        ['off', async () => null],
        ['boom', async () => { throw new Error('boom'); }],
      ] as const) {
        saveTaskSpec(root, specOf({ id: slug, title: slug, goal: 'g', nodes: [{ id: `n-${slug}`, prompt: 'x' }] }));
        const runner = makeRunner({ classifyNodeOutcome: classify });
        runner.run(slug, { runId: 'r1' });
        await tick();
        host.complete(`n-${slug}`, { finalText: 'Done.' });
        await settle();
        expect(runner.getRunState(slug, 'r1')!.nodes[0]!.state).toBe('done');
      }
    });

    it('drops an outcome that arrives after the run was stopped', async () => {
      saveTaskSpec(root, specOf({ id: 'late', title: 'Late', goal: 'g', nodes: [{ id: 'a', prompt: 'a' }] }));
      let release: (outcome: Outcome) => void = () => {};
      const runner = makeRunner({ classifyNodeOutcome: () => new Promise<Outcome>((resolve) => { release = resolve; }) });
      runner.run('late', { runId: 'r1' });
      await tick();

      host.complete('a', { finalText: 'Should I continue?' });
      await tick();
      await runner.stop('late', 'r1');
      await tick();
      const before = runner.getRunState('late', 'r1')!.nodes[0]!.state;
      release('needs_input');
      await settle();
      expect(runner.getRunState('late', 'r1')!.nodes[0]!.state).toBe(before);
      expect(host.created.filter((c) => c.options.name === 'a')).toHaveLength(1);
    });
  });

  it('publishes the total node count to the orchestrator at run start (stable board denominator)', async () => {
    // Bug 3: the board derives subtask progress from lazily-spawned child sessions, so without an
    // up-front total the denominator grows (0/1 → 1/2 …). The runner publishes spec.nodes.length once.
    saveTaskSpec(
      root,
      specOf({
        id: 'count',
        title: 'Count',
        goal: 'g',
        nodes: [
          { id: 'a', prompt: 'a' },
          { id: 'b', depends_on: ['a'], prompt: 'b' },
          { id: 'c', depends_on: ['b'], prompt: 'c' },
        ],
      }),
    );
    const runner = makeRunner();
    runner.run('count', { runId: 'r1', orchestratorSessionId: 'orch' });
    await tick();

    expect(host.nodeCounts).toContainEqual({ sessionId: 'orch', count: 3 });
  });
});
