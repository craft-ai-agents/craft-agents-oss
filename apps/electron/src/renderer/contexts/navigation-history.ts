interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  panelRoutes: string[]
  sidebarParam: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

/**
 * Builds a semantic history key used to dedupe pushState entries.
 *
 */
export function buildSemanticHistoryKey({
  workspaceSlug,
  panelRoutes,
  sidebarParam,
}: SemanticHistoryKeyInput): string {
  return [
    workspaceSlug ?? '',
    panelRoutes.join('|'),
    sidebarParam,
  ].join('::')
}

/**
 * Returns whether initial route restoration is allowed to run.
 */
export function canRunInitialRestore({
  isReady,
  isSessionsReady,
  workspaceId,
  initialRouteRestored,
}: InitialRestoreGateInput): boolean {
  return isReady && isSessionsReady && !!workspaceId && !initialRouteRestored
}
