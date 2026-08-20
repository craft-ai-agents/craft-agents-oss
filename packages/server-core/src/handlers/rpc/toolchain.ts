import { getToolchainManager, setToolchainDisabledTools } from '@craft-agent/shared/toolchain-runtime'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ToolName } from '@craft-agent/shared/toolchain'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.toolchain.STATUS,
  RPC_CHANNELS.toolchain.UPDATE,
  RPC_CHANNELS.toolchain.GET_DISABLED,
  RPC_CHANNELS.toolchain.SET_DISABLED,
] as const

export function registerToolchainHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Snapshot of per-tool statuses (no side effects).
  server.handle(RPC_CHANNELS.toolchain.STATUS, async () => {
    return getToolchainManager().status()
  })

  // Force update of a single tool.
  server.handle(RPC_CHANNELS.toolchain.UPDATE, async (_ctx, name: ToolName) => {
    return getToolchainManager().update(name)
  })

  // Disabled default-on tools (seeded from config toolchain.disabled).
  server.handle(RPC_CHANNELS.toolchain.GET_DISABLED, async () => {
    return getToolchainManager().getDisabledTools()
  })

  // Replace disabled list: persist config, sync live manager, restart background ensureAll
  // (вновь включённые default-on инструменты доустанавливаются; прогресс — через STATUS_CHANGED).
  server.handle(RPC_CHANNELS.toolchain.SET_DISABLED, async (_ctx, tools: ToolName[]) => {
    const applied = setToolchainDisabledTools(Array.isArray(tools) ? tools : [])
    void getToolchainManager().ensureAll({ background: true })
    return applied
  })

  // Push install progress to every client (local toolchain — broadcast to all).
  getToolchainManager().onStatusChange((status) => {
    server.push(RPC_CHANNELS.toolchain.STATUS_CHANGED, { to: 'all' }, status)
  })
}
