import { describe, expect, it } from 'bun:test'
import type { CraftyProvenance, CraftySelectionResult, CraftySessionSummary } from '../../../../shared/crafty'
import { languageCode, translateLanguages } from '../languages'
import { captureHub, hubClick, itemHub, mainItems, refusedHub, sendItems, SUB_PIE_MAX, translateItems, type PieCapture } from '../slots'

const selected = (text: string): CraftySelectionResult => ({
  latencyMs: 5,
  selection: { text, method: 'accessibility', rawMethod: 1, posLevel: 1, bounds: null, programName: 'Slack' },
})
const NOTHING: CraftySelectionResult = { latencyMs: 5, selection: null }
const provenance = (fields: Partial<CraftyProvenance> = {}): CraftyProvenance => ({
  pid: 42,
  bundleId: 'com.tinyspeck.slackmacgap',
  appName: 'Slack',
  windowTitle: 'general',
  url: null,
  notes: [],
  latencyMs: 90,
  ...fields,
})
const session = (sessionId: string, name: string): CraftySessionSummary => ({
  workspaceId: 'ws',
  sessionId,
  name,
  preview: null,
  lastMessageAt: 1,
  isProcessing: false,
})

const capture = (fields: Partial<PieCapture>): PieCapture => ({
  selection: selected('Ship it on Friday?'),
  provenance: provenance(),
  accessibility: true,
  recentScreenshot: false,
  sessions: [],
  ...fields,
})

const states = (c: PieCapture) => Object.fromEntries(mainItems(c).map(item => [item.id, item.availability.state]))

describe('mainItems', () => {
  it('keeps eight slots in fixed places, clockwise from Ask at the top', () => {
    expect(mainItems(capture({})).map(item => item.id)).toEqual(['ask', 'rewrite', 'summarize', 'translate', 'reply', 'screenshot', 'explain', 'send'])
    expect(mainItems(capture({ selection: NOTHING })).map(item => item.id)).toHaveLength(8)
  })

  it('offers everything with selected text', () => {
    expect(Object.values(states(capture({})))).toEqual(Array(8).fill('ready'))
  })

  it('waits for the selection before dimming anything', () => {
    expect(states(capture({ selection: null, provenance: null }))).toEqual({
      ask: 'ready', rewrite: 'pending', summarize: 'pending', translate: 'pending',
      reply: 'pending', screenshot: 'ready', explain: 'pending', send: 'pending',
    })
  })

  it('dims the text slots without a selection, and says why', () => {
    const items = mainItems(capture({ selection: NOTHING }))
    expect(states(capture({ selection: NOTHING }))).toEqual({
      ask: 'ready', rewrite: 'off', summarize: 'off', translate: 'off',
      reply: 'off', screenshot: 'ready', explain: 'off', send: 'off',
    })
    expect(itemHub(items[4])).toEqual({ primary: 'Reply', secondary: 'Select text first' })
    const blocked = mainItems(capture({ selection: NOTHING, accessibility: false }))
    expect(itemHub(blocked[6]).secondary).toBe('Needs Accessibility access')
  })

  it('summarizes a browser page without a selection, once its URL is known', () => {
    const asking = capture({ selection: NOTHING, provenance: provenance({ bundleId: 'com.apple.Safari', urlPending: true }) })
    expect(states(asking).summarize).toBe('pending')
    const page = capture({ selection: NOTHING, provenance: provenance({ url: 'https://example.com/post' }) })
    expect(states(page).summarize).toBe('ready')
    expect(states(page).explain).toBe('off')
  })

  it('sends the recent screenshot when nothing is selected', () => {
    expect(states(capture({ selection: NOTHING, recentScreenshot: true })).send).toBe('ready')
    expect(states(capture({ selection: NOTHING, provenance: null, recentScreenshot: false })).send).toBe('pending')
  })

  it('waits for the session list before Send to opens', () => {
    expect(itemHub(mainItems(capture({ sessions: null }))[7])).toEqual({ primary: 'Send to', secondary: 'Loading sessions…', busy: true })
  })

  it('refuses one-shots on a very long selection', () => {
    const long = mainItems(capture({ selection: selected('x'.repeat(20_001)) }))
    expect(long[1].availability).toEqual({ state: 'off', reason: 'Over 20,000 characters' })
    expect(long[2].availability.state).toBe('ready')
  })
})

describe('captureHub', () => {
  it('says what goes along, like the panel\'s chip', () => {
    expect(captureHub(capture({}))).toEqual({ primary: '18 characters', secondary: 'from Slack' })
    // No selection (yet): the Craft mark alone, nothing written under it; the label is for VoiceOver
    expect(captureHub(capture({ selection: null }))).toEqual({ mark: true, label: 'Reading the selection' })
    expect(captureHub(capture({ selection: NOTHING }))).toEqual({ mark: true, label: 'Nothing selected in Slack' })
    expect(captureHub(capture({ selection: NOTHING, provenance: provenance({ url: 'https://example.com' }) })))
      .toEqual({ mark: true, label: 'No selection; the page goes along' })
    // A problem the user can fix stays in words, and a click on the hub fixes it
    const blocked = captureHub(capture({ selection: NOTHING, accessibility: false }))
    expect(blocked).toEqual({ primary: 'Can\'t read the selection', secondary: 'Click to allow Accessibility', click: 'allow-accessibility' })
    expect(hubClick(blocked)).toBe('allow-accessibility')
    expect(hubClick(captureHub(capture({ selection: NOTHING })))).toBe('open-craft')
    expect(hubClick(captureHub(capture({})))).toBeNull()
  })
})

describe('refusedHub', () => {
  it('offers Accessibility for a pick that needed it, and says why for the rest', () => {
    const blocked = mainItems(capture({ selection: NOTHING, accessibility: false }))
    const reply = blocked[4]
    const reason = reply.availability.state === 'off' ? reply.availability.reason : ''
    expect(refusedHub(reply, reason)).toEqual({ primary: 'Reply', secondary: 'Click to allow Accessibility', click: 'allow-accessibility' })
    expect(refusedHub(reply, 'The selection didn\'t arrive')).toEqual({ primary: 'Reply', secondary: 'The selection didn\'t arrive' })
  })
})

describe('sub-pies', () => {
  it('lists the target first, then recent sessions, then a new session', () => {
    const target = session('t', 'Release notes')
    const items = sendItems(target, [session('a', 'Alpha'), target, session('b', 'Beta')])
    expect(items.map(item => item.label)).toEqual(['Release notes', 'Alpha', 'Beta', 'New session'])
    expect(items.at(-1)?.action).toEqual({ kind: 'send', session: null })
  })

  it('caps the session list so Back still fits', () => {
    const many = Array.from({ length: 20 }, (_, i) => session(`s${i}`, `Session ${i}`))
    expect(sendItems(null, many)).toHaveLength(SUB_PIE_MAX)
  })

  it('names languages in English, recent picks first, without repeats', () => {
    const languages = translateLanguages(['de', 'en-HU', 'hu-HU', 'en-US'], 4)
    expect(languages.map(l => l.name)).toEqual(['German', 'English', 'Hungarian', 'Spanish'])
    expect(languages[2].glyph).toBe('HU')
    expect(translateItems(languages)[2].action).toEqual({
      kind: 'transform',
      transform: { kind: 'translate', language: 'Hungarian' },
      title: 'Translate · Hungarian',
      languageCode: 'hu',
    })
  })

  it('tells Simplified from Traditional Chinese', () => {
    expect(languageCode('zh-TW')).toBe('zh-Hant')
    expect(languageCode('zh-CN')).toBe('zh-Hans')
    expect(languageCode('not a tag!')).toBeNull()
  })
})
