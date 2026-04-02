import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PluginHost } from '../../plugins'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.plugins.LIST,
  RPC_CHANNELS.plugins.GET,
  RPC_CHANNELS.plugins.ENABLE,
  RPC_CHANNELS.plugins.DISABLE,
  RPC_CHANNELS.plugins.LIST_CAPABILITIES,
  RPC_CHANNELS.plugins.LIST_ROUTES,
  RPC_CHANNELS.plugins.LIST_SETTINGS_PANES,
  RPC_CHANNELS.plugins.LIST_SESSION_ACTIONS,
  RPC_CHANNELS.plugins.LIST_COMPOSER_ACTIONS,
  RPC_CHANNELS.plugins.LIST_CHAT_CARD_TYPES,
] as const

function requirePluginHost(deps: HandlerDeps): PluginHost {
  if (!deps.pluginHost) {
    throw new Error('Plugin host is not configured')
  }
  return deps.pluginHost
}

export function registerPluginsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.plugins.LIST, async () => ({
    plugins: requirePluginHost(deps).listPlugins(),
  }))

  server.handle(RPC_CHANNELS.plugins.GET, async (_ctx, pluginId: string) => {
    const plugin = requirePluginHost(deps).getPlugin(pluginId)
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }
    return { plugin }
  })

  server.handle(RPC_CHANNELS.plugins.ENABLE, async (_ctx, pluginId: string) => ({
    plugin: await requirePluginHost(deps).enablePlugin(pluginId),
  }))

  server.handle(RPC_CHANNELS.plugins.DISABLE, async (_ctx, pluginId: string) => ({
    plugin: await requirePluginHost(deps).disablePlugin(pluginId),
  }))

  server.handle(RPC_CHANNELS.plugins.LIST_CAPABILITIES, async () => ({
    capabilities: requirePluginHost(deps).listCapabilities(),
  }))

  server.handle(RPC_CHANNELS.plugins.LIST_ROUTES, async () => requirePluginHost(deps).listRoutes())
  server.handle(RPC_CHANNELS.plugins.LIST_SETTINGS_PANES, async () => requirePluginHost(deps).listSettingsPanes())
  server.handle(RPC_CHANNELS.plugins.LIST_SESSION_ACTIONS, async () => requirePluginHost(deps).listSessionActions())
  server.handle(RPC_CHANNELS.plugins.LIST_COMPOSER_ACTIONS, async () => requirePluginHost(deps).listComposerActions())
  server.handle(RPC_CHANNELS.plugins.LIST_CHAT_CARD_TYPES, async () => requirePluginHost(deps).listChatCardTypes())
}
