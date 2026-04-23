/**
 * Cursor Model processing and mapping.
 *
 * Cursor exposes many variants of each model that encode an effort level
 * (low/medium/high/xhigh/max/none) and optional -fast/-thinking suffixes
 * in the model ID. This file deduplicates them so a single logical model
 * can drive Craft's reasoning-effort/thinking-level control.
 *
 * Adapted from the pi-cursor-provider reference; stripped of pi-specific
 * types and reshaped to emit Craft `ModelDefinition`-friendly entries.
 */

import type { CursorModel } from './proxy.ts';

// ── Cost estimation ──

interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MODEL_COST_TABLE: Record<string, ModelCost> = {
  'claude-4-sonnet':   { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-4.5-haiku':  { input: 1, output: 5,  cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-4.5-opus':   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-4.5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-4.6-opus':   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-4.6-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'composer-1':        { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'composer-1.5':      { input: 3.5, output: 17.5, cacheRead: 0.35, cacheWrite: 0 },
  'composer-2':        { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  'gemini-2.5-flash':  { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  'gemini-3-flash':    { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
  'gemini-3-pro':      { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  'gemini-3.1-pro':    { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  'gpt-5':             { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-mini':        { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  'gpt-5.2':           { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2-codex':     { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.3-codex':     { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.4':           { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-5.4-mini':      { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  'grok-4.20':         { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
  'kimi-k2.5':         { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
};

const MODEL_COST_PATTERNS: Array<{ match: (id: string) => boolean; cost: ModelCost }> = [
  { match: (id) => /claude.*opus.*fast/i.test(id),   cost: { input: 30, output: 150, cacheRead: 3, cacheWrite: 37.5 } },
  { match: (id) => /claude.*opus/i.test(id),         cost: MODEL_COST_TABLE['claude-4.6-opus']! },
  { match: (id) => /claude.*haiku/i.test(id),        cost: MODEL_COST_TABLE['claude-4.5-haiku']! },
  { match: (id) => /claude.*sonnet/i.test(id),       cost: MODEL_COST_TABLE['claude-4.6-sonnet']! },
  { match: (id) => /composer/i.test(id),             cost: MODEL_COST_TABLE['composer-1']! },
  { match: (id) => /gpt-5\.4.*mini/i.test(id),       cost: MODEL_COST_TABLE['gpt-5.4-mini']! },
  { match: (id) => /gpt-5\.4/i.test(id),             cost: MODEL_COST_TABLE['gpt-5.4']! },
  { match: (id) => /gpt-5\.3/i.test(id),             cost: MODEL_COST_TABLE['gpt-5.3-codex']! },
  { match: (id) => /gpt-5\.2/i.test(id),             cost: MODEL_COST_TABLE['gpt-5.2']! },
  { match: (id) => /gpt-5.*mini/i.test(id),          cost: MODEL_COST_TABLE['gpt-5-mini']! },
  { match: (id) => /gpt-5/i.test(id),                cost: MODEL_COST_TABLE['gpt-5']! },
  { match: (id) => /gemini.*3\.1/i.test(id),         cost: MODEL_COST_TABLE['gemini-3.1-pro']! },
  { match: (id) => /gemini.*flash/i.test(id),        cost: MODEL_COST_TABLE['gemini-2.5-flash']! },
  { match: (id) => /gemini/i.test(id),               cost: MODEL_COST_TABLE['gemini-3-pro']! },
  { match: (id) => /grok/i.test(id),                 cost: MODEL_COST_TABLE['grok-4.20']! },
  { match: (id) => /kimi/i.test(id),                 cost: MODEL_COST_TABLE['kimi-k2.5']! },
];

const DEFAULT_COST: ModelCost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 };

export function estimateModelCost(modelId: string): ModelCost {
  const normalized = modelId.toLowerCase();
  const exact = MODEL_COST_TABLE[normalized];
  if (exact) return exact;
  const stripped = normalized.replace(/-(high|medium|low|preview|thinking|spark-preview|fast)$/g, '');
  const strippedMatch = MODEL_COST_TABLE[stripped];
  if (strippedMatch) return strippedMatch;
  return MODEL_COST_PATTERNS.find((p) => p.match(normalized))?.cost ?? DEFAULT_COST;
}

// ── Effort-level dedup ──

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'none']);

interface ParsedModelId {
  base: string;
  effort: string;
  fast: boolean;
  thinking: boolean;
}

export function parseModelId(id: string): ParsedModelId {
  let remaining = id;
  let fast = false;
  let thinking = false;

  if (remaining.endsWith('-fast')) {
    fast = true;
    remaining = remaining.slice(0, -5);
  }
  if (remaining.endsWith('-thinking')) {
    thinking = true;
    remaining = remaining.slice(0, -9);
  }

  const lastDash = remaining.lastIndexOf('-');
  if (lastDash >= 0) {
    const suffix = remaining.slice(lastDash + 1);
    if (EFFORT_LEVELS.has(suffix)) {
      return { base: remaining.slice(0, lastDash), effort: suffix, fast, thinking };
    }
  }

  return { base: remaining, effort: '', fast, thinking };
}

export function supportsReasoningModelId(id: string): boolean {
  const { base, effort, thinking } = parseModelId(id);
  if (effort || thinking) return true;
  if (base === 'default') return true;
  return /^(claude|composer|gemini|gpt|grok|kimi)(-|$)/i.test(base);
}

export interface ProcessedCursorModel extends CursorModel {
  supportsEffort: boolean;
  effortMap?: Record<string, string>;
}

/**
 * Ordered effort levels from lowest to highest.
 * '' = default (no effort suffix in model ID).
 */
const EFFORT_ORDER = ['none', 'low', '', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Build a reasoning-effort map from the set of available effort suffixes.
 * For each pi/claude effort level (minimal/low/medium/high/xhigh), picks
 * the closest available cursor effort, falling back to the lowest available.
 */
export function buildEffortMap(efforts: Set<string>): Record<string, string> {
  const sorted = EFFORT_ORDER.filter((e) => efforts.has(e));
  if (sorted.length === 0) return {};
  const lowest = sorted[0]!;

  const pick = (...targets: string[]) => {
    for (const t of targets) if (efforts.has(t)) return t;
    return lowest;
  };

  return {
    minimal: pick('none', 'low', ''),
    low:     pick('low', 'none', ''),
    medium:  pick('medium', '', 'low'),
    high:    pick('high', 'medium', ''),
    xhigh:   pick('max', 'xhigh', 'high'),
  };
}

/** Dedup raw models: collapse effort variants into one entry with supportsReasoningEffort. */
export function processModels(raw: CursorModel[]): ProcessedCursorModel[] {
  const groups = new Map<string, {
    base: string; fast: boolean; thinking: boolean;
    efforts: Map<string, CursorModel>;
  }>();

  for (const model of raw) {
    const p = parseModelId(model.id);
    const key = `${p.base}|${p.fast}|${p.thinking}`;
    let g = groups.get(key);
    if (!g) {
      g = { base: p.base, fast: p.fast, thinking: p.thinking, efforts: new Map() };
      groups.set(key, g);
    }
    g.efforts.set(p.effort, model);
  }

  const result: ProcessedCursorModel[] = [];

  for (const g of groups.values()) {
    const hasOnlyEffortVariants = g.efforts.size === 1 && !g.efforts.has('');
    if (g.efforts.size >= 2 || hasOnlyEffortVariants) {
      const rep = g.efforts.get('medium') ?? g.efforts.get('') ?? [...g.efforts.values()][0]!;

      let id = g.base;
      if (g.thinking) id += '-thinking';
      if (g.fast) id += '-fast';

      const effortMap = buildEffortMap(new Set(g.efforts.keys()));

      result.push({ ...rep, id, supportsEffort: true, effortMap });
    } else {
      for (const model of g.efforts.values()) {
        result.push({ ...model, supportsEffort: false });
      }
    }
  }

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

// ── Craft ModelDefinition conversion ──

/**
 * Shape compatible with Craft's `ModelDefinition` without importing from
 * the shared package (keeps this package dependency-free).
 */
export interface CraftCursorModelDefinition {
  id: string;
  name: string;
  shortName: string;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportsReasoningEffort: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: ModelCost;
  reasoningEffortMap?: Record<string, string>;
}

export function buildModelDefinitions(
  models: ProcessedCursorModel[],
): CraftCursorModelDefinition[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    shortName: m.name,
    supportsImages: false,
    supportsReasoning: supportsReasoningModelId(m.id),
    supportsReasoningEffort: m.supportsEffort,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    cost: estimateModelCost(m.id),
    ...(m.supportsEffort && m.effortMap ? { reasoningEffortMap: m.effortMap } : {}),
  }));
}
