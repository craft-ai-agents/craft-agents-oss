/**
 * Process-local registry so AutomationSystem knowledge executors and the
 * knowledge RPC handler share the same KnowledgeBridgeService instances
 * (proposals/audit paths stay consistent).
 */

import type { KnowledgeBridgeService } from './bridge-service'
import type { KnowledgeProvider } from '@craft-agent/core/knowledge'

type ProviderResolver = (connectionId: string) => Promise<KnowledgeProvider>

const bridges = new Map<string, KnowledgeBridgeService>()
const providerResolvers = new Map<string, ProviderResolver>()

function key(workspaceRoot: string): string {
  return workspaceRoot
}

export function registerKnowledgeBridge(
  workspaceRoot: string,
  bridge: KnowledgeBridgeService,
  providerResolver?: ProviderResolver,
): void {
  bridges.set(key(workspaceRoot), bridge)
  if (providerResolver) {
    providerResolvers.set(key(workspaceRoot), providerResolver)
  }
}

export function getKnowledgeBridge(workspaceRoot: string): KnowledgeBridgeService | undefined {
  return bridges.get(key(workspaceRoot))
}

export function getKnowledgeProviderResolver(
  workspaceRoot: string,
): ProviderResolver | undefined {
  return providerResolvers.get(key(workspaceRoot))
}

/** Register a workspace-scoped provider resolver (even before first bridge). */
export function registerKnowledgeProviderResolver(
  workspaceRoot: string,
  resolver: ProviderResolver,
): void {
  providerResolvers.set(key(workspaceRoot), resolver)
}

export function clearKnowledgeBridgeRegistry(): void {
  bridges.clear()
  providerResolvers.clear()
}
