/**
 * Omnibox resource providers (W3 minimal set).
 *
 * Pure factories — data is injected so tests can run without Electron/DOM.
 * Bootstrap wires live atoms + electronAPI.
 */

import type {
  ResourceItem,
  ResourceProvider,
  ResourceSearchContext,
} from '@craft-agent/core/platform'
import { scoreMatch, scoreMatchAny } from './omnibox-helpers'

export interface SessionMetaLike {
  id: string
  name?: string
  preview?: string
  hidden?: boolean
  isArchived?: boolean
  lastMessageAt?: number
}

export interface SkillLike {
  slug: string
  metadata: { name?: string; description?: string }
  shadowedByCraft?: boolean
}

export interface SourceLike {
  config: { name: string; slug: string; type?: string }
  isBuiltin?: boolean
}

export interface AutomationLike {
  id: string
  name: string
  summary?: string
  enabled?: boolean
  event?: string
}

export interface SettingsPageLike {
  id: string
  /** Already-resolved display label (i18n applied by host). */
  label: string
  description?: string
}

export interface KnowledgeSearchHitLike {
  ref: { kind: string; id: string }
  title: string
  snippet?: string
  notebookPath?: string
  score?: number
}

export type KnowledgeSearchFn = (query: string, signal?: AbortSignal) => Promise<KnowledgeSearchHitLike[] | null>

const TOP_EMPTY = 8

/** craft-sessions — fuzzy over session metadata. */
export function createSessionsProvider(
  getSessions: () => SessionMetaLike[],
  routeFor: (id: string) => string,
): ResourceProvider {
  return {
    id: 'craft-sessions',
    label: 'Sessions',
    prefixes: ['', '@'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      const limit = ctx.limit ?? TOP_EMPTY
      const sessions = getSessions().filter((s) => !s.hidden)
      const scored: ResourceItem[] = []
      for (const s of sessions) {
        const title = s.name?.trim() || s.preview?.trim() || s.id
        const score = q.length === 0
          ? // Recent-ish empty ranking by lastMessageAt
            0.3 + Math.min(0.5, (s.lastMessageAt ?? 0) / 1e15)
          : scoreMatchAny([s.name, s.preview, s.id], q)
        if (q.length > 0 && score <= 0) continue
        scored.push({
          id: `session:${s.id}`,
          kind: 'session',
          title,
          subtitle: s.isArchived ? 'Archived' : 'Session',
          icon: 'session',
          route: routeFor(s.id),
          data: { sessionId: s.id },
          score: q.length === 0 ? score : score,
        })
      }
      scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      return scored.slice(0, limit)
    },
  }
}

/** craft-settings — static settings pages. */
export function createSettingsProvider(
  pages: SettingsPageLike[],
  routeFor: (id: string) => string,
): ResourceProvider {
  return {
    id: 'craft-settings',
    label: 'Settings',
    prefixes: [''],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      const limit = ctx.limit ?? TOP_EMPTY
      const items: ResourceItem[] = []
      for (const page of pages) {
        const score = q.length === 0
          ? 0.4
          : scoreMatchAny([page.label, page.description, page.id], q)
        if (q.length > 0 && score <= 0) continue
        items.push({
          id: `settings:${page.id}`,
          kind: 'settings',
          title: page.label,
          subtitle: page.description ?? 'Settings',
          icon: 'settings',
          route: routeFor(page.id),
          data: { settingsId: page.id },
          score,
        })
      }
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      return items.slice(0, limit)
    },
  }
}

/** craft-skills — workspace skills. */
export function createSkillsProvider(
  getSkills: () => SkillLike[],
  routeFor: (slug: string) => string,
): ResourceProvider {
  return {
    id: 'craft-skills',
    label: 'Skills',
    prefixes: ['', '/'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      const limit = ctx.limit ?? TOP_EMPTY
      const items: ResourceItem[] = []
      for (const skill of getSkills()) {
        if (skill.shadowedByCraft) continue
        const name = skill.metadata.name ?? skill.slug
        const score = q.length === 0
          ? 0.35
          : scoreMatchAny([name, skill.slug, skill.metadata.description], q)
        if (q.length > 0 && score <= 0) continue
        items.push({
          id: `skill:${skill.slug}`,
          kind: 'skill',
          title: name,
          subtitle: skill.metadata.description ?? skill.slug,
          icon: 'skill',
          route: routeFor(skill.slug),
          data: { slug: skill.slug },
          score,
        })
      }
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      return items.slice(0, limit)
    },
  }
}

/** craft-sources — workspace sources. */
export function createSourcesProvider(
  getSources: () => SourceLike[],
  routeFor: (slug: string) => string,
): ResourceProvider {
  return {
    id: 'craft-sources',
    label: 'Sources',
    prefixes: ['', '@'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      const limit = ctx.limit ?? TOP_EMPTY
      const items: ResourceItem[] = []
      for (const source of getSources()) {
        if (source.isBuiltin) continue
        const { name, slug, type } = source.config
        const score = q.length === 0
          ? 0.35
          : scoreMatchAny([name, slug, type], q)
        if (q.length > 0 && score <= 0) continue
        items.push({
          id: `source:${slug}`,
          kind: 'source',
          title: name,
          subtitle: type ?? slug,
          icon: 'source',
          route: routeFor(slug),
          data: { slug },
          score,
        })
      }
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      return items.slice(0, limit)
    },
  }
}

/** craft-automations — automation names. */
export function createAutomationsProvider(
  getAutomations: () => AutomationLike[],
  routeFor: (id: string) => string,
): ResourceProvider {
  return {
    id: 'craft-automations',
    label: 'Automations',
    prefixes: ['', '!'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      const limit = ctx.limit ?? TOP_EMPTY
      const items: ResourceItem[] = []
      for (const auto of getAutomations()) {
        const score = q.length === 0
          ? 0.35
          : scoreMatchAny([auto.name, auto.summary, auto.event, auto.id], q)
        if (q.length > 0 && score <= 0) continue
        items.push({
          id: `automation:${auto.id}`,
          kind: 'automation',
          title: auto.name,
          subtitle: auto.summary ?? auto.event ?? 'Automation',
          icon: 'automation',
          route: routeFor(auto.id),
          data: { automationId: auto.id, enabled: auto.enabled },
          score,
        })
      }
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      return items.slice(0, limit)
    },
  }
}

/**
 * knowledge-docs — knowledge.search when query length ≥ 2 and a search fn is live.
 * Empty/short query → no hits (avoids hammering the kernel).
 */
export function createKnowledgeProvider(searchFn: KnowledgeSearchFn): ResourceProvider {
  return {
    id: 'knowledge-docs',
    label: 'Knowledge',
    prefixes: ['', '@', '?'],
    async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
      const q = ctx.query.trim()
      if (q.length < 2) return []
      if (ctx.signal?.aborted) return []
      const hits = await searchFn(q, ctx.signal)
      if (!hits || ctx.signal?.aborted) return []
      const limit = ctx.limit ?? TOP_EMPTY
      return hits.slice(0, limit).map((hit, index) => {
        const base = hit.score ?? scoreMatch(hit.title, q)
        return {
          id: `knowledge:${hit.ref.kind}:${hit.ref.id}`,
          kind: 'knowledge' as const,
          title: hit.title || hit.ref.id,
          subtitle: hit.snippet ?? hit.notebookPath ?? hit.ref.kind,
          icon: 'knowledge',
          route: `knowledge/${hit.ref.kind}/${encodeURIComponent(hit.ref.id)}`,
          data: { ref: hit.ref },
          // Preserve provider order as a small tie-break
          score: base + (limit - index) * 0.0001,
        }
      })
    },
  }
}
