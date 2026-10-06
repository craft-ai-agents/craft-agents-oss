/**
 * Decision layer — usage summary over `decisions.jsonl`.
 *
 * Joins decision lines with their outcome and follow-up lines (`decisionId` → `id`)
 * and reports, per feature: calls, failures, latency, tokens, how often an answer
 * came back with an outcome and how often it changed behaviour (the number
 * that says whether a toggle earns its keep), the action counts and the
 * follow-up results (e.g. whether a suggested source was then used).
 * Records written before outcomes existed have no `id`; they count as calls
 * without an outcome.
 */

import { readFile } from 'node:fs/promises';
import type { DecisionLayerFeature } from './settings.ts';
import {
  defaultDecisionsLogPath,
  isDecisionFollowUpRecord,
  isDecisionOutcomeRecord,
  previousDecisionsLogPath,
  type DecisionFollowUpRecord,
  type DecisionLogLine,
  type DecisionOutcomeRecord,
  type DecisionRecord,
} from './records.ts';

export interface DecisionUsageFilter {
  sessionId?: string;
  /** Only lines at or after this time. */
  since?: Date;
  feature?: string;
  /** Only these providers (e.g. to leave out test stubs written before test isolation). */
  providers?: string[];
}

export interface FeatureUsage {
  feature: string;
  calls: number;
  failures: number;
  /** Failure kind → count. */
  failureKinds: Record<string, number>;
  /** Calls made after the provider had been idle (`coldStart`), and how many of them failed. */
  coldCalls: number;
  coldFailures: number;
  /** Calls whose outcome was recorded. */
  withOutcome: number;
  /** Outcomes with `changed: true`. */
  changed: number;
  /** Action → count. */
  actions: Record<string, number>;
  /** Follow-up result → count (a decision can have several). */
  followUps: Record<string, number>;
  /** Outcome action → follow-up result → count: e.g. how often a lowered thinking level was corrected. */
  followUpsByAction: Record<string, Record<string, number>>;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface DecisionUsageSummary {
  total: number;
  failures: number;
  providers: Record<string, number>;
  features: FeatureUsage[];
}

/** Parse a decisions.jsonl body; malformed lines are skipped. */
export function parseDecisionLog(text: string): DecisionLogLine[] {
  const lines: DecisionLogLine[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw) as DecisionLogLine);
    } catch {
      // A torn last line from a crash; ignore it.
    }
  }
  return lines;
}

/** Read and parse a log; `[]` when it does not exist. */
export async function readDecisionLog(path: string): Promise<DecisionLogLine[]> {
  try {
    return parseDecisionLog(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarizeDecisionUsage(lines: readonly DecisionLogLine[], filter: DecisionUsageFilter = {}): DecisionUsageSummary {
  const since = filter.since?.getTime();
  const keep = (line: { t: string; sessionId?: string; feature: string }) =>
    (!filter.sessionId || line.sessionId === filter.sessionId)
    && (!filter.feature || line.feature === filter.feature)
    && (since === undefined || Date.parse(line.t) >= since);

  const outcomes = new Map<string, DecisionOutcomeRecord>();
  const followUps = new Map<string, DecisionFollowUpRecord[]>();
  const decisions: DecisionRecord[] = [];
  for (const line of lines) {
    if (isDecisionOutcomeRecord(line)) outcomes.set(line.decisionId, line);
    else if (isDecisionFollowUpRecord(line)) followUps.set(line.decisionId, [...(followUps.get(line.decisionId) ?? []), line]);
    else if (keep(line) && (!filter.providers || filter.providers.includes(line.provider))) decisions.push(line);
  }

  const byFeature = new Map<string, { usage: FeatureUsage; latencies: number[]; sessions: Set<string> }>();
  const providers: Record<string, number> = {};
  let failures = 0;
  for (const record of decisions) {
    providers[record.provider] = (providers[record.provider] ?? 0) + 1;
    let entry = byFeature.get(record.feature);
    if (!entry) {
      entry = {
        usage: { feature: record.feature, calls: 0, failures: 0, failureKinds: {}, coldCalls: 0, coldFailures: 0, withOutcome: 0, changed: 0, actions: {}, followUps: {}, followUpsByAction: {}, inputTokens: 0, outputTokens: 0, sessions: 0 },
        latencies: [],
        sessions: new Set(),
      };
      byFeature.set(record.feature, entry);
    }
    const { usage } = entry;
    usage.calls++;
    if (record.sessionId) entry.sessions.add(record.sessionId);
    if (typeof record.latencyMs === 'number') entry.latencies.push(record.latencyMs);
    usage.inputTokens += record.usage?.inputTokens ?? 0;
    usage.outputTokens += record.usage?.outputTokens ?? 0;
    if (record.coldStart) usage.coldCalls++;
    if (!record.ok) {
      usage.failures++;
      if (record.coldStart) usage.coldFailures++;
      failures++;
      const kind = record.error?.kind ?? 'unknown';
      usage.failureKinds[kind] = (usage.failureKinds[kind] ?? 0) + 1;
      continue;
    }
    const outcome = record.id ? outcomes.get(record.id) : undefined;
    for (const followUp of (record.id ? followUps.get(record.id) : undefined) ?? []) {
      usage.followUps[followUp.result] = (usage.followUps[followUp.result] ?? 0) + 1;
      const byAction = (usage.followUpsByAction[outcome?.action ?? '-'] ??= {});
      byAction[followUp.result] = (byAction[followUp.result] ?? 0) + 1;
    }
    if (!outcome) continue;
    usage.withOutcome++;
    if (outcome.changed) usage.changed++;
    usage.actions[outcome.action] = (usage.actions[outcome.action] ?? 0) + 1;
  }

  const features = [...byFeature.values()]
    .map(({ usage, latencies, sessions }) => {
      latencies.sort((a, b) => a - b);
      return { ...usage, sessions: sessions.size, latencyP50Ms: percentile(latencies, 50), latencyP95Ms: percentile(latencies, 95) };
    })
    .sort((a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature));

  return { total: decisions.length, failures, providers, features };
}

/** The tag each Settings toggle's decision point writes as `feature`. */
export const DECISION_RECORD_TAGS: Record<DecisionLayerFeature, string> = {
  decideTool: 'decide_tool',
  taskVerdicts: 'task_verdict',
  semanticLabels: 'semantic_labels',
  turnOutcome: 'turn_outcome',
  guardedMode: 'guarded_mode',
  riskBadges: 'risk_badges',
  automationConditions: 'automation_condition',
  taskRepairs: 'task_repairs',
  smartTitles: 'smart_titles',
  adaptiveThinking: 'adaptive_thinking',
  midTurnMessages: 'mid_turn_messages',
  largeResults: 'large_results',
  suggestions: 'suggestions',
};

/** What Settings shows per toggle: checks, failures and how often an answer changed something. */
export type DecisionToggleUsage = Pick<FeatureUsage, 'calls' | 'failures' | 'changed' | 'withOutcome'>;

/** Per-toggle usage since `since`, over the current and the rotated log. Toggles without calls are left out. */
export async function readDecisionToggleUsage(since: Date, logPath: string = defaultDecisionsLogPath()): Promise<Partial<Record<DecisionLayerFeature, DecisionToggleUsage>>> {
  const lines = [...(await readDecisionLog(previousDecisionsLogPath(logPath))), ...(await readDecisionLog(logPath))];
  const byTag = new Map(summarizeDecisionUsage(lines, { since }).features.map(feature => [feature.feature, feature]));
  const usage: Partial<Record<DecisionLayerFeature, DecisionToggleUsage>> = {};
  for (const [toggle, tag] of Object.entries(DECISION_RECORD_TAGS) as [DecisionLayerFeature, string][]) {
    const feature = byTag.get(tag);
    if (feature) usage[toggle] = { calls: feature.calls, failures: feature.failures, changed: feature.changed, withOutcome: feature.withOutcome };
  }
  return usage;
}

/** Plain-text table for terminals. */
export function formatDecisionUsage(summary: DecisionUsageSummary): string {
  if (summary.total === 0) return 'No decision records match.';
  const providers = Object.entries(summary.providers).map(([name, count]) => `${name} ${count}`).join(', ');
  const rows = summary.features.map(f => [
    f.feature,
    String(f.calls),
    String(f.failures),
    f.coldCalls > 0 ? `${f.coldFailures}/${f.coldCalls}` : '-',
    f.withOutcome > 0 ? `${f.changed}/${f.withOutcome}` : '-',
    f.latencyP50Ms !== undefined ? `${f.latencyP50Ms}/${f.latencyP95Ms}` : '-',
    String(f.sessions),
    Object.entries(f.actions).sort((a, b) => b[1] - a[1]).map(([action, count]) => `${action}×${count}`).join(' ') || '-',
  ]);
  const header = ['feature', 'calls', 'failed', 'cold failed', 'changed', 'p50/p95 ms', 'sessions', 'actions'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('  ');
  const counts = (byResult: Record<string, number>) => Object.entries(byResult).sort((a, b) => b[1] - a[1]).map(([result, count]) => `${result}×${count}`).join(' ');
  const followUps = summary.features
    .filter(f => Object.keys(f.followUps).length > 0)
    .flatMap(f => [
      `${f.feature}: ${counts(f.followUps)}`,
      ...Object.entries(f.followUpsByAction).sort(([a], [b]) => a.localeCompare(b)).map(([action, byResult]) => `  ${action} → ${counts(byResult)}`),
    ]);
  return [
    `${summary.total} decisions (${summary.failures} failed) — ${providers}`, '', line(header), ...rows.map(line),
    ...(followUps.length > 0 ? ['', 'follow-ups', ...followUps] : []),
  ].join('\n');
}
