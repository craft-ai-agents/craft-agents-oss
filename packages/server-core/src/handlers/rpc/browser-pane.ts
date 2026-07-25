import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { BrowserScreenshotOptions } from '../browser-pane-manager-interface'
import type { RpcServer } from '../../transport'
import { pushTyped } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

type BrowserPaneCreateOptions = { id?: string; show?: boolean; bindToSessionId?: string }
type BrowserManagerWithEvents = NonNullable<HandlerDeps['browserPaneManager']> & {
  createInstance?: (id?: string, options?: { show?: boolean; workspaceId?: string | null }) => string
  reload?: (id: string) => Promise<void> | void
  stop?: (id: string) => void
  onStateChange?: (callback: (info: any) => void) => void
  onRemoved?: (callback: (id: string) => void) => void
  onInteracted?: (callback: (id: string) => void) => void
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.browserPane.CREATE, RPC_CHANNELS.browserPane.DESTROY, RPC_CHANNELS.browserPane.LIST,
  RPC_CHANNELS.browserPane.NAVIGATE, RPC_CHANNELS.browserPane.GO_BACK, RPC_CHANNELS.browserPane.GO_FORWARD,
  RPC_CHANNELS.browserPane.RELOAD, RPC_CHANNELS.browserPane.STOP, RPC_CHANNELS.browserPane.FOCUS,
  RPC_CHANNELS.browserPane.SNAPSHOT, RPC_CHANNELS.browserPane.CLICK, RPC_CHANNELS.browserPane.CLICK_AT,
  RPC_CHANNELS.browserPane.FILL, RPC_CHANNELS.browserPane.TYPE, RPC_CHANNELS.browserPane.KEY,
  RPC_CHANNELS.browserPane.SELECT, RPC_CHANNELS.browserPane.SCREENSHOT, RPC_CHANNELS.browserPane.EVALUATE,
  RPC_CHANNELS.browserPane.SCROLL,
] as const

/** Browser RPCs available to the standalone server (and therefore Web UI). */
export function registerBrowserPaneHandlers(server: RpcServer, deps: HandlerDeps): void {
  const manager = deps.browserPaneManager as BrowserManagerWithEvents | undefined
  if (!manager) return
  const workspace = (ctx: { workspaceId: string | null }) => ctx.workspaceId ?? null

  server.handle(RPC_CHANNELS.browserPane.CREATE, (ctx, input?: string | BrowserPaneCreateOptions) => {
    const workspaceId = workspace(ctx)
    if (typeof input === 'string') return manager.createInstance?.(input, { workspaceId }) ?? manager.createForSession(input, { show: true, workspaceId })
    if (input?.bindToSessionId) return manager.createForSession(input.bindToSessionId, { show: input.show ?? true, workspaceId })
    return manager.createInstance?.(input?.id, { show: input?.show ?? true, workspaceId })
      ?? manager.createForSession('__web__', { show: input?.show ?? true, workspaceId })
  })
  server.handle(RPC_CHANNELS.browserPane.DESTROY, (_ctx, id: string) => manager.destroyInstance(id))
  server.handle(RPC_CHANNELS.browserPane.LIST, () => manager.listInstancesAsync())
  server.handle(RPC_CHANNELS.browserPane.NAVIGATE, (_ctx, id: string, url: string) => manager.navigate(id, url))
  server.handle(RPC_CHANNELS.browserPane.GO_BACK, (_ctx, id: string) => manager.goBack(id))
  server.handle(RPC_CHANNELS.browserPane.GO_FORWARD, (_ctx, id: string) => manager.goForward(id))
  server.handle(RPC_CHANNELS.browserPane.RELOAD, (_ctx, id: string) => manager.reload?.(id))
  server.handle(RPC_CHANNELS.browserPane.STOP, (_ctx, id: string) => manager.stop?.(id))
  server.handle(RPC_CHANNELS.browserPane.FOCUS, (_ctx, id: string) => manager.focus(id))
  server.handle(RPC_CHANNELS.browserPane.SNAPSHOT, (_ctx, id: string) => manager.getAccessibilitySnapshot(id))
  server.handle(RPC_CHANNELS.browserPane.CLICK, (_ctx, id: string, ref: string) => manager.clickElement(id, ref))
  server.handle(RPC_CHANNELS.browserPane.CLICK_AT, (_ctx, id: string, x: number, y: number) => manager.clickAtCoordinates(id, x, y))
  server.handle(RPC_CHANNELS.browserPane.FILL, (_ctx, id: string, ref: string, value: string) => manager.fillElement(id, ref, value))
  server.handle(RPC_CHANNELS.browserPane.TYPE, (_ctx, id: string, value: string) => manager.typeText(id, value))
  server.handle(RPC_CHANNELS.browserPane.KEY, (_ctx, id: string, args: { key: string; modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'> }) => manager.sendKey(id, args))
  server.handle(RPC_CHANNELS.browserPane.SELECT, (_ctx, id: string, ref: string, value: string) => manager.selectOption(id, ref, value))
  server.handle(RPC_CHANNELS.browserPane.SCREENSHOT, async (_ctx, id: string, options?: BrowserScreenshotOptions) => {
    const result = await manager.screenshot(id, options)
    return { base64: result.imageBuffer.toString('base64'), imageFormat: result.imageFormat, metadata: result.metadata }
  })
  server.handle(RPC_CHANNELS.browserPane.EVALUATE, (_ctx, id: string, expression: string) => manager.evaluate(id, expression))
  server.handle(RPC_CHANNELS.browserPane.SCROLL, (_ctx, id: string, direction: string, amount?: number) => {
    if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error(`Invalid scroll direction: ${direction}`)
    return manager.scroll(id, direction as 'up' | 'down' | 'left' | 'right', amount)
  })

  manager.onStateChange?.((info) => pushTyped(server, RPC_CHANNELS.browserPane.STATE_CHANGED, { to: 'all' }, info))
  manager.onRemoved?.((id) => pushTyped(server, RPC_CHANNELS.browserPane.REMOVED, { to: 'all' }, id))
  manager.onInteracted?.((id) => pushTyped(server, RPC_CHANNELS.browserPane.INTERACTED, { to: 'all' }, id))
}
