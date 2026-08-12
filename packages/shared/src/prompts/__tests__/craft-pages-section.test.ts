/**
 * Flag gating and content for the Craft Pages prompt section.
 *
 * Tested as an extracted unit rather than through getSystemPrompt(), which
 * requires a real ~/.craft-agent install (config-defaults.json) and would make
 * this an environment test rather than a behaviour one.
 *
 * Gating has to be end-to-end. A flag that hides UI while still telling the
 * model the tool exists produces the worst outcome: the agent confidently calls
 * a tool that is not registered.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { getCraftPagesPromptSection } from '../craft-pages-section.ts'

const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

function section(enabled: boolean): string {
  process.env[KEY] = enabled ? '1' : '0'
  return getCraftPagesPromptSection()
}

describe('Craft Pages prompt section', () => {
  it('is empty when the feature is disabled', () => {
    expect(section(false)).toBe('')
  })

  it('is present when the feature is enabled', () => {
    const s = section(true)
    expect(s.length).toBeGreaterThan(0)
    expect(s).toContain('craft_page')
  })

  it('is evaluated per call, not captured at module load', () => {
    // Otherwise gating would depend on import order.
    expect(section(false)).toBe('')
    expect(section(true)).toContain('craft_page')
    expect(section(false)).toBe('')
  })

  it('names the constraints that fail silently', () => {
    // These four are what a model gets wrong by default, and none of them
    // produce an error it could recover from unaided.
    const s = section(true)
    expect(s).toContain('type="module"')
    expect(s).toContain('style')
    expect(s).toContain('fetch')
    expect(s).toContain('localStorage')
  })

  it('points at the skill rather than restating it', () => {
    // The system prompt is static per session and must stay small to preserve
    // prompt caching; the detail belongs in the skill.
    const s = section(true)
    expect(s).toContain('craft-pages')
    expect(s.length).toBeLessThan(1400)
  })

  it('tells the model to emit the fence', () => {
    // Without this the page is created but never shown to the user.
    expect(section(true)).toContain('craft-page')
  })
})

describe('live data', () => {
  const PAGES = 'CRAFT_FEATURE_CRAFT_PAGES'
  const LIVE = 'CRAFT_FEATURE_CRAFT_PAGES_LIVE_DATA'
  const origPages = process.env[PAGES]
  const origLive = process.env[LIVE]

  afterEach(() => {
    for (const [k, v] of [[PAGES, origPages], [LIVE, origLive]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('says nothing about live data when the sub-flag is off', () => {
    // Teaching a capability that is not wired produces pages that request
    // queries no dialog will ever show.
    process.env[PAGES] = '1'
    delete process.env[LIVE]
    const s = getCraftPagesPromptSection()
    expect(s).not.toMatch(/queries/i)
    expect(s).not.toMatch(/craftQuery/i)
  })

  it('teaches the request when live data is on', () => {
    process.env[PAGES] = '1'
    process.env[LIVE] = '1'
    const s = getCraftPagesPromptSection()
    expect(s).toMatch(/queries/i)
    expect(s).toMatch(/craftQuery/)
  })

  it('states that requesting is not having', () => {
    // The failure this prevents: the model announces a live dashboard the
    // moment the tool succeeds, and the user opens an empty page.
    process.env[PAGES] = '1'
    process.env[LIVE] = '1'
    expect(getCraftPagesPromptSection()).toMatch(/approv/i)
  })

  it('still contradicts nothing about fetch being unavailable', () => {
    // craftQuery is not fetch: the page still cannot make requests of its own.
    process.env[PAGES] = '1'
    process.env[LIVE] = '1'
    expect(getCraftPagesPromptSection()).toMatch(/fetch\(\)`? is unavailable/i)
  })
})
