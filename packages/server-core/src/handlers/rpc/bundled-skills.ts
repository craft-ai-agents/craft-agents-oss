/**
 * Bundled skill packs RPC (runtime-context-marketplace PRD §7).
 * LOCAL_ONLY: packs live under ~/.agents/skills + config.bundledSkills.disabled.
 */
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getBundledSkillsDisabled, setBundledSkillsDisabled } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  ensureBundledSkills,
  invalidateSkillsCache,
  listBundledSkillPacks,
  resetBundledSkillsInitialized,
} from '@craft-agent/shared/skills'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.bundledSkills.LIST,
  RPC_CHANNELS.bundledSkills.GET_DISABLED,
  RPC_CHANNELS.bundledSkills.SET_DISABLED,
] as const

export function registerBundledSkillsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.bundledSkills.LIST, async () => {
    return listBundledSkillPacks()
  })

  server.handle(RPC_CHANNELS.bundledSkills.GET_DISABLED, async () => {
    return getBundledSkillsDisabled()
  })

  server.handle(RPC_CHANNELS.bundledSkills.SET_DISABLED, async (_ctx, slugs: string[]) => {
    const list = Array.isArray(slugs) ? slugs.filter((s): s is string => typeof s === 'string') : []
    setBundledSkillsDisabled(list)
    // Re-run sync so newly enabled packs install immediately; disabled packs
    // stay on disk (PRD §7.4) but are filtered out of discovery.
    resetBundledSkillsInitialized()
    ensureBundledSkills()
    invalidateSkillsCache()
    const disabled = getBundledSkillsDisabled()
    pushTyped(server, RPC_CHANNELS.bundledSkills.CHANGED, { to: 'all' }, { disabled })
    return disabled
  })
}
