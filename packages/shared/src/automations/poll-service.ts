/**
 * PollUrl Service — fires `PollUrl` automations when a polled HTTP endpoint's
 * fingerprint changes.
 *
 * Each PollUrl matcher specifies:
 *   - pollUrl          (target URL; supports $VAR expansion)
 *   - pollIntervalSec  (poll cadence; minimum 30s)
 *   - pollMethod       (GET/POST/HEAD; default GET)
 *   - pollHeaders      (custom headers; values support $VAR expansion)
 *   - pollFingerprint  (body | etag | last-modified | status; default body)
 *   - pollAuth         (basic / bearer; same shape as webhook actions)
 *
 * Behavior:
 *   - Each matcher gets its own setTimeout-driven poll loop (per-matcher cadence).
 *   - Fingerprint is compared to the last successful fingerprint; an event
 *     fires only when it changes (avoids alert noise on stable endpoints).
 *   - First-ever poll establishes the baseline silently — no event on bootstrap.
 *   - Errors are logged and the next poll is scheduled normally; transient
 *     network failures don't reset the baseline.
 *
 * Like the FileWatch service, routing is per-matcher: each emitted event
 * carries its originating matcher's ID.
 */

import { createHash } from 'node:crypto';
import type { AutomationMatcher } from './types.ts';
import type { PollUrlPayload } from './event-bus.ts';
import { expandEnvVars, cleanEnv } from './utils.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('poll-service');

const MIN_POLL_INTERVAL_SEC = 30;
const DEFAULT_POLL_INTERVAL_SEC = 300;
/** Captured response body is truncated for memory safety. */
const BODY_TRUNCATE_BYTES = 4096;
/** HTTP request timeout. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface PollServiceOptions {
  workspaceId: string;
  onEvent: (payload: PollUrlPayload) => void | Promise<void>;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Skip the first-poll baseline establishment — emit on every poll. Tests only. */
  emitOnFirstPoll?: boolean;
}

export class PollService {
  private readonly options: PollServiceOptions;
  /** matcherId → live poll bucket */
  private readonly buckets = new Map<string, PollBucket>();
  private disposed = false;

  constructor(options: PollServiceOptions) {
    this.options = options;
  }

  /**
   * (Re)configure the active polls from the current PollUrl matcher set.
   * Cancels obsolete buckets, refreshes existing ones, opens new ones.
   * Last-known fingerprints survive a refresh so we don't re-fire after a
   * config save just because the user toggled a label or comment.
   */
  applyMatchers(matchers: AutomationMatcher[]): void {
    if (this.disposed) return;

    const seen = new Set<string>();
    for (const m of matchers) {
      const matcherId = m.id;
      if (!matcherId || !m.pollUrl) continue;
      seen.add(matcherId);

      const interval = clampInterval(m.pollIntervalSec);
      const existing = this.buckets.get(matcherId);
      if (existing) {
        // Refresh in place. Preserve lastFingerprint to avoid duplicate fires.
        existing.matcher = m;
        existing.intervalMs = interval * 1000;
        // Re-arm the timer with the new cadence
        if (existing.timer) {
          clearTimeout(existing.timer);
          existing.timer = setTimeout(() => this.runOnce(matcherId), existing.intervalMs);
        }
        continue;
      }

      const bucket: PollBucket = {
        matcher: m,
        intervalMs: interval * 1000,
        lastFingerprint: null,
        timer: null,
        firstPollDone: false,
      };
      this.buckets.set(matcherId, bucket);
      // Stagger first poll by a small jitter so a config-load with N polls
      // doesn't burst N requests at the same instant.
      const initialDelay = 1000 + Math.floor(Math.random() * 4000);
      bucket.timer = setTimeout(() => this.runOnce(matcherId), initialDelay);
    }

    // Cancel buckets removed from the config
    for (const [id, bucket] of this.buckets) {
      if (!seen.has(id)) {
        if (bucket.timer) clearTimeout(bucket.timer);
        this.buckets.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const bucket of this.buckets.values()) {
      if (bucket.timer) clearTimeout(bucket.timer);
    }
    this.buckets.clear();
  }

  // -------------------------------------------------------------------------

  /**
   * Run a single poll for a matcher and reschedule the next one.
   * Public for testing — production callers should use applyMatchers.
   */
  async runOnce(matcherId: string): Promise<void> {
    const bucket = this.buckets.get(matcherId);
    if (!bucket || this.disposed) return;

    try {
      await this.executePoll(bucket);
    } catch (err) {
      log.warn(`[poll] ${matcherId} poll failed:`, err);
    }

    // Reschedule, regardless of outcome
    if (this.disposed) return;
    if (bucket.timer) clearTimeout(bucket.timer);
    bucket.timer = setTimeout(() => this.runOnce(matcherId), bucket.intervalMs);
  }

  private async executePoll(bucket: PollBucket): Promise<void> {
    const m = bucket.matcher;
    if (!m.pollUrl || !m.id) return;

    const env = cleanEnv();
    const url = expandEnvVars(m.pollUrl, env);
    if (!url || !/^https?:\/\//i.test(url)) {
      log.warn(`[poll] ${m.id} skipped: invalid URL after expansion`);
      return;
    }

    const headers: Record<string, string> = {};
    if (m.pollHeaders) {
      for (const [k, v] of Object.entries(m.pollHeaders)) {
        headers[k] = expandEnvVars(v, env);
      }
    }
    if (m.pollAuth) {
      if (m.pollAuth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${expandEnvVars(m.pollAuth.token, env)}`;
      } else if (m.pollAuth.type === 'basic') {
        const u = expandEnvVars(m.pollAuth.username, env);
        const p = expandEnvVars(m.pollAuth.password, env);
        headers['Authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
      }
    }

    const method = m.pollMethod ?? 'GET';
    const fingerprintKind = m.pollFingerprint ?? 'body';

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(url, { method, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    let bodyText = '';
    if (fingerprintKind === 'body' || method !== 'HEAD') {
      try {
        bodyText = await response.text();
      } catch {
        bodyText = '';
      }
    }

    const fingerprint = computeFingerprint(fingerprintKind, response, bodyText);
    const previousFingerprint = bucket.lastFingerprint;

    // Always update the stored fingerprint for the next comparison
    bucket.lastFingerprint = fingerprint;

    const isFirstPoll = !bucket.firstPollDone;
    bucket.firstPollDone = true;

    // First poll establishes baseline — don't fire (unless test override).
    // Subsequent polls fire only on change.
    const shouldFire =
      this.options.emitOnFirstPoll === true ||
      (!isFirstPoll && fingerprint !== previousFingerprint);

    if (!shouldFire) {
      log.debug(`[poll] ${m.id} no change (${fingerprintKind}=${fingerprint.slice(0, 16)}…)`);
      return;
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const payload: PollUrlPayload = {
      workspaceId: this.options.workspaceId,
      timestamp: Date.now(),
      matcherId: m.id,
      url,
      status: response.status,
      fingerprintKind,
      fingerprint,
      previousFingerprint,
      body: fingerprintKind === 'body' ? bodyText.slice(0, BODY_TRUNCATE_BYTES) : null,
      headers: responseHeaders,
    };

    await Promise.resolve(this.options.onEvent(payload)).catch((err) => {
      log.warn(`[poll] ${m.id} onEvent failed:`, err);
    });
  }
}

interface PollBucket {
  matcher: AutomationMatcher;
  intervalMs: number;
  lastFingerprint: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** True after the first poll completes; baseline-establishment marker. */
  firstPollDone: boolean;
}

function clampInterval(input: number | undefined): number {
  const v = input ?? DEFAULT_POLL_INTERVAL_SEC;
  if (v < MIN_POLL_INTERVAL_SEC) return MIN_POLL_INTERVAL_SEC;
  return v;
}

function computeFingerprint(
  kind: 'body' | 'etag' | 'last-modified' | 'status',
  response: Response,
  bodyText: string,
): string {
  switch (kind) {
    case 'etag':
      return response.headers.get('etag') ?? '';
    case 'last-modified':
      return response.headers.get('last-modified') ?? '';
    case 'status':
      return String(response.status);
    case 'body':
    default:
      return createHash('sha256').update(bodyText, 'utf8').digest('hex');
  }
}
