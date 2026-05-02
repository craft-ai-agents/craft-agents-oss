/**
 * Pulses — tick log storage.
 *
 * Append-only JSONL at:
 *   <workspaceRoot>/pulses/<pulseId>/ticks.jsonl
 *
 * `appendFileSync` writes whole lines so concurrent appends won't corrupt
 * earlier entries on the same filesystem; we don't need full atomic-replace
 * for an append-only log. The directory is ensured on each append.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PULSE_ANTI_SPAM_THRESHOLD,
  PULSE_ID_REGEX,
  PULSE_SILENCE_DURATION_MS,
  type PulseDecisionAction,
  type PulseSilenceState,
  type PulseTickEntry,
} from './types.ts';

// ============================================================================
// Paths
// ============================================================================

export function getPulsesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'pulses');
}

export function getPulseDir(workspaceRootPath: string, pulseId: string): string {
  assertValidPulseId(pulseId);
  return join(getPulsesDir(workspaceRootPath), pulseId);
}

export function getPulseTicksFile(workspaceRootPath: string, pulseId: string): string {
  return join(getPulseDir(workspaceRootPath, pulseId), 'ticks.jsonl');
}

export function isValidPulseId(pulseId: string): boolean {
  return typeof pulseId === 'string' && PULSE_ID_REGEX.test(pulseId);
}

function assertValidPulseId(pulseId: string): void {
  if (!isValidPulseId(pulseId)) {
    throw new Error(
      `Invalid pulseId: "${pulseId}" (lowercase letters, digits, hyphens; 1-64 chars).`,
    );
  }
}

/** Derive an on-disk pulseId from an automation matcher. */
export function pulseIdFromAutomationMatcher(matcher: { id?: string; slug?: string }): string {
  const id = matcher.id ?? matcher.slug;
  if (!id) {
    throw new Error('Cannot derive pulseId: automation matcher has neither id nor slug.');
  }
  assertValidPulseId(id);
  return id;
}

// ============================================================================
// Append
// ============================================================================

export function appendPulseTick(
  workspaceRootPath: string,
  pulseId: string,
  entry: PulseTickEntry,
): void {
  assertValidPulseId(pulseId);
  const dir = getPulseDir(workspaceRootPath, pulseId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'ticks.jsonl');
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
}

// ============================================================================
// Read
// ============================================================================

export interface ReadPulseTicksOptions {
  /** Maximum entries to return. Newest-first when no `after` is given. */
  limit?: number;
  /** Only entries with `tickedAt > after`. Returned chronological (oldest-first). */
  after?: string;
}

export function readPulseTicks(
  workspaceRootPath: string,
  pulseId: string,
  options: ReadPulseTicksOptions = {},
): PulseTickEntry[] {
  assertValidPulseId(pulseId);
  const file = join(getPulseDir(workspaceRootPath, pulseId), 'ticks.jsonl');
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.split('\n');
  const entries: PulseTickEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPulseTickEntry(parsed)) continue;
    entries.push(parsed);
  }

  const { limit, after } = options;

  if (after) {
    const filtered = entries.filter((e) => e.tickedAt > after);
    return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
  }

  // Newest-first when no filter — tail the end of the file.
  const reversed = entries.slice().reverse();
  return typeof limit === 'number' ? reversed.slice(0, limit) : reversed;
}

function isPulseTickEntry(value: unknown): value is PulseTickEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.pulseId !== 'string') return false;
  if (typeof v.tickedAt !== 'string') return false;
  if (typeof v.durationMs !== 'number') return false;
  if (typeof v.driverSessionId !== 'string') return false;
  if (!v.decision || typeof v.decision !== 'object') return false;
  if (typeof (v.decision as Record<string, unknown>).action !== 'string') return false;
  if (!v.diffSummary || typeof v.diffSummary !== 'object') return false;
  return true;
}

// ============================================================================
// Anti-spam silence state — persisted per Pulse so the silenced state
// survives across ticks (and process restarts) instead of being inferred
// from the last 3 tick entries (which fails: a silenced do_nothing entry
// breaks the streak detector's own check, firing every other tick).
// ============================================================================

function getPulseSilenceFile(workspaceRootPath: string, pulseId: string): string {
  return join(getPulseDir(workspaceRootPath, pulseId), 'silence.json');
}

function writeFileAtomic(finalPath: string, data: string): void {
  mkdirSync(dirname(finalPath), { recursive: true });
  const tmp = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data, 'utf-8');
    renameSync(tmp, finalPath);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

export function readPulseSilence(workspaceRootPath: string, pulseId: string): PulseSilenceState {
  assertValidPulseId(pulseId);
  const file = getPulseSilenceFile(workspaceRootPath, pulseId);
  if (!existsSync(file)) {
    return { pulseId, silencedUntilByGoal: {}, updatedAt: new Date(0).toISOString() };
  }
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PulseSilenceState>;
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    const map = (parsed.silencedUntilByGoal ?? {}) as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'string') cleaned[k] = v;
    }
    return {
      pulseId,
      silencedUntilByGoal: cleaned,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { pulseId, silencedUntilByGoal: {}, updatedAt: new Date(0).toISOString() };
  }
}

function writePulseSilence(workspaceRootPath: string, state: PulseSilenceState): void {
  assertValidPulseId(state.pulseId);
  writeFileAtomic(
    getPulseSilenceFile(workspaceRootPath, state.pulseId),
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

/**
 * Returns the silencedUntil ISO for a goal in this pulse, or null if the
 * goal is not currently silenced. Auto-prunes stale entries on read.
 */
export function getSilencedUntil(
  workspaceRootPath: string,
  pulseId: string,
  goalSlug: string | undefined,
  now: Date = new Date(),
): string | null {
  const state = readPulseSilence(workspaceRootPath, pulseId);
  const key = goalSlug ?? '';
  const until = state.silencedUntilByGoal[key];
  if (!until) return null;
  if (new Date(until).getTime() <= now.getTime()) {
    // Stale — prune.
    const next = { ...state.silencedUntilByGoal };
    delete next[key];
    writePulseSilence(workspaceRootPath, { ...state, silencedUntilByGoal: next });
    return null;
  }
  return until;
}

/** Mark a goal as silenced for `PULSE_SILENCE_DURATION_MS` from `now`. */
export function silenceGoal(
  workspaceRootPath: string,
  pulseId: string,
  goalSlug: string | undefined,
  now: Date = new Date(),
): string {
  const state = readPulseSilence(workspaceRootPath, pulseId);
  const key = goalSlug ?? '';
  const until = new Date(now.getTime() + PULSE_SILENCE_DURATION_MS).toISOString();
  state.silencedUntilByGoal[key] = until;
  writePulseSilence(workspaceRootPath, state);
  return until;
}

/**
 * Determine whether the most-recent ticks form a notify_user streak for the
 * given goalSlug. Looks at up to `PULSE_ANTI_SPAM_THRESHOLD` ticks; counts
 * only `notify_user` decisions and ignores intervening `do_nothing` entries
 * marked as silenced (they don't break the streak — that was the bug).
 *
 * Input is expected newest-first (matches readPulseTicks default order).
 */
export function detectNotifyStreakGoal(
  recent: PulseTickEntry[],
): string | undefined {
  let goalSlug: string | undefined;
  let count = 0;
  for (const t of recent) {
    const d = t.decision as PulseDecisionAction;
    if (d.action === 'do_nothing') {
      // Silencing/ack/system do_nothing entries should NOT break a streak
      // we'd otherwise legitimately silence. Skip them.
      if (d.reason && /silenced|anti-spam|cadence|skipped/i.test(d.reason)) continue;
      // A "real" do_nothing (the driver decided silence) breaks the streak.
      return undefined;
    }
    if (d.action !== 'notify_user') return undefined;
    const slug = d.goalSlug;
    if (count === 0) {
      goalSlug = slug;
    } else if (goalSlug !== slug) {
      return undefined;
    }
    count += 1;
    if (count >= PULSE_ANTI_SPAM_THRESHOLD) return goalSlug;
  }
  return undefined;
}
