/**
 * LocalSubprocessProvider — reference implementation of CloudRunProvider.
 *
 * Runs the agent runner as a local subprocess against a run directory:
 *
 *   <baseDir>/<runId>/
 *     spec.json          input, written once by the provider
 *     state.json         authoritative status, maintained by the runner
 *     events.jsonl       append-only event log mirroring transitions
 *     runner.pid         pid of the runner process (cancel/reconcile)
 *     artifacts/         output tree collected by list/fetchArtifact
 *
 * This provider doubles as (a) the dev/offline mode with no cloud
 * involved, and (b) the executable contract every cloud provider must
 * satisfy: the conformance suite runs against it unconditionally.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtifactMeta,
  CloudRunProvider,
  RunEvent,
  RunHandle,
  RunSpec,
  RunStatus,
} from './types.ts';
import { CloudRunnerError, assertSafeArtifactPath, resolveLimits } from './types.ts';

export interface LocalProviderOptions {
  /** Root directory for runs, e.g. `<workspace>/.craft/runs`. */
  baseDir: string;
  /**
   * Command that executes the runner as `<command...> --dir <runDir>`.
   * Defaults to the bundled stub runner. The command must maintain
   * state.json / events.jsonl / artifacts per the contract above.
   */
  runnerCommand?: string[];
  /** Poll interval for subscribeEvents, ms. */
  pollMs?: number;
}

interface StateFile extends RunStatus {}

/**
 * Top-level path resolution must survive esbuild CJS bundling (Electron
 * main): import.meta.url is undefined there, so resolve lazily inside
 * the constructor and fall back through the workspace package symlink.
 */
function resolveStubRunner(): string {
  // Packaged Electron app: the runner is staged into resources at build time.
  // Prefer env override, then packaged resources, then source-tree resolution.
  const candidates: string[] = [];
  if (process.env.CRAFT_STUB_RUNNER) candidates.push(process.env.CRAFT_STUB_RUNNER);
  const resourcesPath = Reflect.get(process, 'resourcesPath');
  if (typeof resourcesPath === 'string' && resourcesPath) {
    candidates.push(
      join(resourcesPath, 'app', 'resources', 'cloud-runner', 'stub-runner.js'),
      join(resourcesPath, 'resources', 'cloud-runner', 'stub-runner.js'),
    );
  }
  if (typeof import.meta.url === 'string' && import.meta.url) {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), 'runners', 'stub-runner.ts'));
  }
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    candidates.push(join(
      dirname(req.resolve('@craft-agent/cloud-runner/package.json')),
      'src', 'runners', 'stub-runner.ts',
    ));
  } catch { /* fall through */ }
  candidates.push(join(process.cwd(), 'packages', 'cloud-runner', 'src', 'runners', 'stub-runner.ts'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

/** Bun runtime for spawning the runner: bundled vendor bun first (packaged),
 * then a bun-like process.execPath, then PATH. */
function resolveBunBinary(): string {
  if (process.env.CRAFT_BUN_PATH && existsSync(process.env.CRAFT_BUN_PATH)) return process.env.CRAFT_BUN_PATH;
  const resourcesPath = Reflect.get(process, 'resourcesPath');
  const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
  if (typeof resourcesPath === 'string' && resourcesPath) {
    const vendored = join(resourcesPath, 'app', 'vendor', 'bun', bunName);
    if (existsSync(vendored)) return vendored;
  }
  if (process.execPath.endsWith('bun') || process.execPath.endsWith(bunName)) return process.execPath;
  return 'bun';
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** 3 call sites need lockstep liveness semantics: cancel, reconcile, watchdog. */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class LocalSubprocessProvider implements CloudRunProvider {
  readonly providerId = 'local';
  private readonly baseDir: string;
  private readonly runnerCommand: string[];
  private readonly pollMs: number;

  constructor(opts: LocalProviderOptions) {
    this.baseDir = resolve(opts.baseDir);
    this.runnerCommand = opts.runnerCommand ?? [resolveBunBinary(), resolveStubRunner()];
    this.pollMs = opts.pollMs ?? 100;
  }

  async createRun(spec: RunSpec): Promise<RunHandle> {
    if (!spec.id || spec.id.includes('..') || spec.id.includes('/') || spec.id.includes('\\')) {
      throw new CloudRunnerError(`invalid run id: ${JSON.stringify(spec.id)}`, 'invalid_spec');
    }
    if (spec.subtasks.length === 0) {
      throw new CloudRunnerError('spec.subtasks must not be empty', 'invalid_spec');
    }
    const dir = this.runDir(spec.id);
    const statePath = join(dir, 'state.json');
    const existing = await readJson<StateFile>(statePath);
    if (existing) return { id: spec.id, provider: this.providerId, createdAt: existing.startedAt ?? Date.now() };

    await mkdir(join(dir, 'artifacts'), { recursive: true });
    await writeFile(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
    const status: StateFile = { id: spec.id, state: 'queued' };
    await writeFile(statePath, JSON.stringify(status, null, 2));
    await appendFile(join(dir, 'events.jsonl'), JSON.stringify({ type: 'state', status }) + '\n');

    const cmd = this.runnerCommand;
    const child = spawn(cmd[0]!, [...cmd.slice(1), '--dir', dir], {
      cwd: dir,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
    });
    await writeFile(join(dir, 'runner.pid'), String(child.pid));
    child.unref();

    // Wall-clock watchdog: enforced provider-side, never trusted to the runner.
    const limits = resolveLimits(spec.limits);
    setTimeout(
      () => void this.enforceClockBudget(dir, child),
      limits.maxWallClockSec * 1000,
    ).unref();

    return { id: spec.id, provider: this.providerId, createdAt: Date.now() };
  }

  async getStatus(id: string): Promise<RunStatus> {
    const dir = this.runDir(id);
    const state = await readJson<StateFile>(join(dir, 'state.json'));
    if (!state) throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    if (state.state === 'running' || state.state === 'queued') {
      const pid = await this.readPid(dir);
      if (pid === null || !pidAlive(pid)) {
        const dead: StateFile = {
          ...state, state: 'failed', failureReason: 'runner_error', finishedAt: Date.now(),
        };
        await writeFile(join(dir, 'state.json'), JSON.stringify(dead, null, 2));
        // Emit the transition so subscribeEvents consumers (UI chip, popover)
        // leave 'queued' instead of waiting forever for a runner that exited
        // before its first heartbeat.
        await appendFile(join(dir, 'events.jsonl'), JSON.stringify({ type: 'state', status: dead }) + '\n');
        return dead;
      }
    }
    return state;
  }

  async cancel(id: string): Promise<void> {
    const dir = this.runDir(id);
    const state = await readJson<StateFile>(join(dir, 'state.json'));
    if (!state) throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    if (state.state === 'done' || state.state === 'failed' || state.state === 'cancelled') return;
    const pid = await this.readPid(dir);
    if (pid !== null && pidAlive(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* noop */ } }, 3000).unref();
    }
    const cancelled: StateFile = {
      ...state, state: 'cancelled', failureReason: 'cancelled', finishedAt: Date.now(),
    };
    await writeFile(join(dir, 'state.json'), JSON.stringify(cancelled, null, 2));
    await appendFile(join(dir, 'events.jsonl'), JSON.stringify({ type: 'state', status: cancelled }) + '\n');
  }

  async listArtifacts(id: string): Promise<ArtifactMeta[]> {
    const root = resolve(join(this.runDir(id), 'artifacts'));
    if (!(await exists(root))) {
      const state = await readJson<StateFile>(join(this.runDir(id), 'state.json'));
      if (!state) throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
      return [];
    }
    const out: ArtifactMeta[] = [];
    const walk = async (rel: string): Promise<void> => {
      const abs = join(root, rel);
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(childRel);
        else if (entry.isFile()) out.push({ path: childRel, size: (await stat(join(abs, entry.name))).size });
      }
    };
    await walk('');
    return out;
  }

  async fetchArtifact(id: string, path: string): Promise<Uint8Array> {
    assertSafeArtifactPath(path);
    const root = resolve(join(this.runDir(id), 'artifacts'));
    const abs = resolve(join(root, path));
    if (!abs.startsWith(root + sep)) {
      throw new CloudRunnerError(`artifact escapes run root: ${path}`, 'path_traversal');
    }
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) throw new CloudRunnerError(`artifact not found: ${path}`, 'not_found');
    const data = await readFile(abs);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  async *subscribeEvents(id: string): AsyncIterable<RunEvent> {
    const eventsPath = join(this.runDir(id), 'events.jsonl');
    if (!(await exists(eventsPath)) && !(await exists(join(this.runDir(id), 'state.json')))) {
      throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    }
    let offset = 0;
    for (;;) {
      const data = await readFile(eventsPath, 'utf8').catch(() => '');
      const tail = data.slice(offset);
      offset = data.length;
      let sawTerminal = false;
      let consumed = 0;
      for (const line of tail.split('\n')) {
        if (!line.trim()) { consumed += line.length + 1; continue; }
        try {
          const event = JSON.parse(line) as RunEvent;
          consumed += line.length + 1;
          yield event;
          if (event.type === 'state' && event.status.state !== 'queued' && event.status.state !== 'running') {
            sawTerminal = true;
          }
        } catch {
          // Partial final line at a write boundary: rewind and retry next round.
          offset -= tail.length - consumed;
          break;
        }
      }
      if (sawTerminal) return;
      const { promise, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, this.pollMs);
      await promise;
    }
  }

  // ----------------------------------------------------------

  private runDir(id: string): string {
    return join(this.baseDir, id);
  }

  private async readPid(dir: string): Promise<number | null> {
    const raw = await readFile(join(dir, 'runner.pid'), 'utf8').catch(() => null);
    const pid = raw ? Number(raw.trim()) : NaN;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  private async enforceClockBudget(dir: string, child: ChildProcess): Promise<void> {
    const state = await readJson<StateFile>(join(dir, 'state.json'));
    if (!state || state.state === 'done' || state.state === 'failed' || state.state === 'cancelled') return;
    if (child.pid && pidAlive(child.pid)) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* noop */ }
    }
    const failed: StateFile = {
      ...state, state: 'failed', failureReason: 'budget_exceeded', finishedAt: Date.now(),
    };
    await writeFile(join(dir, 'state.json'), JSON.stringify(failed, null, 2));
    await appendFile(join(dir, 'events.jsonl'), JSON.stringify({ type: 'state', status: failed }) + '\n');
  }
}
