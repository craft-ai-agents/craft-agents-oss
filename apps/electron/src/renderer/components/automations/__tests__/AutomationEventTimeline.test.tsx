;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.Event = win.Event
gs.KeyboardEvent = win.KeyboardEvent
gs.navigator = win.navigator

// -------------------------------------------------------------------------
// 1. Mock react-i18next — useTranslation returns the key as the label.
// -------------------------------------------------------------------------
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// -------------------------------------------------------------------------
// 2. Mock motion/react — render AnimatePresence + motion.div as plain
//    passthroughs so the collapsible mounts/unmounts deterministically
//    (AnimatedCollapsibleContent is the real component under test).
// -------------------------------------------------------------------------
const motionFactory = (tag: string) =>
  React.forwardRef<HTMLElement, any>((props, ref) =>
    React.createElement(tag as any, { ...props, ref }),
  )
mock.module('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: motionFactory('div') },
  useReducedMotion: () => false,
}))

// -------------------------------------------------------------------------
// 3. Mock NavigationContext — useNavigation throws without a provider.
// -------------------------------------------------------------------------
const navigateToSession = mock((_sessionId: string) => {})
mock.module('@/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigateToSession }),
}))

const { AutomationEventTimeline } = await import('../AutomationEventTimeline')
import type { ExecutionEntry } from '../types'

const webhookEntry: ExecutionEntry = {
  id: 'exec-1',
  automationId: 'auto-1',
  event: 'PostToolUse',
  status: 'success',
  duration: 450,
  timestamp: Date.now() - 60_000,
  actionSummary: 'Sent webhook notification',
  webhookDetails: {
    method: 'POST',
    url: 'https://hooks.example.com/telemetry',
    statusCode: 204,
    durationMs: 120,
    attempts: 2,
  },
}

async function renderTimeline(entries: ExecutionEntry[]) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AutomationEventTimeline entries={entries} />)
  })
  return { container, root }
}

describe('AutomationEventTimeline', () => {
  let root: Root | null = null
  let container: any = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    navigateToSession.mockClear()
  })

  it('renders an empty state when there are no entries', async () => {
    const rendered = await renderTimeline([])
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('automations.noActivityYet')
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('hides webhook details when collapsed, renders on expand, hides again on collapse', async () => {
    const rendered = await renderTimeline([webhookEntry])
    root = rendered.root
    container = rendered.container

    // 1. Collapsed — the header row shows the action summary, but the
    //    detail box (URL, method, status, duration) is not in the DOM.
    expect(container.textContent).toContain('Sent webhook notification')
    expect(container.textContent).not.toContain('hooks.example.com')

    // 2. Expand — click the row (role="button" for webhook entries).
    const row = container.querySelector('[role="button"]') as HTMLElement
    expect(row).not.toBeNull()
    await act(async () => row?.click())

    expect(container.textContent).toContain('hooks.example.com')
    expect(container.textContent).toContain('POST')
    expect(container.textContent).toContain('204')
    expect(container.textContent).toContain('120ms')

    // 3. Collapse again — the detail box unmounts.
    await act(async () => row?.click())
    expect(container.textContent).not.toContain('hooks.example.com')
  })
})
