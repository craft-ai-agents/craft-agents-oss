;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ActionRegistryProvider } from '../../../actions'
import { SettingsPanel } from '../SettingsPanel'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.navigator = win.navigator
gs.localStorage = win.localStorage

const getDefaultThinkingLevel = mock(async () => 'medium')
const getKeepAwakeWhileRunning = mock(async () => false)
const getNetworkProxySettings = mock(async () => ({ enabled: false }))
const getServerStatus = mock(async () => ({
  running: true,
  url: 'https://studio.local:4242',
  tls: true,
  insecureWarning: false,
  needsRestart: false,
}))
const getLaunchAtLogin = mock(async () => false)
const getConfirmBeforeExit = mock(async () => true)
const setDefaultThinkingLevel = mock(async () => undefined)
const setKeepAwakeWhileRunning = mock(async () => undefined)
const setNetworkProxySettings = mock(async () => undefined)
const setLaunchAtLogin = mock(async () => undefined)
const setConfirmBeforeExit = mock(async () => undefined)
const exportSettings = mock(async () => ({ success: true, path: 'D:\\Backups\\archstudio-settings.zip' }))
const importSettings = mock(async () => ({ success: true }))

;(win as any).electronAPI = {
  getDefaultThinkingLevel,
  getKeepAwakeWhileRunning,
  getNetworkProxySettings,
  getServerStatus,
  getLaunchAtLogin,
  getConfirmBeforeExit,
  setDefaultThinkingLevel,
  setKeepAwakeWhileRunning,
  setNetworkProxySettings,
  setLaunchAtLogin,
  setConfirmBeforeExit,
  exportSettings,
  importSettings,
}

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ActionRegistryProvider>
        <SettingsPanel />
      </ActionRegistryProvider>,
    )
    await flush()
    await flush()
  })
  return { container, root }
}

function checkboxFor(container: any, label: string): HTMLInputElement {
  const row = Array.from(container.querySelectorAll('label.settings-row')).find(
    (candidate: any) => candidate.textContent?.includes(label),
  ) as HTMLElement | undefined
  const input = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (!input) throw new Error(`Missing checkbox for ${label}`)
  return input
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await flush()
  })
}

describe('Settings panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    win.localStorage.clear()
    doc.documentElement.classList.remove('compact-ui')
    for (const fn of [
      getDefaultThinkingLevel,
      getKeepAwakeWhileRunning,
      getNetworkProxySettings,
      getServerStatus,
      getLaunchAtLogin,
      getConfirmBeforeExit,
      setDefaultThinkingLevel,
      setKeepAwakeWhileRunning,
      setNetworkProxySettings,
      setLaunchAtLogin,
      setConfirmBeforeExit,
      exportSettings,
      importSettings,
    ]) fn.mockClear()
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('loads and renders persisted settings, server posture, and unfinished-state labels', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(getDefaultThinkingLevel).toHaveBeenCalledTimes(1)
    expect(getKeepAwakeWhileRunning).toHaveBeenCalledTimes(1)
    expect(getNetworkProxySettings).toHaveBeenCalledTimes(1)
    expect(getServerStatus).toHaveBeenCalledTimes(1)
    expect(getLaunchAtLogin).toHaveBeenCalledTimes(1)
    expect(getConfirmBeforeExit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Settings')
    expect(container.querySelector('.settings-level.is-active')?.textContent).toBe('Medium')
    expect(container.textContent).toContain('Running')
    expect(container.textContent).toContain('https://studio.local:4242')
    expect(container.textContent).toContain('TLS')
    expect(checkboxFor(container, 'Confirm before exit').checked).toBe(true)
    expect(container.querySelectorAll('.settings-soon').length).toBeGreaterThan(0)
  })

  it('persists primary toggles, reasoning, proxy, compact UI, export, and import', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    const highButton = Array.from(container.querySelectorAll('.settings-level')).find(
      (button: any) => button.textContent === 'High',
    ) as HTMLElement
    await click(highButton)
    expect(setDefaultThinkingLevel).toHaveBeenCalledWith('high')

    await click(checkboxFor(container, 'Keep awake while running'))
    expect(setKeepAwakeWhileRunning).toHaveBeenCalledWith(true)

    await click(checkboxFor(container, 'Route traffic through a proxy'))
    expect(setNetworkProxySettings).toHaveBeenCalledWith({ enabled: true })
    expect(container.textContent).toContain('HTTP proxy')

    await click(checkboxFor(container, 'Launch at login'))
    expect(setLaunchAtLogin).toHaveBeenCalledWith(true)

    await click(checkboxFor(container, 'Confirm before exit'))
    expect(setConfirmBeforeExit).toHaveBeenCalledWith(false)

    await click(checkboxFor(container, 'Compact UI'))
    expect(win.localStorage.getItem('archstudio:compactUI')).toBe('true')
    expect(doc.documentElement.classList.contains('compact-ui')).toBe(true)

    const exportButton = Array.from(container.querySelectorAll('button')).find(
      (button: any) => button.textContent === 'Export Settings',
    ) as HTMLElement
    await click(exportButton)
    expect(exportSettings).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Exported to D:\\Backups\\archstudio-settings.zip')

    const importButton = Array.from(container.querySelectorAll('button')).find(
      (button: any) => button.textContent === 'Import Settings',
    ) as HTMLElement
    await click(importButton)
    expect(importSettings).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Settings imported successfully!')
  })
})
