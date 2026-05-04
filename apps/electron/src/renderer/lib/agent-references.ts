/**
 * Agent reference resolution
 *
 * An Agent declares slugs of skills and sources it expects to use. Those slugs
 * point to per-workspace artifacts that may or may not actually exist on the
 * current machine + workspace combination. This module crosschecks an agent's
 * declared references against the live skill / source atoms and reports back:
 *
 *   - which references resolve cleanly
 *   - which slugs are missing (skill/source removed, never installed, typo)
 *
 * Used by:
 *   - AgentInfoPage to render "missing" badges so users see issues before
 *     clicking Run
 *   - openAgentSessionComposer to drop missing slugs from the new session
 *     config (the session still spawns, but with a transparent toast warning
 *     listing what got dropped)
 */

import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { isSystemGlobalSkillSlug } from '@craft-agent/shared/skills/system'
import type { LoadedSkill, LoadedSource } from '../../shared/types'
import type { AgentDefinitionDTO } from '../../shared/types'

export interface AgentReferenceResolution {
  /** Slugs that match an existing skill or source — safe to pass through. */
  resolvedSkills: string[]
  resolvedSources: string[]
  /** Slugs the agent declares but that don't exist in this workspace. */
  missingSkills: string[]
  missingSources: string[]
}

export function resolveAgentReferences(
  agent: AgentDefinitionDTO,
  skills: LoadedSkill[],
  sources: LoadedSource[],
): AgentReferenceResolution {
  const skillSlugs = new Set(skills.map((s) => s.slug))
  // LoadedSource carries the slug on its nested config, not at the top level.
  const sourceSlugs = new Set(sources.map((s) => s.config.slug))

  const declaredSkills = agent.metadata.skills ?? []
  const declaredSources = agent.metadata.sources ?? []
  const canUseSystemSkills = agent.slug === CONCIERGE_SLUG || agent.slug === ORCHESTRATOR_SLUG

  const resolvedSkills: string[] = []
  const missingSkills: string[] = []
  for (const slug of declaredSkills) {
    if (skillSlugs.has(slug)) resolvedSkills.push(slug)
    else if (canUseSystemSkills && isSystemGlobalSkillSlug(slug)) resolvedSkills.push(slug)
    else missingSkills.push(slug)
  }

  const resolvedSources: string[] = []
  const missingSources: string[] = []
  for (const slug of declaredSources) {
    if (sourceSlugs.has(slug)) resolvedSources.push(slug)
    else missingSources.push(slug)
  }

  return {
    resolvedSkills,
    resolvedSources,
    missingSkills,
    missingSources,
  }
}

/** Convenience flag: any references unresolvable on the current machine? */
export function hasMissingReferences(resolution: AgentReferenceResolution): boolean {
  return resolution.missingSkills.length > 0 || resolution.missingSources.length > 0
}

/** Build a one-line human summary of missing references for toast / banner copy. */
export function describeMissingReferences(resolution: AgentReferenceResolution): string | null {
  const parts: string[] = []
  if (resolution.missingSkills.length > 0) {
    const list = resolution.missingSkills.map((s) => `@${s}`).join(', ')
    parts.push(`missing skill${resolution.missingSkills.length === 1 ? '' : 's'}: ${list}`)
  }
  if (resolution.missingSources.length > 0) {
    const list = resolution.missingSources.map((s) => `@${s}`).join(', ')
    parts.push(`missing source${resolution.missingSources.length === 1 ? '' : 's'}: ${list}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
