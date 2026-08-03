;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'
import { ProjectsPanel } from '../ProjectsPanel'
import { projectsAtom } from '../../../atoms/projects'
import { sessionMetaMapAtom } from '../../../atoms/sessions'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.navigator = win.navigator

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  const now = Date.now()

  store.set(projectsAtom, [
    {
      config: {
        id: 'project-live',
        slug: 'live-project',
        name: 'Live Project',
        description: 'Current release work',
        color: '#8b5cf6',
        workingDirectory: 'D:/ARCHstudio',
        createdAt: now - 100_000,
        updatedAt: now - 50_000,
      },
    },
    {
      config: {
        id: 'project-quiet',
        slug: 'quiet-project',
        name: 'Quiet Project',
        description: 'Documentation backlog',
        createdAt: now - 200_000,
        updatedAt: now - 150_000,
      },
    },
    {
      config: {
        id: 'project-archived',
        slug: 'archived-project',
        name: 'Archived Project',
        createdAt: now - 300_000,
        updatedAt: now - 250_000,
        archivedAt: now - 10_000,
      },
    },
  ] as any)

  store.set(sessionMetaMapAtom, new Map([
    ['session-1', { id: 'session-1', projectId: 'project-live', isProcessing: true, lastMessageAt: now - 1_000 }],
    ['session-2', { id: 'session-2', projectId: 'project-live', isProcessing: false, lastMessageAt: now - 2_000 }],
    ['session-hidden', { id: 'session-hidden', projectId: 'project-live', hidden: true, isProcessing: true, lastMessageAt: now }],
  ] as any))

  const onSelectProject = mock((_id: string) => {})
  await act(async () => {
    root.render(
      <Provider store={store}>
        <ProjectsPanel onSelectProject={onSelectProject} selectedProjectId="project-live" />
      </Provider>,
    )
    await flush()
  })

  return { container, root, onSelectProject }
}

describe('Projects panel', () => {
  let root: Root | null = null
  let container: any = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('aggregates live session statistics and opens a project', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const renderedContainer = rendered.container as any

    expect(renderedContainer.textContent).toContain('Projects')
    expect(renderedContainer.textContent).toContain('Live Project')
    expect(renderedContainer.textContent).toContain('2 sessions')
    expect(renderedContainer.textContent).toContain('1 running')
    expect(renderedContainer.textContent).toContain('Quiet Project')
    expect(renderedContainer.textContent).not.toContain('Archived Project')

    const liveCard = Array.from(renderedContainer.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((button) =>
      button.textContent?.includes('Live Project'),
    )
    expect(liveCard?.className).toContain('is-selected')
    await act(async () => liveCard?.click())
    expect(rendered.onSelectProject).toHaveBeenCalledWith('project-live')
  })

  it('renders search and can include archived records', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container
    const renderedContainer = rendered.container as any

    const search = renderedContainer.querySelector('input[placeholder="Search projects..."]') as HTMLInputElement
    expect(search).not.toBeNull()
    expect(search.value).toBe('')

    await act(async () => {
      const archivedToggle = renderedContainer.querySelector('button[title="Show archived projects"]') as HTMLButtonElement
      archivedToggle.click()
      await flush()
    })
    expect(renderedContainer.textContent).toContain('Archived Project')
  })
})
