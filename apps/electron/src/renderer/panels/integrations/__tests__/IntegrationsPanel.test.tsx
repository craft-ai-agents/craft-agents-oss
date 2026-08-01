;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'
import { IntegrationsPanel } from '../IntegrationsPanel'
import { sourcesAtom } from '../../../atoms/sources'

const win = new Window({ url: 'http://localhost:5173' })
const doc = win.document
const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.Event = win.Event
gs.navigator = win.navigator

const runtime = {
  telegram: {
    platform: 'telegram', configured: true, connected: true, state: 'connected', identity: '@arch_bot', updatedAt: Date.now(),
  },
  whatsapp: {
    platform: 'whatsapp', configured: false, connected: false, state: 'disconnected', updatedAt: Date.now(),
  },
}

const getMessagingConfig = mock(async () => ({ enabled: true, runtime }))
let platformStatusListener: ((workspaceId: string, platform: string, status: any) => void) | null = null
const onMessagingPlatformStatus = mock((listener: typeof platformStatusListener) => {
  platformStatusListener = listener
  return () => { platformStatusListener = null }
})
const startWhatsAppConnect = mock(async () => ({ success: true }))
const onWhatsAppEvent = mock((_listener: unknown) => () => {})

;(win as any).electronAPI = {
  getMessagingConfig,
  onMessagingPlatformStatus,
  startWhatsAppConnect,
  onWhatsAppEvent,
  submitWhatsAppPhone: mock(async () => undefined),
  testTelegramToken: mock(async () => ({ success: true, botName: 'arch_bot' })),
  saveTelegramToken: mock(async () => undefined),
  testLarkCredentials: mock(async () => ({ success: true, botName: 'ARCH Bot' })),
  saveLarkCredentials: mock(async () => undefined),
  disconnectMessagingPlatform: mock(async () => undefined),
  forgetMessagingPlatform: mock(async () => undefined),
}

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function renderPanel(onSelectSource = mock((_id: string) => {})) {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()
  store.set(sourcesAtom, [
    {
      id: 'github-source',
      slug: 'github',
      isBuiltin: false,
      config: {
        name: 'GitHub',
        provider: 'github',
        tagline: 'Repositories and pull requests',
        connectionStatus: 'connected',
      },
    },
  ] as any)

  await act(async () => {
    root.render(
      <Provider store={store}>
        <IntegrationsPanel onSelectSource={onSelectSource} />
      </Provider>,
    )
    await flush()
    await flush()
  })
  return { container, root, onSelectSource }
}

describe('Integrations panel', () => {
  let root: Root | null = null
  let container: any = null

  beforeEach(() => {
    getMessagingConfig.mockClear()
    onMessagingPlatformStatus.mockClear()
    startWhatsAppConnect.mockClear()
    onWhatsAppEvent.mockClear()
    platformStatusListener = null
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('loads messaging configuration and applies live status events', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    expect(getMessagingConfig).toHaveBeenCalledTimes(1)
    expect(onMessagingPlatformStatus).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Telegram')
    expect(container.textContent).toContain('@arch_bot')
    expect(container.textContent).toContain('Connected')
    expect(container.textContent).toContain('WhatsApp')
    expect(container.textContent).toContain('Lark / Feishu')

    await act(async () => {
      platformStatusListener?.('workspace-1', 'telegram', {
        platform: 'telegram', configured: true, connected: false, state: 'error', lastError: 'Token revoked', updatedAt: Date.now(),
      })
      await flush()
    })
    expect(container.textContent).toContain('Token revoked')
    expect(container.textContent).toContain('Error')
  })

  it('opens WhatsApp setup and starts the connection flow', async () => {
    const rendered = await renderPanel()
    root = rendered.root
    container = rendered.container

    const whatsappCard = Array.from(container.querySelectorAll('.int-platform-card')).find((element: any) =>
      element.textContent?.includes('WhatsApp'),
    ) as HTMLElement | undefined
    const connect = Array.from(whatsappCard?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Connect'),
    ) as HTMLButtonElement | undefined
    expect(connect).toBeDefined()

    await act(async () => {
      connect?.click()
      await flush()
    })
    expect(container.textContent).toContain('Connect WhatsApp')

    const start = Array.from(container.querySelectorAll('button')).find((button: any) =>
      button.textContent?.includes('Start Connection'),
    ) as HTMLButtonElement | undefined
    await act(async () => {
      start?.click()
      await flush()
      await flush()
    })
    expect(startWhatsAppConnect).toHaveBeenCalledTimes(1)
    expect(onWhatsAppEvent).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Starting WhatsApp connection')
  })
})
