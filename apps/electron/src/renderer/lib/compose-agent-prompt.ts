/**
 * Compose an agent's runtime system prompt from its persona body + a
 * generated footer enumerating bundled skills and sources.
 *
 * Why this exists: the agent's saved AGENT.md is just the persona text. At
 * run time we want the LLM to also see "here's your menu — prefer these
 * first." Hand-maintaining that menu in every prompt is brittle (skills get
 * renamed, descriptions change, users forget). Instead, we regenerate it
 * fresh every Run from the live workspace state.
 *
 * Output is the original body (unchanged) followed by an optional footer
 * delimited by a horizontal rule. When neither skills nor sources are
 * bundled, the body is returned untouched.
 *
 * Pure function — no I/O, no atoms. Easy to test.
 */

import type { AgentDefinitionDTO, LoadedSkill, LoadedSource } from '../../shared/types'

const FOOTER_DELIMITER = '\n\n---\n\n'

const SKILLS_HEADER = 'You have these skills bundled with you (always available — reach for them when relevant):'
const SOURCES_HEADER = 'You have these tools bundled with you (MCP servers, APIs, and local connectors):'
const PLANNING_NUDGE = 'When planning, check your bundled skills and tools before working from scratch.'

/**
 * Compose the final system prompt for a session spawned from this agent.
 *
 * The footer is built from agent.metadata.skills + agent.metadata.sources
 * cross-referenced against the live workspace. Slugs declared by the agent
 * but not present in `skills` / `sources` are silently dropped (the user
 * already saw a "missing" warning on the detail page; we don't pollute the
 * model's context with absent menus).
 */
export function composeAgentSystemPrompt(
  agent: AgentDefinitionDTO,
  skills: LoadedSkill[],
  sources: LoadedSource[],
): string {
  const body = (agent.systemPrompt ?? '').trimEnd()
  const footer = buildAgentBundleFooter(agent, skills, sources)
  if (!footer) return body
  return `${body}${FOOTER_DELIMITER}${footer}`
}

/**
 * Build just the footer (no body, no delimiter). Returns an empty string
 * when there's nothing to enumerate. Exposed for tests + future surfaces
 * (e.g. an "inspect runtime prompt" action on AgentInfoPage).
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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function collectSkillBullets(declaredSlugs: string[], skills: LoadedSkill[]): string[] {
  if (declaredSlugs.length === 0) return []
  const bySlug = new Map(skills.map((s) => [s.slug, s]))
  const out: string[] = []
  for (const slug of declaredSlugs) {
    const skill = bySlug.get(slug)
    if (!skill) continue // missing → skip; the detail-page banner already surfaces this
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
    // Sources expose `tagline` as the short agent-context description, with
    // optional fallback to the guide's scope section. We don't reach into
    // guide.md here to keep the helper synchronous + cheap.
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
