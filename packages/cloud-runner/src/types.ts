/**
 * Cloud Runs — core contract.
 *
 * Types and the CloudRunProvider interface shared by every provider
 * (local subprocess, Cloudflare Computer, Modal/E2B fallback).
 *
 * Design rule (PRD docs/cloud-runs-prd.md §G1): the interface is
 * modelled after the craft-agents use case — submit a pack of
 * prepared subtasks, wait, collect artifacts — NOT after any single
 * vendor's API. Swapping providers must touch exactly one file.
 */

// ============================================================
// Run specification (client → provider)
// ============================================================

/** One unit of background work: a prepared prompt for one agent. */
export interface CloudRunSubtask {
  /** Stable id inside the run; used for artifact paths and resume. */
  id: string;
  /** Short human title for UI lists. */
  title?: string;
  /** Fully rendered prompt the provider's runner feeds to an agent. */
  prompt: string;
  /** F6: per-subtask model override (runner falls back to spec-level model). */
  model?: { connectionSlug?: string; modelId?: string };
}

/** Budget/ceiling options. Server-side enforcement is authoritative. */
export interface RunLimits {
  /** Kill the run past this wall-clock budget. */
  maxWallClockSec?: number;
  /** LLM token ceiling, enforced by the LLM gateway (not compute). */
  maxLlmTokens?: number;
  /** Artifact-collection size ceiling in bytes. */
  maxArtifactsBytes?: number;
}

export interface RunSpec {
  /**
   * Client-generated idempotency key. Resubmitting the same id MUST
   * return the same run rather than duplicating work.
   */
  id: string;
  /** Human-readable name shown in the runs panel. */
  name: string;
  /** Prepared prompt pack (adapted to the user's case by the app). */
  subtasks: CloudRunSubtask[];
  /** LLM selection the app resolved for this run. */
  model?: {
    connectionSlug?: string;
    modelId?: string;
  };
  limits?: RunLimits;
  /** Artifact retention; provider may garbage-collect afterwards. */
  ttlSec?: number;
  /** F16: extra deliverables, e.g. ['slides'] (CF provider only). */
  outputs?: string[];
  /** F7: fork — parent run id; its briefs land in the new run's context. */
  fromRunId?: string;
  /** F4 switch: agentic tool-loop (default true); false = one-shot LLM per subtask. */
  agentic?: boolean;
  /** F21: runner flavor — default loop; omp = via omp CLI in CF image. */
  agenticMode?: 'loop' | 'omp';
  /** Free-form linkage back to the originating session/workspace. */
  metadata?: Record<string, string>;
}

// ============================================================
// Run status (provider → client)
// ============================================================

export type RunState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type RunFailureReason =
  | 'budget_exceeded'
  | 'runner_error'
  | 'provider_error'
  | 'cancelled';

export interface RunHandle {
  id: string;
  provider: string;
  createdAt: number;
}

export interface RunStatus {
  id: string;
  state: RunState;
  startedAt?: number;
  finishedAt?: number;
  failureReason?: RunFailureReason;
  /** Optional progress signal surfaced to the UI. */
  progress?: { completed: number; total: number };
  /** Aggregated LLM usage ledger (PRD §G5.2). */
  usage?: { promptTokens: number; completionTokens: number };
}

// ============================================================
// Artifacts
// ============================================================

/** Paths are POSIX-style and relative to the run's artifact root. */
export interface ArtifactMeta {
  path: string;
  size: number;
}

// ============================================================
// Events (subscribeEvents)
// ============================================================

export type RunEvent =
  | { type: 'state'; status: RunStatus }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'log'; message: string };

// ============================================================
// Errors
// ============================================================

export class CloudRunnerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid_spec'
      | 'artifact_too_large'
      | 'path_traversal'
      | 'provider_error',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CloudRunnerError';
  }
}

// ============================================================
// Provider interface
// ============================================================

export interface CloudRunProvider {
  /** Stable provider id used in config: 'local' | 'cloudflare' | ... */
  readonly providerId: string;

  createRun(spec: RunSpec): Promise<RunHandle>;
  getStatus(id: string): Promise<RunStatus>;
  cancel(id: string): Promise<void>;
  listArtifacts(id: string): Promise<ArtifactMeta[]>;
  /** Sanitizing read: rejects path traversal and oversize payloads. */
  fetchArtifact(id: string, path: string): Promise<Uint8Array>;
  /**
   * Live event stream. Yields at least the terminal 'state' event
   * exactly once before completing.
   */
  subscribeEvents(id: string): AsyncIterable<RunEvent>;
}

// ============================================================
// Defaults (mirrors server-side ceilings; PRD §G5.1)
// ============================================================

export const DEFAULT_RUN_LIMITS: Required<RunLimits> = {
  maxWallClockSec: 30 * 60,
  maxLlmTokens: 2_000_000,
  maxArtifactsBytes: 25 * 1024 * 1024,
};

export function resolveLimits(limits?: RunLimits): Required<RunLimits> {
  return { ...DEFAULT_RUN_LIMITS, ...limits };
}

/** Shared artifact-path validation used by every provider. */
export function assertSafeArtifactPath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.split('/').includes('..')
  ) {
    throw new CloudRunnerError(`unsafe artifact path: ${path}`, 'path_traversal');
  }
}
