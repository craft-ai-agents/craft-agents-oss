import { describe, it, expect } from 'bun:test'
import type { ActivityItem } from '../../components/chat/TurnCard'
import { extractOverlayCards } from '../tool-parsers'

function makeActivity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'tool-1',
    type: 'tool',
    status: 'completed',
    timestamp: Date.now(),
    toolName: 'mcp__session__browser_tool',
    toolInput: {},
    content: '',
    ...overrides,
  }
}

describe('extractOverlayCards', () => {
  it('returns input + output cards for browser tools with params and output', () => {
    const activity = makeActivity({
      toolName: 'mcp__session__browser_navigate',
      toolInput: { url: 'https://news.ycombinator.com' },
      content: 'Navigated to: https://news.ycombinator.com',
      displayName: 'Browser Navigate',
    })

    const cards = extractOverlayCards(activity)

    expect(cards).toHaveLength(2)
    expect(cards[0]?.label).toBe('Input')
    expect(cards[0]?.commandPreview).toBe('browser_navigate --url https://news.ycombinator.com')
    expect(cards[0]?.data.type).toBe('json')
    if (cards[0]?.data.type === 'json') {
      expect(cards[0].data.data).toEqual({ url: 'https://news.ycombinator.com' })
    }

    expect(cards[1]?.label).toBe('Output')
  })

  it('keeps an Output card with placeholder when fallback output mirrors input', () => {
    const activity = makeActivity({
      toolName: 'mcp__session__browser_click',
      toolInput: { ref: '@e12' },
      content: '',
      displayName: 'Browser Click',
    })

    const cards = extractOverlayCards(activity)

    expect(cards).toHaveLength(2)
    expect(cards[0]?.label).toBe('Input')
    expect(cards[0]?.data.type).toBe('json')
    expect(cards[1]?.label).toBe('Output')
    expect(cards[1]?.data.type).toBe('generic')
    if (cards[1]?.data.type === 'generic') {
      expect(cards[1].data.content).toBe('No output captured for this tool call.')
    }
  })

  it('returns output-only card when tool has no input', () => {
    const activity = makeActivity({
      toolName: 'mcp__session__browser_snapshot',
      toolInput: {},
      content: JSON.stringify([{ ref: '@e1', role: 'button' }]),
      displayName: 'Browser Snapshot',
    })

    const cards = extractOverlayCards(activity)

    expect(cards).toHaveLength(1)
    expect(cards[0]?.label).toBe('Output')
    expect(cards[0]?.data.type).toBe('json')
  })

  it('uses wrapper command verbatim for browser_tool input cards', () => {
    const activity = makeActivity({
      toolName: 'mcp__session__browser_tool',
      toolInput: { command: 'navigate https://example.com' },
      content: 'ok',
    })

    const cards = extractOverlayCards(activity)
    expect(cards[0]?.label).toBe('Input')
    expect(cards[0]?.commandPreview).toBe('navigate https://example.com')
  })

  it('quotes synthesized values with spaces', () => {
    const activity = makeActivity({
      toolName: 'mcp__session__browser_fill',
      toolInput: { ref: '@e5', value: 'hello world' },
      content: 'ok',
    })

    const cards = extractOverlayCards(activity)
    expect(cards[0]?.commandPreview).toBe('browser_fill --ref @e5 --value "hello world"')
  })
})
