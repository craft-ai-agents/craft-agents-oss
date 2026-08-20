import type { HandlerDeps } from './handler-deps'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { registerCoreRpcHandlers, type ServerHandlerContext } from '@craft-agent/server-core/handlers/rpc'
export { registerCoreRpcHandlers }

// GUI-only handlers remain local (Electron-specific imports)
import { registerSystemGuiHandlers } from './system'
import { registerWorkspaceGuiHandlers } from './workspace'
import { registerBrowserHandlers } from './browser'
import { registerSettingsGuiHandlers } from './settings'
import { registerSiyuanHandlers } from './siyuan'
import { registerExtensionHostHandlers } from './extension-host'
import { registerExtensionSurfaceHandlers } from './extension-surface'
import { setGithubUserToolHost } from '@craft-agent/shared/connections'
import { createGithubEnvImportHost, registerWorkGraphHandlers } from './workgraph'
import type { WorkGraphKernel } from '@craft-agent/server-core/workgraph'

export function registerGuiRpcHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerSystemGuiHandlers(server, deps)
  registerWorkspaceGuiHandlers(server, deps)
  registerBrowserHandlers(server, deps)
  registerSettingsGuiHandlers(server, deps)
  registerSiyuanHandlers(server, deps)
  registerExtensionHostHandlers(server, deps)
  registerExtensionSurfaceHandlers(server, deps)
}

export function registerAllRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
  workGraph?: WorkGraphKernel,
): void {
  // GUI registers its own browser-pane handlers (see ./browser) — they are a
  // superset of the core ones plus window-stamping and the empty-state LAUNCH
  // channel. Registering both copies makes the RpcServer throw on duplicate
  // channels and the app fails to boot.
  registerCoreRpcHandlers(server, deps, serverCtx, { browserPane: false })
  registerGuiRpcHandlers(server, deps)
  if (workGraph) {
    const fabric = createGithubEnvImportHost()
    registerWorkGraphHandlers(server, workGraph, fabric)
    setGithubUserToolHost({
      getKernel: () => workGraph,
      getBroker: () => fabric.broker,
      getProvider: () => fabric.provider,
      fetchImpl: fabric.fetchImpl,
    })
  }
}
