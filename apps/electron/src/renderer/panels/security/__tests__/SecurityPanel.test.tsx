;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'
import { SecurityPanel } from '../SecurityPanel'
import { sessionMetaMapAtom } from '../../../atoms/sessions'
import { sourcesAtom } from '../../../atoms/sources'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.navigator = win.navigator

let credentialHealth: any = { healthy: true, issues: [] }
const getCredentialHealth = mock(async () => credentialHealth)
;(win as any).electronAPI = { getCredentialHealth }

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel({ sessions = [], sources = [] }: { sessions?: any[]; sources?: any[] } = {}) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  store.set(sessionMetaMapAtom, new Map(sessions.map((session) => [session.id, session])))
  store.set(sourcesAtom, sources as any)

  await act(async () => {
    root.render(
      <Provider store={store}>
        <SecurityPanel />
      </Provider>,
    )
    await flush()
    await flush()
  })
  return { container, root }
}

describe('Security panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    credentialHealth = { healthy: true, issues: [] }
    getCredentialHealth.mockClear()
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('reports a healthy credential and integration posture', async () => {
    const rendered = await renderPanel({
      sessions: [
        { id: 'safe-1', permissionMode: 'safe' },
        { id: 'ask-1', permissionMode: 'ask' },
      ],
      sources: [
        { id: 'gmail', isBuiltin: false, config: { id: 'gmail', name: 'Gmail', enabled: true, connectionStatus: 'connected' } },
      ],
    })
    root = rendered.root
    container = rendered.container

    expect(getCredentialHealth).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Security')
    expect(container.textContent).toContain('All clear')
    expect(container.textContent).toContain('Credential store is healthy and encrypted at rest.')
    expect(container.textContent).toContain('Every enabled integration is authenticated.')
    const modes = Array.from(container.querySelectorAll('.security-mode')).map((mode: any) => mode.textContent)
    expect(modes).toEqual(expect.arrayContaining([
      expect.stringContaining('Explore1'),
      expect.stringContaining('Ask1'),
      expect.stringContaining('Execute0'),
    ]))
  })

  it('surfaces credential, integration, and execute-mode exposure', async () => {
    credentialHealth = {
      healthy: false,
      issues: [{ type: 'permissions', message: 'Credential file permissions are too broad.' }],
    }
    const rendered = await renderPanel({
      sessions: [
        { id: 'execute-1', permissionMode: 'allow-all' },
        { id: 'execute-hidden', permissionMode: 'allow-all', hidden: true },
        { id: 'execute-archived', permissionMode: 'allow-all', isArchived: true },
      ],
      sources: [
        {
          id: 'slack',
          isBuiltin: false,
          config: { id: 'slack', name: 'Slack', enabled: true, connectionStatus: 'needs_auth' },
        },
        {
          id: 'disabled-source',
          isBuiltin: false,
          config: { id: 'disabled-source', name: 'Disabled Source', enabled: false, connectionStatus: 'failed' },
        },
      ],
    })
    root = rendered.root
    container = rendered.container

    expect(container.textContent).toContain('2 to review')
    expect(container.textContent).toContain('Credential file permissions are too broad.')
    expect(container.textContent).toContain('1 session in Execute mode')
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).toContain('Needs authentication')
    expect(container.textContent).not.toContain('Disabled Source')
  })
})
