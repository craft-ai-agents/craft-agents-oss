import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DecisionRecorder,
  SystemOneClient,
  isDecisionFollowUpRecord,
  normalizeDecisionLayerSettings,
  readDecisionLog,
  resolveDecisionEndpoint,
  type DecisionClientResolution,
} from '@craft-agent/shared/decisions'
import type { LoadedSkill } from '@craft-agent/shared/skills'
import type { LoadedSource } from '@craft-agent/shared/sources'
import {
  buildSuggestionRequest,
  candidatesUsedBy,
  collectSuggestionCandidates,
  formatSuggestionHint,
  pickSuggestion,
  suggestionFollowUp,
  wantsSuggestion,
  SUGGESTION_MAX_CANDIDATES,
  SUGGESTION_MAX_DESCRIPTION_CHARS,
  SUGGESTION_MIN_CONFIDENCE,
} from './suggestions'

const skill = (slug: string, description = `Helps with ${slug}`) =>
  ({ slug, metadata: { name: `Skill ${slug}`, description }, content: '', path: `/ws/skills/${slug}`, source: 'workspace' }) as unknown as LoadedSkill

const source = (slug: string, config: { enabled?: boolean; tagline?: string; authType?: string; isAuthenticated?: boolean } = {}) =>
  ({
    config: {
      id: slug, name: `Source ${slug}`, slug, enabled: config.enabled ?? true, provider: `${slug}-provider`, type: 'mcp',
      mcp: { authType: config.authType ?? 'none' }, tagline: config.tagline, isAuthenticated: config.isAuthenticated,
    },
    guide: null, folderPath: `/ws/sources/${slug}`, workspaceRootPath: '/ws', workspaceId: 'ws',
  }) as unknown as LoadedSource

function answering(choice: string, confidence: number, calls: { count: number } = { count: 0 }): () => Promise<DecisionClientResolution> {
  return async () => {
    calls.count++
    const settings = normalizeDecisionLayerSettings({ enabled: true, provider: 'openrouter', features: { suggestions: true } })
    const endpoint = resolveDecisionEndpoint(settings)
    const fetchImpl = (async () => new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { needed: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } },
      usage: { input_tokens: 5, output_tokens: 1 },
    }), { status: 200 })) as unknown as typeof fetch
    const client = new SystemOneClient({ baseUrl: endpoint.baseUrl, apiKey: 'k', model: endpoint.model, fetch: fetchImpl })
    return { ok: true, value: { client, settings, provider: 'openrouter', endpoint, keySource: 'provider' } }
  }
}

describe('wantsSuggestion', () => {
  it('checks plain requests only', () => {
    expect(wantsSuggestion('file a ticket for the login bug')).toBe(true)
    expect(wantsSuggestion('   ')).toBe(false)
    expect(wantsSuggestion('/compact')).toBe(false)
    expect(wantsSuggestion('do it', { hidden: true })).toBe(false)
    expect(wantsSuggestion('do it', { skillSlugs: ['deploy'] })).toBe(false)
    expect(wantsSuggestion('[skill:ws1:deploy] ship it')).toBe(false)
    expect(wantsSuggestion('check [source:linear] issues')).toBe(false)
    expect(wantsSuggestion('list my issues\n\n[linear activated]')).toBe(false)
  })

  // The WS RPC JSON-encodes call args, turning a trailing `undefined` options arg into `null` on
  // the wire (e.g. Crafty's first-question sendMessage). A plain request must still be checked, not
  // throw "Cannot read properties of null (reading 'hidden')".
  it('treats null options like absent', () => {
    expect(wantsSuggestion('file a ticket for the login bug', null)).toBe(true)
    expect(wantsSuggestion('/compact', null)).toBe(false)
  })
})

describe('collectSuggestionCandidates', () => {
  it('offers usable inactive sources first, then skills', () => {
    const candidates = collectSuggestionCandidates({
      skills: [skill('deploy')],
      sources: [
        source('active'),
        source('disabled', { enabled: false }),
        source('needs-auth', { authType: 'oauth', isAuthenticated: false }),
        source('linear', { authType: 'oauth', isAuthenticated: true, tagline: 'Issue tracking' }),
        source('files'),
      ],
      activeSourceSlugs: ['active'],
    })
    expect(candidates.map(c => `${c.kind}:${c.slug}`)).toEqual(['source:linear', 'source:files', 'skill:deploy'])
    expect(candidates[0]).toMatchObject({ name: 'Source linear', description: 'Issue tracking', path: '/ws/sources/linear' })
    expect(candidates[1]!.description).toBe('files-provider')
    expect(candidates[2]!.path).toBe('/ws/skills/deploy/SKILL.md')
  })

  it('caps the offer', () => {
    const skills = Array.from({ length: SUGGESTION_MAX_CANDIDATES + 5 }, (_, i) => skill(`s${i}`))
    expect(collectSuggestionCandidates({ skills, sources: [], activeSourceSlugs: [] })).toHaveLength(SUGGESTION_MAX_CANDIDATES)
  })
})

describe('buildSuggestionRequest', () => {
  it('offers none plus one option per candidate, with short descriptions', () => {
    const request = buildSuggestionRequest('ship the release', [
      { kind: 'skill', slug: 'deploy', name: 'Deploy', description: 'x'.repeat(500), path: '/p' },
      { kind: 'source', slug: 'linear', name: 'Linear', description: 'Issues', path: '/q' },
    ])
    const question = request.questions.needed as { type: string; criteria: Record<string, string> }
    expect(question.type).toBe('choice')
    expect(Object.keys(question.criteria)).toEqual(['none', 'skill:deploy', 'source:linear'])
    expect(question.criteria['skill:deploy']!.length).toBe(SUGGESTION_MAX_DESCRIPTION_CHARS + 1)
    expect(question.criteria['source:linear']).toBe('Data source "Linear": Issues')
    expect(request.state).toEqual({ message: 'ship the release' })
  })
})

describe('pickSuggestion', () => {
  const candidates = collectSuggestionCandidates({ skills: [skill('deploy')], sources: [source('linear')], activeSourceSlugs: [] })

  it('returns the confident pick', async () => {
    const pick = await pickSuggestion('ship it', candidates, { resolveClient: answering('skill:deploy', 0.9) })
    expect(pick.hint?.slug).toBe('deploy')
    expect(pick.trace).toMatchObject({ hinted: true, choice: { slug: 'deploy' } })
  })

  it('hints at nothing for none, low confidence, a disabled toggle, or nothing to offer', async () => {
    expect((await pickSuggestion('hi', candidates, { resolveClient: answering('none', 0.99) })).hint).toBeNull()
    expect((await pickSuggestion('ship it', candidates, { resolveClient: answering('skill:deploy', 0.7) })).hint).toBeNull()
    expect(await pickSuggestion('ship it', candidates, { resolveClient: async () => ({ ok: false, failure: { kind: 'disabled', message: 'off' } }) })).toEqual({ hint: null, trace: null })
    const calls = { count: 0 }
    expect(await pickSuggestion('ship it', [], { resolveClient: answering('none', 0.99, calls) })).toEqual({ hint: null, trace: null })
    expect(calls.count).toBe(0)
  })

  it('keeps a pick held back for low confidence, to check later whether it was needed', async () => {
    const pick = await pickSuggestion('check my calendar', candidates, { resolveClient: answering('source:linear', 0.7) })
    expect(pick.hint).toBeNull()
    expect(pick.trace).toMatchObject({ hinted: false, choice: { slug: 'linear' } })
    // The harness run's held-back google-calendar picks (0.77, 0.78) now get through.
    expect(SUGGESTION_MIN_CONFIDENCE).toBeLessThanOrEqual(0.77)
    expect((await pickSuggestion('check my calendar', candidates, { resolveClient: answering('source:linear', 0.77) })).hint?.slug).toBe('linear')
  })
})

describe('suggestion follow-ups', () => {
  const candidates = collectSuggestionCandidates({ skills: [skill('balaton-weekend')], sources: [source('google-calendar')], activeSourceSlugs: [] })

  it('counts a source as used when its tools run, a session tool acts on it or it is activated', () => {
    expect(candidatesUsedBy(candidates, { toolName: 'mcp__google-calendar__api_google-calendar', input: {} })).toEqual(['source:google-calendar'])
    expect(candidatesUsedBy(candidates, { toolName: 'mcp__session__source_test', input: { sourceSlug: 'google-calendar' } })).toEqual(['source:google-calendar'])
    expect(candidatesUsedBy(candidates, { activatedSource: 'google-calendar' })).toEqual(['source:google-calendar'])
    // Reading its guide, or a same-prefix source, is not use.
    expect(candidatesUsedBy(candidates, { toolName: 'Read', input: { file_path: '/ws/sources/google-calendar/guide.md' } })).toEqual([])
    expect(candidatesUsedBy(candidates, { toolName: 'mcp__google-calendar-2__list', input: {} })).toEqual([])
  })

  it('counts a skill as used when its SKILL.md is read or it is invoked', () => {
    expect(candidatesUsedBy(candidates, { toolName: 'Read', input: { file_path: '/ws/skills/balaton-weekend/SKILL.md' } })).toEqual(['skill:balaton-weekend'])
    expect(candidatesUsedBy(candidates, { toolName: 'read', input: { path: './skills/balaton-weekend/SKILL.md' } })).toEqual(['skill:balaton-weekend'])
    expect(candidatesUsedBy(candidates, { toolName: 'Bash', input: { command: 'cat skills\\balaton-weekend\\SKILL.md' } })).toEqual(['skill:balaton-weekend'])
    expect(candidatesUsedBy(candidates, { toolName: 'Skill', input: { skill: 'ws:balaton-weekend' } })).toEqual(['skill:balaton-weekend'])
  })

  describe('recorded lines', () => {
    let dir: string
    let recorder: DecisionRecorder
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'suggestion-followups-'))
      recorder = new DecisionRecorder({ path: join(dir, 'decisions.jsonl') })
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    async function followUps() {
      await recorder.flush()
      return (await readDecisionLog(recorder.path)).filter(isDecisionFollowUpRecord).map(line => ({ result: line.result, option: line.detail?.option }))
    }

    it('says whether the shown, held-back or missing pick was used', async () => {
      const shown = await pickSuggestion('plan the weekend', candidates, { resolveClient: answering('skill:balaton-weekend', 0.9), recorder })
      suggestionFollowUp(shown.trace!, new Set(['skill:balaton-weekend']))
      const heldBack = await pickSuggestion('find a free slot', candidates, { resolveClient: answering('source:google-calendar', 0.6), recorder })
      suggestionFollowUp(heldBack.trace!, new Set(['source:google-calendar']))
      const none = await pickSuggestion('find a free slot', candidates, { resolveClient: answering('none', 0.9), recorder })
      suggestionFollowUp(none.trace!, new Set(['source:google-calendar']))
      const ignored = await pickSuggestion('plan the weekend', candidates, { resolveClient: answering('skill:balaton-weekend', 0.9), recorder })
      suggestionFollowUp(ignored.trace!, new Set())

      expect(await followUps()).toEqual([
        { result: 'hint_used', option: 'skill:balaton-weekend' },
        { result: 'held_back_used', option: 'source:google-calendar' },
        { result: 'none_used', option: 'source:google-calendar' },
        { result: 'hint_unused', option: 'skill:balaton-weekend' },
      ])
    })
  })
})

describe('formatSuggestionHint', () => {
  it('names the skill file or the activation route without mention syntax', () => {
    const [linear, deploy] = collectSuggestionCandidates({ skills: [skill('deploy')], sources: [source('linear')], activeSourceSlugs: [] })
    const skillHint = formatSuggestionHint(deploy!)
    const sourceHint = formatSuggestionHint(linear!)
    expect(skillHint).toContain('/ws/skills/deploy/SKILL.md')
    expect(sourceHint).toContain('source_test')
    for (const hint of [skillHint, sourceHint]) {
      expect(hint).toStartWith('<system-reminder>')
      expect(hint).not.toMatch(/\[(?:skill|source):/)
    }
  })
})
