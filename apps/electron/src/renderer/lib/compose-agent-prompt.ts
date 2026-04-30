/**
 * Compose an agent's runtime system prompt from its persona body + workspace
 * context docs (filtered by routing) + a generated footer enumerating bundled
 * skills and sources.
 *
 * Why this exists: the agent's saved AGENT.md is just the persona text. At
 * run time we want the LLM to also see "here's the workspace's voice/goals"
 * and "here's your menu — prefer these first." Hand-maintaining all of that
 * in every prompt is brittle (skills get renamed, docs change, users
 * forget). Instead, we regenerate it fresh every Run from the live
 * workspace state.
 *
 * Layout:
 *   <persona body>
 *   ---
 *   <workspace context section>      (only if any docs apply)
 *   ---
 *   <skills/tools bundle footer>     (only if any bundles resolve)
 *
 * Pure function — no I/O, no atoms. Easy to test.
 */

import type { AgentDefinitionDTO, ContextDocDTO, LoadedSkill, LoadedSource } from '../../shared/types'

const SECTION_DELIMITER = '\n\n---\n\n'

const SKILLS_HEADER = 'You have these skills bundled with you (always available — reach for them when relevant):'
const SOURCES_HEADER = 'You have these tools bundled with you (MCP servers, APIs, and local connectors):'
const PLANNING_NUDGE = 'When planning, check your bundled skills and tools before working from scratch.'

const CONTEXT_HEADER = 'Workspace context — read this before starting work:'

/**
 * Compose the final system prompt for a session spawned from this agent.
 *
 * Slugs declared by the agent but not present in `skills` / `sources` are
 * silently dropped. Context docs are passed in already filtered by routing
 * (the caller is responsible for honoring the Concierge override and
 * disabled-doc rules — see `loadActiveContextDocsForAgent` in the shared
 * workspace-context storage module).
 */
export function composeAgentSystemPrompt(
  agent: AgentDefinitionDTO,
  skills: LoadedSkill[],
  sources: LoadedSource[],
  contextDocs: ContextDocDTO[] = [],
): string {
  const body = (agent.systemPrompt ?? '').trimEnd()
  const contextSection = buildWorkspaceContextSection(contextDocs)
  const footer = buildAgentBundleFooter(agent, skills, sources)

  const parts: string[] = [body]
  if (contextSection) parts.push(contextSection)
  if (footer) parts.push(footer)
  return parts.join(SECTION_DELIMITER)
}

/**
 * Build just the bundle footer (no body, no delimiter). Returns an empty
 * string when there's nothing to enumerate. Exposed for tests + future
 * surfaces (e.g. an "inspect runtime prompt" action on AgentInfoPage).
 */
export function buildAgentBundleFooter(
  agent: AgentDefinitionDTO,
  skills: LoadedSkill[],
  sources: LoadedSource[],
): string {
  const skillBullets = collectSkillBullets(agent.metadata.skills ?? [], skills)
  const sourceBullets = collectSourceBullets(agent.metadata.sources ?? [], sources)
  if (skillBullets.length === 0 && sourceBullets.length === 0) return ''

  const sections: string[] = []
  if (skillBullets.length > 0) {
    sections.push(`${SKILLS_HEADER}\n${skillBullets.join('\n')}`)
  }
  if (sourceBullets.length > 0) {
    sections.push(`${SOURCES_HEADER}\n${sourceBullets.join('\n')}`)
  }
  sections.push(PLANNING_NUDGE)
  return sections.join('\n\n')
}

/**
 * Render the workspace-context section. Each doc becomes a "## Name" block
 * followed by its body. Returns an empty string when the list is empty so
 * the caller can decide whether to include the delimiter.
 *
 * Routing has already been resolved upstream — this helper just renders.
 */
export function buildWorkspaceContextSection(docs: ContextDocDTO[]): string {
  const usable = docs.filter((d) => d.metadata.enabled !== false && d.body.trim().length > 0)
  if (usable.length === 0) return ''
  const blocks = usable.map((doc) => {
    const heading = doc.metadata.name.trim() || doc.slug
    return `## ${heading}\n\n${doc.body.trim()}`
  })
  return `${CONTEXT_HEADER}\n\n${blocks.join('\n\n')}`
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function collectSkillBullets(declaredSlugs: string[], skills: LoadedSkill[]): string[] {
  if (declaredSlugs.length === 0) return []
  const bySlug = new Map(skills.map((s) => [s.slug, s]))
  const out: string[] = []
  for (const slug of declaredSlugs) {
    const skill = bySlug.get(slug)
    if (!skill) continue
    out.push(formatBullet(slug, skill.metadata.name, skill.metadata.description))
  }
  return out
}

function collectSourceBullets(declaredSlugs: string[], sources: LoadedSource[]): string[] {
  if (declaredSlugs.length === 0) return []
  const bySlug = new Map(sources.map((s) => [s.config.slug, s]))
  const out: string[] = []
  for (const slug of declaredSlugs) {
    const source = bySlug.get(slug)
    if (!source) continue
    const description = source.config.tagline?.trim() ?? ''
    out.push(formatBullet(slug, source.config.name, description))
  }
  return out
}

/**
 * Render one menu line. Slug appears prefixed with @ for parity with the rest
 * of the app's mention syntax. The display name follows for human-readability,
 * and the description is appended after an em-dash when present.
 */
function formatBullet(slug: string, displayName: string, description: string | undefined): string {
  const head = `  • @${slug}`
  const name = displayName?.trim()
  const desc = description?.trim()
  if (name && desc) return `${head} (${name}) — ${desc}`
  if (name) return `${head} — ${name}`
  if (desc) return `${head} — ${desc}`
  return head
}
