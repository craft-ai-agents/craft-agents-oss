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
//    (AutomationCard itself doesn't use navigation, but the harness mirrors
//    the AutomationEventTimeline test so a transitive consumer can't break.)
// -------------------------------------------------------------------------
const navigateToSession = mock((_sessionId: string) => {})
mock.module('@/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigateToSession }),
}))

const { AutomationCard } = await import('../AutomationCard')
import type { AutomationListItem } from '../types'

const automation: AutomationListItem = {
  id: 'auto-1',
  event: 'PostToolUse',
  matcherIndex: 0,
  name: 'Send telemetry',
  summary: 'On After Tool Runs',
  enabled: true,
  actions: [
    {
      type: 'webhook',
      url: 'https://hooks.example.com/telemetry',
      method: 'POST',
    },
  ],
}

async function renderCard(defaultExpanded = false) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AutomationCard automation={automation} defaultExpanded={defaultExpanded} />)
  })
  return { container, root }
}

describe('AutomationCard', () => {
  let root: Root | null = null
  let container: any = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    navigateToSession.mockClear()
  })

  it('renders collapsed by default — header visible, trigger/actions body absent', async () => {
    const rendered = await renderCard(false)
    root = rendered.root
    container = rendered.container

    // Header row always renders name + summary.
    expect(container.textContent).toContain('Send telemetry')
    expect(container.textContent).toContain('On After Tool Runs')

    // The AnimatedCollapsibleContent body is not mounted while collapsed:
    // no section labels and no webhook action text. (The event display name
    // 'After Tool Runs' intentionally appears in the header summary, so it
    // is NOT a valid body marker — the section labels and URL are.)
    expect(container.textContent).not.toContain('automations.sectionWhen')
    expect(container.textContent).not.toContain('automations.sectionThen')
    expect(container.textContent).not.toContain('hooks.example.com')
  })

  it('renders the trigger and actions body when defaultExpanded', async () => {
    const rendered = await renderCard(true)
    root = rendered.root
    container = rendered.container

    // Expanded body shows the trigger section, event display name,
    // action section, and the webhook preview line.
    expect(container.textContent).toContain('automations.sectionWhen')
    expect(container.textContent).toContain('automations.sectionThen')
    expect(container.textContent).toContain('After Tool Runs')
    expect(container.textContent).toContain('POST https://hooks.example.com/telemetry')
  })

  it('toggles the body via the header button — expand then collapse', async () => {
    const rendered = await renderCard(false)
    root = rendered.root
    container = rendered.container

    const headerBtn = container.querySelector('button') as HTMLElement
    expect(headerBtn).not.toBeNull()

    // 1. Expand — click the header.
    await act(async () => headerBtn?.click())
    expect(container.textContent).toContain('automations.sectionWhen')
    expect(container.textContent).toContain('POST https://hooks.example.com/telemetry')

    // 2. Collapse again — the body unmounts.
    await act(async () => headerBtn?.click())
    expect(container.textContent).not.toContain('automations.sectionWhen')
    expect(container.textContent).not.toContain('hooks.example.com')
  })
})
