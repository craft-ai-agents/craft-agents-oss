/**
 * Page Action Bridge — mediated source actions for Pages
 *
 * Page JS never talks to sources. It posts a request up to the host, and this
 * broker decides whether the host executes it. Mirrors (and extends) the
 * privilegedExecutionBroker pattern:
 *
 *   render lease  — in-memory, per render instance. Issued when the host
 *                   mounts a page; carries a nonce the page must echo on
 *                   every request (frame identity without a trustable
 *                   Origin). Bound to the page's content digest — content
 *                   changes end the lease.
 *   grant         — persisted in page.json, user-approved, content-digest
 *                   bound (like commandHash) AND expiring. Describes a class
 *                   of calls (api method + path regex, or one mcp tool).
 *   request       — one concrete invocation. Must carry a valid lease
 *                   (id + nonce), a fresh unique requestId (replay check),
 *                   and a grant that matches the invocation.
 *
 * Execution is delegated to injected executors (built by the host from the
 * shared source machinery), always under an AbortSignal: every action has a
 * timeout and can be cancelled mid-flight. Credentials are resolved inside
 * the executors at call time and never appear in requests, results, or the
 * audit log.
 *
 * Every decision — lease issued, action executed/rejected/cancelled — is
 * appended to a durable JSONL audit log (~/.craft-agent/logs/page-actions.jsonl),
 * with caller-supplied objects redacted by key name.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  PageActionGrant,
  PageActionInvocation,
  PageActionRequest,
  PageActionResult,
  PageActionHttpMethod,
  PageScriptRuntime,
  PageConfig,
  PageRenderLease,
} from '@craft-agent/core';
import { CONFIG_DIR } from '../config/paths.ts';
import { createLogger } from '../utils/debug.ts';
import { redactSensitiveValues } from '../utils/redaction.ts';
import { evaluateApiEndpointPolicy, evaluateMcpToolPolicy, type SourceActionPolicyDecision } from '../agent/source-policy.ts';
import type { PermissionsContext } from '../agent/permissions-config.ts';
import { proxyToolName } from '../mcp/proxy-tool-name.ts';
import { hasPathTraversal } from './types.ts';

const log = createLogger('page-action-broker');

/** Default render-lease lifetime; re-mounting a page issues a fresh lease */
export const DEFAULT_PAGE_LEASE_TTL_MS = 12 * 60 * 60 * 1000;
/** Default per-action timeout */
export const DEFAULT_PAGE_ACTION_TIMEOUT_MS = 30_000;
/** Replay-cache cap per lease — beyond this the lease must be re-issued */
const MAX_SEEN_REQUEST_IDS_PER_LEASE = 5_000;
/**
 * Host-side per-lease budget. The renderer runs its own PageActionRateLimiter
 * with the same numbers, but that one is advisory — anything that can reach
 * the executeAction RPC bypasses it, so the broker enforces the real cap.
 * Matching the renderer's budget means a well-behaved page never hits this.
 */
export const PAGE_ACTION_MAX_IN_FLIGHT_PER_LEASE = 5;
export const PAGE_ACTION_MAX_STARTS_PER_MINUTE_PER_LEASE = 30;
const PAGE_ACTION_RATE_WINDOW_MS = 60_000;
/**
 * Cap on simultaneously live leases. Expiry alone (12h TTL) lets a re-mount
 * loop grow the lease + replay-cache maps unbounded; past the cap the
 * oldest-issued lease is evicted (audited) — old renders lose their lease and
 * recover by re-mounting, new mounts always work.
 */
export const MAX_LIVE_LEASES = 256;

export type PageActionValidationErrorCode =
  | 'lease-not-found'
  | 'lease-page-mismatch'
  | 'lease-expired'
  | 'nonce-mismatch'
  | 'replay'
  | 'replay-cache-full'
  | 'content-missing'
  | 'content-changed'
  | 'grant-not-found'
  | 'grant-stale'
  | 'grant-expired'
  | 'grant-mismatch'
  | 'grant-pattern-invalid'
  | 'invocation-path-unsafe'
  | 'rate-limited'
  | 'executor-unavailable';

type ValidationOutcome =
  | { ok: true; grant: PageActionGrant }
  | { ok: false; code: PageActionValidationErrorCode; reason: string };

/**
 * Execution backends, injected by the host process. Implementations resolve
 * credentials lazily (inside the call) and must honor `signal`.
 */
export interface PageActionExecutors {
  /** Execute an api-kind invocation against an API source */
  executeApi?: (
    invocation: { sourceSlug: string; method: PageActionHttpMethod; path: string; params?: Record<string, unknown> },
    options: { signal: AbortSignal },
  ) => Promise<{ status: number; ok: boolean; body: unknown }>;
  /** Execute an mcp-kind invocation against an MCP source */
  executeMcp?: (
    invocation: { sourceSlug: string; toolName: string; args: Record<string, unknown> },
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
  /**
   * Execute a script-kind invocation: run the grant's pinned script on the
   * host. Resolves with the process outcome even on a non-zero exit (the page
   * still wants stdout/stderr); throws only when the script could not run at
   * all (path escape, missing runtime, spawn failure).
   */
  executeScript?: (
    invocation: { pageSlug: string; script: string; runtime?: PageScriptRuntime; args?: string[] },
    options: { signal: AbortSignal },
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface PageActionBrokerOptions {
  executors: PageActionExecutors;
  /** Audit log path (default: {CONFIG_DIR}/logs/page-actions.jsonl) */
  auditLogPath?: string;
  /** Render-lease lifetime in ms */
  leaseTtlMs?: number;
  /** Per-action timeout in ms */
  actionTimeoutMs?: number;
  /** Workspace context for policy annotation in the audit trail */
  permissionsContext?: PermissionsContext;
  /** Test hook */
  now?: () => number;
}

export interface CreateLeaseInput {
  pageSlug: string;
  /** Digest of the content actually being rendered */
  contentDigest: string;
}

export class PageActionBroker {
  private readonly executors: PageActionExecutors;
  private readonly auditLogPath: string;
  private readonly leaseTtlMs: number;
  private readonly actionTimeoutMs: number;
  private readonly permissionsContext?: PermissionsContext;
  private readonly now: () => number;

  private readonly leases = new Map<string, PageRenderLease>();
  private readonly seenRequestIds = new Map<string, Set<string>>();
  private readonly inFlight = new Map<string, AbortController>();
  /** leaseId → number of actions currently executing */
  private readonly inFlightByLease = new Map<string, number>();
  /** leaseId → start timestamps within the sliding rate window */
  private readonly startTimesByLease = new Map<string, number[]>();

  constructor(options: PageActionBrokerOptions) {
    this.executors = options.executors;
    this.auditLogPath = options.auditLogPath ?? join(CONFIG_DIR, 'logs', 'page-actions.jsonl');
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_PAGE_LEASE_TTL_MS;
    this.actionTimeoutMs = options.actionTimeoutMs ?? DEFAULT_PAGE_ACTION_TIMEOUT_MS;
    this.permissionsContext = options.permissionsContext;
    this.now = options.now ?? Date.now;
  }

  // ==========================================================
  // Leases
  // ==========================================================

  /**
   * Issue a render lease for one mount of a page. The returned nonce travels
   * into the iframe and must be echoed on every action request.
   */
  createLease(input: CreateLeaseInput): PageRenderLease {
    this.pruneExpiredLeases();

    if (this.leases.size >= MAX_LIVE_LEASES) {
      let oldest: PageRenderLease | undefined;
      for (const lease of this.leases.values()) {
        if (!oldest || lease.issuedAt < oldest.issuedAt) oldest = lease;
      }
      if (oldest) {
        this.dropLease(oldest.leaseId);
        void this.appendAudit({
          event: 'page_lease_evicted',
          pageSlug: oldest.pageSlug,
          leaseId: oldest.leaseId,
          reason: 'lease-store-full',
        });
      }
    }

    const now = this.now();
    const lease: PageRenderLease = {
      leaseId: randomUUID(),
      nonce: randomBytes(16).toString('hex'),
      pageSlug: input.pageSlug,
      contentDigest: input.contentDigest,
      issuedAt: now,
      expiresAt: now + this.leaseTtlMs,
    };

    this.leases.set(lease.leaseId, lease);
    this.seenRequestIds.set(lease.leaseId, new Set());
    void this.appendAudit({
      event: 'page_lease_created',
      pageSlug: lease.pageSlug,
      leaseId: lease.leaseId,
      contentDigest: lease.contentDigest,
      expiresAt: lease.expiresAt,
    });
    return lease;
  }

  /** Drop a lease (page unmounted). Idempotent. */
  releaseLease(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.dropLease(leaseId);
    void this.appendAudit({ event: 'page_lease_released', pageSlug: lease.pageSlug, leaseId });
  }

  private dropLease(leaseId: string): void {
    this.leases.delete(leaseId);
    this.seenRequestIds.delete(leaseId);
    this.inFlightByLease.delete(leaseId);
    this.startTimesByLease.delete(leaseId);
  }

  // ==========================================================
  // Per-lease rate limiting (host-side; the renderer limiter is advisory)
  // ==========================================================

  private rateLimitRejection(leaseId: string): { code: 'rate-limited'; reason: string } | null {
    if ((this.inFlightByLease.get(leaseId) ?? 0) >= PAGE_ACTION_MAX_IN_FLIGHT_PER_LEASE) {
      return {
        code: 'rate-limited',
        reason: `Too many actions in flight for this render (max ${PAGE_ACTION_MAX_IN_FLIGHT_PER_LEASE})`,
      };
    }
    const now = this.now();
    const starts = (this.startTimesByLease.get(leaseId) ?? []).filter(
      (t) => now - t < PAGE_ACTION_RATE_WINDOW_MS,
    );
    this.startTimesByLease.set(leaseId, starts);
    if (starts.length >= PAGE_ACTION_MAX_STARTS_PER_MINUTE_PER_LEASE) {
      return {
        code: 'rate-limited',
        reason: `Too many actions this minute for this render (max ${PAGE_ACTION_MAX_STARTS_PER_MINUTE_PER_LEASE}/minute)`,
      };
    }
    return null;
  }

  private noteActionStart(leaseId: string): void {
    this.inFlightByLease.set(leaseId, (this.inFlightByLease.get(leaseId) ?? 0) + 1);
    const starts = this.startTimesByLease.get(leaseId) ?? [];
    starts.push(this.now());
    this.startTimesByLease.set(leaseId, starts);
  }

  private noteActionEnd(leaseId: string): void {
    const current = this.inFlightByLease.get(leaseId) ?? 0;
    if (current <= 1) this.inFlightByLease.delete(leaseId);
    else this.inFlightByLease.set(leaseId, current - 1);
  }

  private pruneExpiredLeases(): void {
    const now = this.now();
    for (const [leaseId, lease] of this.leases) {
      if (now > lease.expiresAt) this.dropLease(leaseId);
    }
  }

  // ==========================================================
  // Validation
  // ==========================================================

  private validate(page: PageConfig, request: PageActionRequest): ValidationOutcome {
    const now = this.now();

    const lease = this.leases.get(request.leaseId);
    if (!lease) {
      return { ok: false, code: 'lease-not-found', reason: 'No render lease for this request — re-mount the page' };
    }
    if (lease.pageSlug !== request.pageSlug || page.slug !== request.pageSlug) {
      return { ok: false, code: 'lease-page-mismatch', reason: 'Lease belongs to a different page' };
    }
    if (now > lease.expiresAt) {
      this.dropLease(request.leaseId);
      return { ok: false, code: 'lease-expired', reason: 'Render lease expired — re-mount the page' };
    }
    if (lease.nonce !== request.nonce) {
      return { ok: false, code: 'nonce-mismatch', reason: 'Request nonce does not match the render lease' };
    }

    if (!page.contentDigest) {
      return { ok: false, code: 'content-missing', reason: 'Page has no content digest' };
    }
    if (lease.contentDigest !== page.contentDigest) {
      return { ok: false, code: 'content-changed', reason: 'Page content changed since this render — re-mount the page' };
    }

    const seen = this.seenRequestIds.get(request.leaseId);
    if (seen?.has(request.requestId)) {
      return { ok: false, code: 'replay', reason: 'Request id was already used on this lease' };
    }
    if (seen && seen.size >= MAX_SEEN_REQUEST_IDS_PER_LEASE) {
      return { ok: false, code: 'replay-cache-full', reason: 'Lease exhausted its request budget — re-mount the page' };
    }

    const grant = page.grants?.find((g) => g.id === request.grantId);
    if (!grant) {
      return { ok: false, code: 'grant-not-found', reason: `No grant ${request.grantId} on this page` };
    }
    if (grant.contentDigest !== page.contentDigest) {
      return { ok: false, code: 'grant-stale', reason: 'Grant was approved for older page content — re-approval required' };
    }
    if (now > grant.expiresAt) {
      return { ok: false, code: 'grant-expired', reason: 'Grant expired — re-approval required' };
    }

    const mismatch = this.invocationMismatch(grant, request.invocation);
    if (mismatch) return mismatch;

    return { ok: true, grant };
  }

  /** Check the concrete invocation against the grant's descriptor. */
  private invocationMismatch(grant: PageActionGrant, invocation: PageActionInvocation): ValidationOutcome | null {
    if (grant.action.kind !== invocation.kind) {
      return { ok: false, code: 'grant-mismatch', reason: `Grant allows ${grant.action.kind} actions, request is ${invocation.kind}` };
    }

    if (grant.action.kind === 'api' && invocation.kind === 'api') {
      if (grant.action.method !== invocation.method) {
        return { ok: false, code: 'grant-mismatch', reason: `Grant allows ${grant.action.method}, request is ${invocation.method}` };
      }
      // Reject traversal BEFORE the pattern match. fetch normalizes `..`, so a
      // raw path that matches the anchored pattern could still resolve to a
      // different endpoint with the real credential. Rejecting here guarantees
      // the (raw) path later forwarded to executeApi is traversal-free — match
      // and execution agree without transforming the forwarded path.
      if (hasPathTraversal(invocation.path)) {
        return { ok: false, code: 'invocation-path-unsafe', reason: 'Request path contains a directory-traversal segment' };
      }
      let pattern: RegExp;
      try {
        // Anchored: the grant's pattern must match the WHOLE path.
        pattern = new RegExp(`^(?:${grant.action.pathPattern})$`);
      } catch {
        return { ok: false, code: 'grant-pattern-invalid', reason: 'Grant path pattern is not a valid regex' };
      }
      const path = invocation.path.startsWith('/') ? invocation.path : `/${invocation.path}`;
      if (!pattern.test(path)) {
        return { ok: false, code: 'grant-mismatch', reason: `Path ${path} does not match the granted pattern` };
      }
      return null;
    }

    if (grant.action.kind === 'mcp' && invocation.kind === 'mcp') {
      if (grant.action.toolName !== invocation.toolName) {
        return { ok: false, code: 'grant-mismatch', reason: `Grant allows tool ${grant.action.toolName}, request is ${invocation.toolName}` };
      }
      return null;
    }

    if (grant.action.kind === 'script' && invocation.kind === 'script') {
      // Nothing to compare: the trigger carries no script/args, so the grant's
      // descriptor is authoritative and any script-for-script pair matches.
      return null;
    }

    return { ok: false, code: 'grant-mismatch', reason: 'Unsupported action kind' };
  }

  // ==========================================================
  // Execution
  // ==========================================================

  /**
   * Validate and execute one page action request against the current
   * page.json state. Never throws — failures come back as { ok: false }.
   */
  async executeAction(page: PageConfig, request: PageActionRequest): Promise<PageActionResult> {
    const startTime = this.now();
    const invocationSummary = this.summarizeInvocation(request.invocation);

    const validation = this.validate(page, request);
    if (!validation.ok) {
      void this.appendAudit({
        event: 'page_action_rejected',
        pageSlug: request.pageSlug,
        requestId: request.requestId,
        leaseId: request.leaseId,
        grantId: request.grantId,
        invocation: invocationSummary,
        code: validation.code,
        reason: validation.reason,
      });
      return {
        requestId: request.requestId,
        ok: false,
        error: `${validation.code}: ${validation.reason}`,
        durationMs: this.now() - startTime,
      };
    }

    const { grant } = validation;

    // Rate check AFTER validation (a throttled caller learns nothing about
    // lease/grant validity it didn't already prove) and BEFORE burning the
    // requestId — a throttled request never executed, so its id stays usable.
    const limited = this.rateLimitRejection(request.leaseId);
    if (limited) {
      void this.appendAudit({
        event: 'page_action_rejected',
        pageSlug: request.pageSlug,
        requestId: request.requestId,
        leaseId: request.leaseId,
        grantId: request.grantId,
        invocation: invocationSummary,
        code: limited.code,
        reason: limited.reason,
      });
      return {
        requestId: request.requestId,
        ok: false,
        error: `${limited.code}: ${limited.reason}`,
        durationMs: this.now() - startTime,
      };
    }

    this.seenRequestIds.get(request.leaseId)?.add(request.requestId);
    this.noteActionStart(request.leaseId);

    // Policy annotation: grants ARE the user approval, so a
    // requires-approval verdict does not block a granted call — but the
    // audit trail records how the same call would classify for an agent.
    const policy: SourceActionPolicyDecision =
      grant.action.kind === 'api'
        ? evaluateApiEndpointPolicy(
            grant.action.method,
            request.invocation.kind === 'api' ? request.invocation.path : undefined,
            this.permissionsContext,
          )
        : grant.action.kind === 'mcp'
          ? evaluateMcpToolPolicy(
              proxyToolName(grant.action.sourceSlug, grant.action.toolName),
              (request.invocation.kind === 'mcp' ? request.invocation.args : undefined) ?? {},
            )
          : // script: host command execution — always approval-worthy for an agent,
            // annotated here purely for the audit trail (the grant is the approval).
            { decision: 'requires-approval', description: `script: ${grant.action.script}` };

    const controller = new AbortController();
    this.inFlight.set(request.requestId, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.actionTimeoutMs)]);

    let result: PageActionResult;
    try {
      if (grant.action.kind === 'api' && request.invocation.kind === 'api') {
        if (!this.executors.executeApi) {
          result = this.unavailableResult(request, startTime, 'API executor not wired in this host');
        } else {
          const outcome = await this.executors.executeApi(
            {
              sourceSlug: grant.action.sourceSlug,
              method: request.invocation.method,
              path: request.invocation.path,
              params: request.invocation.params,
            },
            { signal },
          );
          result = {
            requestId: request.requestId,
            ok: outcome.ok,
            status: outcome.status,
            body: outcome.body,
            ...(outcome.ok ? {} : { error: `API responded with status ${outcome.status}` }),
            durationMs: this.now() - startTime,
          };
        }
      } else if (grant.action.kind === 'mcp' && request.invocation.kind === 'mcp') {
        if (!this.executors.executeMcp) {
          result = this.unavailableResult(request, startTime, 'MCP executor not wired in this host');
        } else {
          const body = await this.executors.executeMcp(
            {
              sourceSlug: grant.action.sourceSlug,
              toolName: request.invocation.toolName,
              args: request.invocation.args ?? {},
            },
            { signal },
          );
          result = {
            requestId: request.requestId,
            ok: true,
            body,
            durationMs: this.now() - startTime,
          };
        }
      } else if (grant.action.kind === 'script' && request.invocation.kind === 'script') {
        if (!this.executors.executeScript) {
          result = this.unavailableResult(request, startTime, 'Script executor not wired in this host');
        } else {
          const outcome = await this.executors.executeScript(
            {
              pageSlug: page.slug,
              script: grant.action.script,
              runtime: grant.action.runtime,
              args: grant.action.args,
            },
            { signal },
          );
          const ok = outcome.exitCode === 0;
          result = {
            requestId: request.requestId,
            ok,
            // The page sees stdout/stderr/exit even on failure — a script that
            // exits non-zero with a useful message should surface that message.
            body: { exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr },
            ...(ok ? {} : { error: `Script exited with code ${outcome.exitCode ?? 'null'}` }),
            durationMs: this.now() - startTime,
          };
        }
      } else {
        // invocationMismatch() makes this unreachable; keep a safe fallback.
        result = this.unavailableResult(request, startTime, 'Invocation kind does not match grant');
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? 'Cancelled'
        : error instanceof Error ? error.message : 'Unknown error';
      result = {
        requestId: request.requestId,
        ok: false,
        error: message,
        durationMs: this.now() - startTime,
      };
    } finally {
      this.inFlight.delete(request.requestId);
      this.noteActionEnd(request.leaseId);
    }

    void this.appendAudit({
      event: 'page_action_executed',
      pageSlug: request.pageSlug,
      requestId: request.requestId,
      leaseId: request.leaseId,
      grantId: grant.id,
      invocation: invocationSummary,
      policyDecision: policy.decision,
      ok: result.ok,
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.error ? { error: result.error } : {}),
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Abort an in-flight action. Returns false when the request is unknown or
   * already settled.
   */
  cancelAction(requestId: string): boolean {
    const controller = this.inFlight.get(requestId);
    if (!controller) return false;
    controller.abort();
    void this.appendAudit({ event: 'page_action_cancelled', requestId });
    return true;
  }

  /** Number of live leases (diagnostics/tests). */
  get leaseCount(): number {
    this.pruneExpiredLeases();
    return this.leases.size;
  }

  private unavailableResult(request: PageActionRequest, startTime: number, reason: string): PageActionResult {
    return {
      requestId: request.requestId,
      ok: false,
      error: `executor-unavailable: ${reason}`,
      durationMs: this.now() - startTime,
    };
  }

  /** Audit-safe summary of an invocation: shape + redacted params, no bodies. */
  private summarizeInvocation(invocation: PageActionInvocation): Record<string, unknown> {
    if (invocation.kind === 'api') {
      return {
        kind: 'api',
        method: invocation.method,
        path: invocation.path,
        ...(invocation.params ? { params: redactSensitiveValues(invocation.params) } : {}),
      };
    }
    if (invocation.kind === 'mcp') {
      return {
        kind: 'mcp',
        toolName: invocation.toolName,
        ...(invocation.args ? { args: redactSensitiveValues(invocation.args) } : {}),
      };
    }
    // script is a bare trigger — the resolved grantId in the same audit row
    // carries the script path/runtime/args, so there is nothing to summarize.
    return { kind: 'script' };
  }

  /**
   * Append an audit event (fire-and-forget, mirrors privileged-execution-broker:
   * audit failures are logged but never fail the action).
   */
  private async appendAudit(payload: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(dirname(this.auditLogPath), { recursive: true });
      await appendFile(
        this.auditLogPath,
        `${JSON.stringify({ timestamp: new Date().toISOString(), ...payload })}\n`,
        'utf8',
      );
    } catch (error) {
      log.warn(`[PageActionBroker] Failed to write audit log: ${error}`);
    }
  }
}
