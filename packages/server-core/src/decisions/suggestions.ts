/**
 * Skill and source suggestions via the decision model (feature toggle `suggestions`).
 *
 * The agent does not see the workspace's skills unless the user mentions one,
 * and sees inactive sources only by slug. Before a turn, the model picks at
 * most one skill or usable inactive source that the message plainly needs, and
 * the agent gets a short hint for that turn. Nothing is read, enabled or
 * activated on the model's behalf: the agent decides under the usual
 * permissions. No confident pick means no hint.
 *
 * After the request, a follow-up line says whether the agent used the pick anyway
 * (`suggestionFollowUp`): shown and used, shown and ignored, held back but used (a miss the
 * threshold caused), or used something the model did not pick. That is the data for tuning
 * `SUGGESTION_MIN_CONFIDENCE`.
 */

import { join } from 'node:path'
import type { DecisionRequest, DecisionResult } from '@craft-agent/shared/decisions'
import type { LoadedSkill } from '@craft-agent/shared/skills'
import { extractTagline, isSourceUsable, type LoadedSource } from '@craft-agent/shared/sources'
import { FOREGROUND_MAX_DEADLINE_MS, openDecisionPoint, recordDecisionFollowUp, recordDecisionOutcome, type DecisionPointDeps } from './decision-point'

/**
 * The pick must come with this much confidence. 0.8 held back the right source twice in a
 * harness test run (google-calendar at 0.77 and 0.78, each time the agent then needed it);
 * 0.75 still holds back the unverified 0.70 picks seen in real use.
 */
export const SUGGESTION_MIN_CONFIDENCE = 0.75
/** At most this many skills and sources are offered (usable inactive sources first). */
export const SUGGESTION_MAX_CANDIDATES = 60
/** Each candidate's description is cut to this many characters. */
export const SUGGESTION_MAX_DESCRIPTION_CHARS = 200
/** The user's message is cut to this many characters. */
export const SUGGESTION_MAX_MESSAGE_CHARS = 2_000

export interface SuggestionCandidate {
  kind: 'skill' | 'source'
  slug: string
  name: string
  description: string
  /** SKILL.md for a skill, the source folder for a source. */
  path: string
}

const NONE = 'none'
const optionKey = (candidate: SuggestionCandidate) => `${candidate.kind}:${candidate.slug}`
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

/**
 * Whether a message should be checked at all: not empty, not a slash command,
 * not hidden, no skill or source already chosen, not the automatic resend
 * after a source activation.
 */
export function wantsSuggestion(message: string, options?: { hidden?: boolean; skillSlugs?: readonly string[] } | null): boolean {
  const text = message.trim()
  // `options` may arrive as null, not undefined: the WS RPC JSON-encodes call args, so a trailing
  // `undefined` (e.g. Crafty's first-question `sendMessage(..., undefined)`) becomes null on the wire.
  // A default param only covers undefined, so guard with optional chaining, as the callers do.
  if (!text || text.startsWith('/') || options?.hidden || options?.skillSlugs?.length) return false
  if (/\[(?:skill|source):/.test(text)) return false
  // The server's own auto-retry is hidden (and skipped before this); the suffix check only
  // catches a legacy renderer's copy, which arrives as a normal message.
  return !/\n\n\[[\w.-]+ activated\]$/.test(text)
}

/** Usable sources that are not active in the session, then skills; capped. */
export function collectSuggestionCandidates(input: {
  skills: readonly LoadedSkill[]
  sources: readonly LoadedSource[]
  activeSourceSlugs: readonly string[]
}): SuggestionCandidate[] {
  const active = new Set(input.activeSourceSlugs)
  const sources = input.sources
    .filter(source => !active.has(source.config.slug) && isSourceUsable(source))
    .map((source): SuggestionCandidate => ({
      kind: 'source',
      slug: source.config.slug,
      name: source.config.name,
      description: source.config.tagline || extractTagline(source.guide) || source.config.provider,
      path: source.folderPath,
    }))
  const skills = input.skills.map((skill): SuggestionCandidate => ({
    kind: 'skill',
    slug: skill.slug,
    name: skill.metadata.name,
    description: skill.metadata.description,
    path: join(skill.path, 'SKILL.md'),
  }))
  return [...sources, ...skills].slice(0, SUGGESTION_MAX_CANDIDATES)
}

export function buildSuggestionRequest(message: string, candidates: readonly SuggestionCandidate[]): DecisionRequest {
  const criteria: Record<string, string> = {
    [NONE]: 'None of these is clearly needed: the message is general, or can be handled without them.',
  }
  for (const candidate of candidates) {
    const label = candidate.kind === 'skill' ? 'Skill' : 'Data source'
    criteria[optionKey(candidate)] = clip(`${label} "${candidate.name}": ${candidate.description}`, SUGGESTION_MAX_DESCRIPTION_CHARS)
  }
  return {
    state: { message: clip(message, SUGGESTION_MAX_MESSAGE_CHARS) },
    questions: {
      needed: {
        type: 'choice',
        // Saying what the assistant can already do keeps local-code questions from picking a code host.
        instructions: "The assistant can already read and edit local files, run commands and search the web. Which one of these does it plainly need for the user's message? Pick one only when the message is clearly about what it covers.",
        criteria,
      },
    },
  }
}

/** A suggestions answer, kept for the follow-up after the request (`suggestionFollowUp`). */
export interface SuggestionTrace {
  result: DecisionResult
  /** The model's pick, shown or held back; `null` when it picked none. */
  choice: SuggestionCandidate | null
  /** Whether the agent got the hint. */
  hinted: boolean
  candidates: readonly SuggestionCandidate[]
}

export interface SuggestionPick {
  /** The candidate to hint at; `null` without a confident pick. */
  hint: SuggestionCandidate | null
  /** `null` when the model gave no answer. */
  trace: SuggestionTrace | null
}

/** The candidate the model is confident the message needs, if any. Never throws. */
export async function pickSuggestion(
  message: string,
  candidates: readonly SuggestionCandidate[],
  deps: DecisionPointDeps & { sessionId?: string } = {},
): Promise<SuggestionPick> {
  const nothing: SuggestionPick = { hint: null, trace: null }
  if (!message.trim() || candidates.length === 0) return nothing
  // The turn start waits for this answer.
  const decide = await openDecisionPoint({ ...deps, feature: 'suggestions', record: 'suggestions', maxDeadlineMs: FOREGROUND_MAX_DEADLINE_MS })
  if (!decide) return nothing
  const result = await decide(buildSuggestionRequest(message, candidates), { candidates: candidates.length })
  if (!result) return nothing
  const answer = result.answers.needed
  const choice = answer?.type === 'choice' ? candidates.find(candidate => optionKey(candidate) === answer.choice) ?? null : null
  const none = (reason: string): SuggestionPick => {
    recordDecisionOutcome(result, { action: 'none', changed: false, detail: { reason } })
    return { hint: null, trace: { result, choice, hinted: false, candidates } }
  }
  if (!answer || answer.type !== 'choice') return none('no_answer')
  if (answer.choice === NONE) return none('nothing_needed')
  if (answer.confidence < SUGGESTION_MIN_CONFIDENCE) return none('low_confidence')
  if (!choice) return none('unknown_option')
  recordDecisionOutcome(result, { action: `hint:${optionKey(choice)}`, changed: true })
  return { hint: choice, trace: { result, choice, hinted: true, candidates } }
}

/** Session tools that act on one source, named by `sourceSlug`. */
const SOURCE_SESSION_TOOLS = new Set([
  'source_test',
  'source_oauth_trigger',
  'source_google_oauth_trigger',
  'source_microsoft_oauth_trigger',
  'source_slack_oauth_trigger',
  'source_credential_prompt',
])

/**
 * Option keys (`source:<slug>`, `skill:<slug>`) of the candidates a tool call or a source
 * activation uses: a source's own tools (`mcp__<slug>__…`), a session tool acting on it
 * (source_test, OAuth, credentials), its activation, a skill's SKILL.md read or cat, or the
 * Skill tool. Reading a source's guide only is not use.
 */
export function candidatesUsedBy(
  candidates: readonly SuggestionCandidate[],
  call: { toolName?: string; input?: Record<string, unknown>; activatedSource?: string },
): string[] {
  const tool = call.toolName ?? ''
  const bareTool = tool.replace(/^(mcp__session__|session__)/, '')
  const input = call.input ?? {}
  const text = [input.file_path, input.path, input.command, input.skill]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .replaceAll('\\', '/')
  const used: string[] = []
  for (const candidate of candidates) {
    const touched = candidate.kind === 'source'
      ? call.activatedSource === candidate.slug
        || (!!tool && (tool.startsWith(`mcp__${candidate.slug}__`) || tool.startsWith(`${candidate.slug}__`)))
        || (SOURCE_SESSION_TOOLS.has(bareTool) && input.sourceSlug === candidate.slug)
      : text.includes(`skills/${candidate.slug}/SKILL.md`)
        || (/^skill$/i.test(tool) && typeof input.skill === 'string' && (input.skill === candidate.slug || input.skill.endsWith(`:${candidate.slug}`)))
    if (touched) used.push(optionKey(candidate))
  }
  return used
}

/**
 * Record whether the request then used the pick: `hint_used`/`hint_unused`,
 * `held_back_used`/`held_back_unused` (a pick below the confidence threshold, so no hint),
 * or for no pick `none_used` (the agent used one of the candidates anyway) / `none_unused`.
 */
export function suggestionFollowUp(trace: SuggestionTrace, used: ReadonlySet<string>): void {
  const picked = trace.choice ? optionKey(trace.choice) : null
  const confidence = trace.result.answers.needed?.type === 'choice' ? trace.result.answers.needed.confidence : undefined
  if (picked) {
    const state = trace.hinted ? 'hint' : 'held_back'
    recordDecisionFollowUp(trace.result, { result: `${state}_${used.has(picked) ? 'used' : 'unused'}`, detail: { option: picked, confidence } })
    return
  }
  const other = trace.candidates.map(optionKey).find(key => used.has(key))
  recordDecisionFollowUp(trace.result, other ? { result: 'none_used', detail: { option: other } } : { result: 'none_unused' })
}

/** One-turn hint for the agent. Never uses mention syntax, so it cannot register a skill or source. */
export function formatSuggestionHint(candidate: SuggestionCandidate): string {
  const suggestion = candidate.kind === 'skill'
    ? `the skill "${candidate.name}" (slug: ${candidate.slug}). If it applies, read ${candidate.path} first and follow it.`
    : `the source "${candidate.name}" (slug: ${candidate.slug}), which is not active in this session. If the request needs it, read its guide.md in ${candidate.path} and activate it with source_test.`
  return `<system-reminder>A quick check by the decision model suggests this request may need ${suggestion} Ignore this if it does not fit.</system-reminder>`
}
