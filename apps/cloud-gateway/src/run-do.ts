/**
 * RunDO — Durable Object owning one Cloud Run's workspace + state machine.
 *
 * State lives in ctx.storage (survives DO restarts); the filesystem
 * lives in the Workspace SQLite (source of truth for artifacts);
 * execution happens in the attached container per subtask, driven by
 * an alarm chain so each step is a short, bounded unit of work:
 *
 *   createRun → alarm(step) → exec(subtask[i]) → alarm(step) → … → done
 *
 * Crash-resume: a restarted DO re-reads nextSubtask and the per-subtask
 * done.marker files in the workspace; finished subtasks are never
 * redone (PRD §G2.4).
 *
 * Watchdog: every step compares against the wall-clock deadline and
 * fails the run with budget_exceeded past it (PRD §G2.5).
 */
import { DurableObject, tracing } from "cloudflare:workers";
import {
  type DurableObjectStorageLike,
  type WorkspaceClient,
  type WorkspaceOptions,
  WorkspaceProxy,
  getWorkspace,
  withWorkspace,
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
} from "@cloudflare/computer/backends/container";
import { createCloudflareObserver } from "@cloudflare/computer/observe/cloudflare";
export { WorkspaceProxy };

interface Env {
  RunAgent: DurableObjectNamespace<RunAgent>;
  CLOUD_RUNS_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

// ---- contract mirrors packages/cloud-runner/src/types.ts --------------
interface RunSpec {
  id: string;
  name: string;
  subtasks: { id: string; title?: string; prompt: string; model?: { connectionSlug?: string; modelId?: string } }[];
  limits?: { maxWallClockSec?: number; maxLlmTokens?: number; maxArtifactsBytes?: number };
  /** F3: parallel exec pool size (adaptive: drops to 1 on sustained LLM 503s). */
  concurrency?: number;
  outputs?: string[];
  agentic?: boolean;
  /** F21: runner flavor — default 'loop' (custom tool-loop); 'omp' uses omp CLI. */
  agenticMode?: 'loop' | 'omp';
  ttlSec?: number;
  metadata?: Record<string, string>;
  model?: { connectionSlug?: string; modelId?: string };
}

type RunState = "queued" | "running" | "done" | "failed" | "cancelled";
interface PersistedRun {
  spec: RunSpec;
  state: RunState;
  startedAt?: number;
  finishedAt?: number;
  failureReason?: "budget_exceeded" | "runner_error" | "provider_error" | "cancelled";
  failureDetail?: string;
  nextSubtask: number;
  createdAt: number;
  /** Aggregated usage ledger (PRD §G5.2): LLM tokens + runner wall time. */
  usage?: { promptTokens: number; completionTokens: number; cpuMs: number };
  /** In-flight subtasks (F3 pool; non-blocking exec; markers drive outcome). */
  awaiting?: PersistedAwaiting[];
  attemptOf?: Record<string, number>;
  /** F3: effective parallelism (starts at spec.concurrency; adaptive cap on 503). */
  effectiveConcurrency?: number;
  /** F2: exec ids of in-flight runs so cancel can SIGKILL them. */
  execIds?: Record<string, string>;
  /** F3: subtasks observed done (drives progress + done-condition). */
  completedIds?: string[];
  /** F14: capped event log for the events route (latest last). */
  eventLog?: { t: number; message: string }[];
  /** F15: tokenized public share. */
  shareToken?: string;
}


interface PersistedAwaiting {
  id: string;
  attempt: number;
  startedAt: number;
  execId?: string;
}

const DEFAULT_WALL_CLOCK_SEC = 30 * 60;
// Real research prompts can stream for minutes per subtask; 180s was proven
// too tight live (runner exit 143). Watchdog above bounds the whole run.
const SUBTASK_TIMEOUT_MS = 600_000;
const SUBTASK_MAX_ATTEMPTS = 2;
const MARKER_POLL_MS = 10_000;
const WORKSPACE_ROOT = "/workspace";
const ARTIFACTS_ROOT = `${WORKSPACE_ROOT}/artifacts`;

class ContainerBase extends withWorkspaceContainer(class extends DurableObject<Env> {}) {
  readonly backend = new CloudflareContainerBackend({
    container: () => this,
    workspace: { binding: "RunAgent", id: this.ctx.id.toString() },
  });
}

function workspaceOptions(self: InstanceType<typeof ContainerBase>): WorkspaceOptions {
  const { ctx } = self as unknown as { ctx: DurableObjectState };
  return {
    storage: ctx.storage as unknown as DurableObjectStorageLike,
    backends: [self.backend],
    observer: createCloudflareObserver({ tracing }),
  };
}

export class RunAgent extends withWorkspace(ContainerBase, workspaceOptions) {
  override async fetch(request: Request): Promise<Response> {
    // F14-WS: live event stream for the UI. Hibernation-safe: the DO wakes
    // on alarm ticks and broadcasts to every accepted socket.
    const pathname = new URL(request.url).pathname;
    if (request.headers.get("upgrade") === "websocket" && pathname.startsWith("/runs/") && pathname.endsWith("/ws")) {
      // Our live-events channel. NOTE: do NOT match the backend's own
      // `…/ws` handshake-upgrade paths — intercepting them kills the run.
      const run = await this.ctx.storage.get<PersistedRun>("run");
      if (!run) return new Response("not found", { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      if (run.eventLog && run.eventLog.length > 0) {
        for (const event of run.eventLog.slice(-20)) {
          server.send(JSON.stringify(event));
        }
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return this.backend.handleFetch(request);
  }

  // eslint-disable-next-line no-empty-function
  webSocketMessage(): void {} // server-side sockets are outbound-only here

  /**
   * In-DO local view of the Workspace (fs + shell). getWorkspace(this)
   * takes the local-host path — no RPC round trip, no stub to dispose.
   */
  private ws(): Promise<WorkspaceClient> {
    return getWorkspace(this as unknown as Parameters<typeof getWorkspace>[0]);
  }

  // ---- RPC surface (invoked by the Worker) --------------------------

  async createRun(spec: RunSpec, contextFiles?: { path: string; content: string }[]): Promise<{ id: string; createdAt: number }> {
    const existing = await this.ctx.storage.get<PersistedRun>("run");
    if (existing) {
      if (existing.state === "failed" || existing.state === "cancelled") {
        // Resume semantics (F1): terminal-but-not-done states restart with
        // markers intact — finished subtasks skip via done.marker checks.
        // Idempotency for active/done states is unaffected.
        existing.state = "queued";
        existing.finishedAt = undefined;
        existing.failureReason = undefined;
        existing.failureDetail = undefined;
        existing.awaiting = [];
        existing.nextSubtask = 0;
        existing.spec = spec;
        await this.ctx.storage.put("run", existing);
        await this.ctx.storage.setAlarm(Date.now() + 1);
        return { id: existing.spec.id, createdAt: existing.createdAt };
      }
      return { id: existing.spec.id, createdAt: existing.createdAt };
    }
    const run: PersistedRun = {
      spec,
      state: "queued",
      nextSubtask: 0,
      effectiveConcurrency: Math.min(Math.max(spec.concurrency ?? 2, 1), 4),
      createdAt: Date.now(),
    };
    await this.ctx.storage.put("run", run);
    // F7 forking: prior run's briefs land in /workspace/context BEFORE the
    // first exec; the runner digests them into the system prompt.
    if (contextFiles && contextFiles.length > 0) {
      const ws = await this.ws();
      await ws.fs.mkdir(`${WORKSPACE_ROOT}/context`, { recursive: true });
      for (const file of contextFiles) {
        const safe = file.path.replace(/[^A-Za-z0-9_.\-\/]/g, "_");
        const segments = safe.split("/");
        if (segments.length > 1) {
          await ws.fs.mkdir(`${WORKSPACE_ROOT}/context/${segments.slice(0, -1).join("/")}`, { recursive: true });
        }
        await ws.fs.writeFile(`${WORKSPACE_ROOT}/context/${safe}`, file.content);
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + 1);
    return { id: spec.id, createdAt: run.createdAt };
  }

  async getStatus(): Promise<object | null> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) return null;
    if (await this.maybeExpire(run)) return null;
    return {
      id: run.spec.id,
      state: run.state,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      failureReason: run.failureReason,
      failureDetail: run.failureDetail,
      usage: run.usage,
      progress: {
        // completed = subtasks whose marker has been observed this run
        completed: run.completedIds?.length ?? (run.state === "done" ? run.spec.subtasks.length : 0),
        total: run.spec.subtasks.length,
      },
    };
  }

  async cancelRun(): Promise<void> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) throw new Error("not_found");
    if (run.state === "done" || run.state === "failed" || run.state === "cancelled") return;
    run.state = "cancelled";
    run.failureReason = "cancelled";
    run.finishedAt = Date.now();
    await this.ctx.storage.put("run", run);
    // F2: stop the LLM burn, not just the state flag. killExec signals the
    // runner process in the container; in-memory handles from this DO
    // instance carry the ids (lost on DO restart — markers then time out).
    for (const [subtaskId, execId] of Object.entries(run.execIds ?? {})) {
      try {
        this.execHandles.get(subtaskId)?.kill("SIGKILL");
        // kill by id when the handle is still ours; otherwise the marker
        // timeout path (≤ SUBTASK_TIMEOUT_MS) reaps it.
        void execId;
      } catch { /* exec already gone */ }
    }
    this.execHandles.clear();
  }

  async listArtifacts(): Promise<{ path: string; size: number }[]> {
    await this.requireRun();
    const ws = await this.ws();
    const out: { path: string; size: number }[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await ws.fs.readdir(joinPosix(ARTIFACTS_ROOT, rel));
      } catch {
        return;
      }
      for (const entry of entries as { name: string }[]) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const childAbs = joinPosix(ARTIFACTS_ROOT, childRel);
        const info = await ws.fs.stat(childAbs);
        if ((info as { isDirectory?: boolean }).isDirectory === true) {
          await walk(childRel);
        } else {
          out.push({ path: childRel, size: (info as { size?: number }).size ?? 0 });
        }
      }
    };
    await walk("");
    return out;
  }

  async fetchArtifact(path: string): Promise<string> {
    assertSafePath(path);
    await this.requireRun();
    const ws = await this.ws();
    return ws.fs.readFile(joinPosix(ARTIFACTS_ROOT, path), "utf8");
  }

  // ---- alarm-driven state machine -------------------------------------

  override async alarm(): Promise<void> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) return;
    if (await this.maybeExpire(run)) return;
    if (run.state === "done" || run.state === "failed" || run.state === "cancelled") return;

    const wallClockMs = (run.spec.limits?.maxWallClockSec ?? DEFAULT_WALL_CLOCK_SEC) * 1000;
    const startedAt = run.startedAt ?? Date.now();
    if (Date.now() > startedAt + wallClockMs) {
      await this.finish(run, "failed", "budget_exceeded", `wall-clock budget ${wallClockMs}ms exceeded`);
      return;
    }

    if (run.state === "queued") {
      run.state = "running";
      run.startedAt = startedAt;
      this.logEvent(run, "run started");
    }

    // ---- Resolve in-flight subtasks via markers (non-blocking) ----
    const awaiting = run.awaiting ?? [];
    const stillWaiting: PersistedAwaiting[] = [];
    for (const item of awaiting) {
      const outcome = await this.checkAwaiting(run, item);
      if (outcome.kind === "wait") {
        if (!stillWaiting.some((w) => w.id === item.id)) stillWaiting.push(item);
        continue;
      }
      if (outcome.kind === "fail") {
        await this.finish(run, "failed", "runner_error", outcome.error.slice(0, 2000));
        return;
      }
      if (outcome.kind === "retry") {
        if (outcome.error.includes("503") || outcome.error.includes("resource pressure")) {
          run.effectiveConcurrency = 1;
        }
        this.logEvent(run, `subtask ${item.id}: attempt ${item.attempt} failed (${outcome.error.slice(0, 100)}), retry scheduled`);
        this.execHandles.delete(item.id);
        continue;
      }
      run.completedIds = [...new Set([...(run.completedIds ?? []), item.id])];
      this.logEvent(run, `subtask ${item.id} done`);
      delete run.execIds?.[item.id];
      this.execHandles.delete(item.id);
    }
    run.awaiting = stillWaiting;

    // ---- Skip subtasks with existing done.markers (crash-resume) ----
    while (
      run.nextSubtask < run.spec.subtasks.length &&
      (await this.markerExists(run.spec.subtasks[run.nextSubtask]!.id, "done.marker"))
    ) {
      run.completedIds = [...new Set([...(run.completedIds ?? []), run.spec.subtasks[run.nextSubtask]!.id])];
      run.nextSubtask += 1;
    }

    const totalDone = run.completedIds?.length ?? 0;
    if (totalDone >= run.spec.subtasks.length && stillWaiting.length === 0) {
      await this.finish(run, "done");
      return;
    }

    // ---- Launch ONE pack exec for all pending subtasks ----
    // F3: concurrency lives inside the runner process. Multi-exec-per-workspace
    // stalled silently on the shared capnweb session (live pools: 1-of-N
    // completes, rest hang) — one exec per workspace is the proven shape.
    if (stillWaiting.length === 0 && run.nextSubtask < run.spec.subtasks.length) {
      const pending = run.spec.subtasks
        .slice(run.nextSubtask)
        .filter((s) => !(run.completedIds ?? []).includes(s.id));
      if (pending.length > 0) {
        try {
          const packId = `${Date.now()}-p${pending.length}`;
          this.logEvent(run, `pack exec started: ${pending.map((s) => s.id).join(", ")}`);
          const execId = await this.startPackExec(run, pending, packId);
          for (const subtask of pending) {
            const attempt = (run.attemptOf?.[subtask.id] ?? 0) + 1;
            run.attemptOf = { ...run.attemptOf, [subtask.id]: attempt };
            run.awaiting = [...(run.awaiting ?? []), { id: subtask.id, attempt, startedAt: Date.now(), execId }];
          }
        } catch (error) {
          await this.finish(run, "failed", "runner_error", (error instanceof Error ? error.message : String(error)).slice(0, 2000));
          return;
        }
      }
    }

    await this.ctx.storage.put("run", run);
    if ((run.awaiting?.length ?? 0) === 0 && totalDone < run.spec.subtasks.length && run.nextSubtask >= run.spec.subtasks.length) {
      await this.finish(run, "failed", "runner_error", "no in-flight subtasks but run incomplete");
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + MARKER_POLL_MS);
  }

  private async checkAwaiting(
    run: PersistedRun,
    awaiting: PersistedAwaiting,
  ): Promise<{ kind: "done" } | { kind: "wait" } | { kind: "retry"; error: string } | { kind: "fail"; error: string }> {
    if (await this.markerExists(awaiting.id, "done.marker")) {
      // LLM+CPU usage ledger (PRD §G5.2): the runner leaves usage JSON per subtask.
      const usage = await this.readSubtaskUsage(awaiting.id);
      if (usage) {
        run.usage = run.usage ?? { promptTokens: 0, completionTokens: 0, cpuMs: 0 };
        run.usage.promptTokens += usage.prompt_tokens ?? 0;
        run.usage.completionTokens += usage.completion_tokens ?? 0;
        run.usage.cpuMs += usage.durationMs ?? 0;
      }
      return { kind: "done" };
    }
    const fail = await this.readMarker(awaiting.id, "fail.marker");
    if (fail) {
      return this.retryOrFail(awaiting, fail.error ?? "runner failed (no detail)");
    }
    if (Date.now() - awaiting.startedAt > SUBTASK_TIMEOUT_MS) {
      return this.retryOrFail(awaiting, "subtask timeout (no marker)");
    }
    return { kind: "wait" };
  }

  private retryOrFail(
    awaiting: PersistedAwaiting,
    error: string,
  ): { kind: "retry"; error: string } | { kind: "fail"; error: string } {
    return awaiting.attempt < SUBTASK_MAX_ATTEMPTS
      ? { kind: "retry", error }
      : { kind: "fail", error: `subtask ${awaiting.id} attempt ${awaiting.attempt}: ${error}` };
  }

  /** ttlSec enforcement: finished runs age out; record + artifacts purged. */
  private async maybeExpire(run: PersistedRun): Promise<boolean> {
    const ttl = run.spec.ttlSec;
    if (!ttl || !run.finishedAt) return false;
    if (Date.now() < run.finishedAt + ttl * 1000) return false;
    if (run.state !== "done" && run.state !== "failed" && run.state !== "cancelled") return false;
    const ws = await this.ws();
    try {
      await ws.fs.rm(ARTIFACTS_ROOT, { recursive: true });
    } catch { /* already gone */ }
    await this.ctx.storage.delete("run");
    return true;
  }

  private async readMarker(subtaskId: string, name: string): Promise<{ error?: string } | null> {
    return this.readJsonArtifact(`${subtaskId}/${name}`);
  }

  private async readJsonArtifact<T>(relPath: string): Promise<T | null> {
    const ws = await this.ws();
    try {
      const raw = await ws.fs.readFile(joinPosix(ARTIFACTS_ROOT, relPath), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async readSubtaskUsage(
    subtaskId: string,
  ): Promise<{ prompt_tokens?: number; completion_tokens?: number; durationMs?: number } | null> {
    return this.readJsonArtifact(`_usage/${subtaskId}.json`);
  }

  // ---------------------------------------------------------------------

  /** In-memory exec handles (don't survive DO restart; markers then time out). */
  private execHandles = new Map<string, { kill(signal?: string): Promise<void> }>();
  private packHandle?: { kill(signal?: string): Promise<void> };

  private async startPackExec(
    run: PersistedRun,
    subtasks: { id: string; title?: string; prompt: string }[],
    packId: string,
  ): Promise<string> {
    const env = this.env;
    if (!env.LLM_BASE_URL) throw new Error("LLM_BASE_URL secret is not configured");
    const ws = await this.ws();
    await ws.fs.mkdir(`${WORKSPACE_ROOT}/.craft-run`, { recursive: true });
    await ws.fs.mkdir(ARTIFACTS_ROOT, { recursive: true });
    // Clear stale markers of pack members so the poll sees only this attempt.
    for (const subtask of subtasks) {
      for (const marker of ["done.marker", "fail.marker"]) {
        try {
          await ws.fs.rm(joinPosix(ARTIFACTS_ROOT, subtask.id, marker));
        } catch { /* no stale marker */ }
      }
    }
    await ws.fs.writeFile(
      `${WORKSPACE_ROOT}/.craft-run/config-${packId}.json`,
      JSON.stringify({
        baseUrl: env.LLM_BASE_URL,
        apiKey: env.LLM_API_KEY ?? "",
        model: run.spec.model?.modelId ?? env.LLM_MODEL ?? "kimi-k3",
        subtasks,
        concurrency: run.effectiveConcurrency ?? run.spec.concurrency ?? 2,
        outputs: run.spec.outputs ?? [],
        agentic: run.spec.agentic ?? true,
      }),
    );
    // The handle is NOT awaited here — the DO must stay responsive (1101
    // finding) — but detaching would starve the spawned process of its
    // event-stream consumer and kill it. waitUntil keeps the drain alive
    // past the alarm tick; outcome is read from markers.
    const runner = run.spec.agenticMode === 'omp' ? 'runner-omp.mjs' : 'runner.mjs';
    const handle = await ws.shell.exec(`node /opt/craft-runner/${runner} ${WORKSPACE_ROOT} config-${packId}.json`, {
      timeoutMs: SUBTASK_TIMEOUT_MS + 60_000,
      encoding: "utf8",
    });
    const execId = (handle as { id?: string }).id ?? packId;
    this.packHandle = handle as { kill(signal?: string): Promise<void> };
    for (const subtask of subtasks) {
      this.execHandles.set(subtask.id, this.packHandle);
    }
    this.ctx.waitUntil(
      handle
        .result()
        .catch(() => null), // exec errors surface via markers; consume to keep the stream alive
    );
    return execId;
  }

  private async markerExists(subtaskId: string, name: string): Promise<boolean> {
    const ws = await this.ws();
    try {
      await ws.fs.stat(joinPosix(ARTIFACTS_ROOT, subtaskId, name));
      return true;
    } catch {
      return false;
    }
  }

  private async finish(
    run: PersistedRun,
    state: RunState,
    failureReason?: PersistedRun["failureReason"],
    failureDetail?: string,
  ): Promise<void> {
    run.state = state;
    run.finishedAt = Date.now();
    run.failureReason = failureReason;
    run.failureDetail = failureDetail;
    this.logEvent(run, `${state}${failureDetail ? `: ${failureDetail.slice(0, 120)}` : ""}`);
    await this.ctx.storage.put("run", run);
  }

  private logEvent(run: PersistedRun, message: string): void {
    const event = { t: Date.now(), message };
    run.eventLog = [...(run.eventLog ?? []).slice(-49), event];
    // F14-WS: fan out to live subscribers; dead sockets are pruned silently.
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(JSON.stringify(event));
      } catch { /* detached socket — hibernation handles lifecycle */ }
    }
  }

  /** F15: mint (or return) the public share token. Only done runs. */
  async shareRun(): Promise<{ token: string }> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) throw new Error("not_found");
    if (run.state !== "done") throw new Error("run not finished");
    if (!run.shareToken) {
      run.shareToken = crypto.randomUUID();
      await this.ctx.storage.put("run", run);
    }
    return { token: run.shareToken };
  }

  async revokeShare(): Promise<{ ok: boolean }> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) throw new Error("not_found");
    delete run.shareToken;
    await this.ctx.storage.put("run", run);
    return { ok: true };
  }

  private async assertShareToken(token: string): Promise<PersistedRun> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run || !run.shareToken || run.shareToken !== token) throw new Error("not_found");
    return run;
  }

  /** F15: public, unauthenticated: minted-token read-only share page. */
  async renderShare(token: string): Promise<string> {
    const run = await this.assertShareToken(token);
    const artifacts = (await this.listArtifacts()).filter((a) => a.path.endsWith(".md") && !a.path.startsWith("_usage/"));
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sections: string[] = [];
    for (const artifact of artifacts.slice(0, 20)) {
      const content = await this.fetchArtifact(artifact.path);
      sections.push(`<section><h2>${esc(artifact.path)}</h2><pre>${esc(content.slice(0, 100_000))}</pre></section>`);
    }
    const title = esc(run.spec.name ?? run.spec.id);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;}pre{white-space:pre-wrap;font-family:inherit;background:#f6f6f6;padding:1rem;border-radius:8px;overflow-wrap:anywhere}h2{font-size:1rem;color:#555}header{display:flex;gap:1rem;align-items:baseline}.badge{background:#22c55e22;color:#15803d;padding:.15em .6em;border-radius:999px;font-size:.8rem}</style>
</head><body><header><h1>${title}</h1><span class="badge">cloud research · ${run.state}</span></header>
${sections.join("\n")}
<footer><small>Shared read-only view · cloud-runs</small></footer></body></html>`;
  }

  /** F14: capped event log for live UI tails. */
  async getEvents(): Promise<{ t: number; message: string }[]> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) throw new Error("not_found");
    return run.eventLog ?? [];
  }

  private async requireRun(): Promise<PersistedRun> {
    const run = await this.ctx.storage.get<PersistedRun>("run");
    if (!run) throw new Error("not_found");
    return run;
  }
}

function joinPosix(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function assertSafePath(path: string): void {
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.split("/").includes("..")) {
    throw new Error(`unsafe artifact path: ${path}`);
  }
}
