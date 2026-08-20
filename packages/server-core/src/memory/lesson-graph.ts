/**
 * lesson-graph.ts — cross-store lesson helpers (self-learning v2, spec L2/L3).
 *
 * L2: conflict detection on add. `buildConflictPrompt` formats the one-shot
 * LLM check (new rule vs existing rules); `parseConflicts` turns the LLM
 * reply into validated verdicts — strict JSON with fence stripping, one parse
 * attempt, verdicts referencing rules the model was never shown are dropped
 * (hallucination guard). Parsing never throws: garbage in → [] out.
 *
 * L3: global promotion. `scanPromotionCandidates` groups identical normalized
 * rules (same key as LessonStore dedup — lowercase + trim) present as
 * workspace-scope lessons in ≥2 DISTINCT workspace stores.
 * `promoteLessonToGlobal` copies the rule into the global LessonStore marked
 * `promoted{fromScope:'workspace', workspaceIds, ts}`; when the rule already
 * exists globally it is patched in place (LessonStore.update → 'promote'
 * audit action) instead of duplicated.
 *
 * Both helpers are intentionally free of config-storage imports: callers pass
 * the workspace list (getWorkspaces() result) so the module stays testable
 * with plain `{id, rootPath}` refs.
 */
import type { Lesson, LessonCategory } from '@craft-agent/shared/memory/types'
import { LessonStore, lessonKey } from './LessonStore'
import { MemoryFileStore } from './MemoryFileStore'

/** Minimal workspace identity the graph helpers need (getWorkspaces() satisfies it). */
export interface WorkspaceRef {
  id: string
  rootPath: string
}

/** One validated conflict verdict returned by ADD_LESSON (spec L2). */
export interface LessonConflictVerdict {
  /** Exact text of the existing rule the new lesson collides with. */
  existingRule: string
  relation: 'contradicts' | 'subsumes'
  rationale?: string
}

/** One promotion candidate (spec L3): same normalized rule in ≥2 workspace stores. */
export interface PromotionCandidate {
  /** Rule text as first seen across workspace stores. */
  rule: string
  category: LessonCategory
  /** Distinct workspace ids carrying the rule, in scan order. */
  workspaceIds: string[]
}

export interface PromoteLessonResult {
  /** The global lesson after promotion (created or patched). */
  lesson: Lesson
  /** Workspace ids the rule was promoted from. */
  workspaceIds: string[]
  /** true when the rule already existed globally and was only re-marked. */
  alreadyGlobal: boolean
}

// ---------------------------------------------------------------------------
// L2 — conflict detection on add
// ---------------------------------------------------------------------------

/**
 * Prompt for the one-shot mini completion that checks a freshly added rule
 * against the existing rules. Demands strict JSON so `parseConflicts` can be
 * deterministic; the verdict contract is the one the memory UI renders.
 */
export function buildConflictPrompt(newRule: string, existingRules: string[]): string {
  return [
    'You are checking whether a NEW durable agent rule conflicts with EXISTING durable rules the agent already follows.',
    '',
    'NEW rule:',
    newRule,
    '',
    'EXISTING rules:',
    ...existingRules.map(r => `- ${r}`),
    '',
    'Reply with STRICT JSON only — no markdown fences, no prose:',
    '{"conflicts":[{"existingRule":"<exact existing rule text>","relation":"contradicts"|"subsumes"}],"rationale":"<one short sentence>"}',
    '',
    '- relation "contradicts": the two rules cannot both be followed (opposite instructions).',
    '- relation "subsumes": one rule fully covers the other (duplicate or generalization).',
    '- Report only real collisions. Independent or merely related rules are NOT conflicts: {"conflicts":[]}',
  ].join('\n')
}

/**
 * Parse the LLM conflict reply. Resilient: strips ```json fences, extracts the
 * outermost JSON object, validates every verdict (relation enum, non-empty
 * rule text, rule must be one of `existingRules` — hallucinations dropped).
 * Returns [] on any malformed input; never throws. One attempt, no retry.
 */
export function parseConflicts(text: string, existingRules: string[]): LessonConflictVerdict[] {
  const knownByKey = new Map(existingRules.map(r => [lessonKey(r), r]))
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && fence[1]) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const body = parsed as { conflicts?: unknown; rationale?: unknown }
  if (!Array.isArray(body.conflicts)) return []
  const rationale = typeof body.rationale === 'string' && body.rationale.trim() ? body.rationale.trim() : undefined
  const verdicts: LessonConflictVerdict[] = []
  for (const c of body.conflicts) {
    if (!c || typeof c !== 'object') continue
    const entry = c as { existingRule?: unknown; relation?: unknown }
    if (typeof entry.existingRule !== 'string' || !entry.existingRule.trim()) continue
    if (entry.relation !== 'contradicts' && entry.relation !== 'subsumes') continue
    const canonical = knownByKey.get(lessonKey(entry.existingRule))
    if (!canonical) continue
    verdicts.push({ existingRule: canonical, relation: entry.relation, ...(rationale ? { rationale } : {}) })
  }
  return verdicts
}

// ---------------------------------------------------------------------------
// L3 — global promotion
// ---------------------------------------------------------------------------

/**
 * Scan every workspace store and return rules (keyed like LessonStore dedup)
 * that appear as workspace-scope lessons in ≥2 DISTINCT workspaces.
 * Unreadable stores are skipped, never thrown. Sorted by fan-out desc.
 */
export function scanPromotionCandidates(workspaces: WorkspaceRef[]): PromotionCandidate[] {
  const byKey = new Map<string, PromotionCandidate>()
  // Alias ids pointing at one root are ONE store — a rule must live in ≥2
  // distinct workspace stores, not merely under ≥2 ids.
  const seenStores = new Set<string>()
  for (const ws of workspaces) {
    if (seenStores.has(ws.rootPath)) continue
    seenStores.add(ws.rootPath)
    let lessons: Lesson[]
    try {
      lessons = new LessonStore(new MemoryFileStore('workspace', ws.rootPath).lessonsPath, 'workspace').list()
    } catch {
      continue
    }
    // A rule listed twice inside one store still counts as ONE workspace.
    const seenKey = new Set<string>()
    for (const lesson of lessons) {
      const key = lessonKey(lesson.rule)
      if (!key || seenKey.has(key)) continue
      seenKey.add(key)
      const entry = byKey.get(key)
      if (entry) {
        entry.workspaceIds.push(ws.id)
      } else {
        byKey.set(key, { rule: lesson.rule, category: lesson.category, workspaceIds: [ws.id] })
      }
    }
  }
  return [...byKey.values()]
    .filter(c => c.workspaceIds.length >= 2)
    .sort((a, b) => b.workspaceIds.length - a.workspaceIds.length)
}

/**
 * Promote a workspace rule to the global store (spec L3). Collects every
 * workspace store carrying the rule (those form the `promoted.workspaceIds`
 * provenance), then writes the global lesson: `store.add` with trigger
 * 'explicit' + `promoted` marker, or — when the rule already exists globally
 * — an in-place patch of the `promoted` marker (dedup, audited 'promote').
 * Returns null when no workspace store carries the rule.
 */
export function promoteLessonToGlobal(
  workspaces: WorkspaceRef[],
  rule: string,
  ts: string = new Date().toISOString(),
): PromoteLessonResult | null {
  const key = lessonKey(rule)
  if (!key) return null
  const carriers: { workspaceId: string; lesson: Lesson }[] = []
  for (const ws of workspaces) {
    let lessons: Lesson[]
    try {
      lessons = new LessonStore(new MemoryFileStore('workspace', ws.rootPath).lessonsPath, 'workspace').list()
    } catch {
      continue
    }
    const found = lessons.find(l => lessonKey(l.rule) === key)
    if (found) carriers.push({ workspaceId: ws.id, lesson: found })
  }
  if (carriers.length === 0) return null

  const promoted = { fromScope: 'workspace' as const, workspaceIds: carriers.map(c => c.workspaceId), ts }
  const store = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
  const existing = store.list().find(l => lessonKey(l.rule) === key)
  if (existing) {
    const lesson = store.update(existing.rule, { promoted })
    return lesson ? { lesson, workspaceIds: promoted.workspaceIds, alreadyGlobal: true } : null
  }
  const template = carriers[0].lesson
  const lesson = store.add({
    ts,
    rule: template.rule,
    category: template.category,
    scope: 'global',
    ...(template.negative ? { negative: true } : {}),
    promoted,
    source: { trigger: 'explicit' },
  })
  return { lesson, workspaceIds: promoted.workspaceIds, alreadyGlobal: false }
}
