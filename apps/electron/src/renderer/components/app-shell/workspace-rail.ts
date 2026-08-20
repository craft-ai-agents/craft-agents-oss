export const COMPACT_VIEWPORT_WIDTH = 768
export const WORKSPACE_ICON_RAIL_WIDTH = 58
/** Top inset so the first rail icon clears macOS traffic lights (x:18,y:16). */
export const TRAFFIC_LIGHT_SAFE_TOP = 40
export const WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT =
  'craft-workspace-selector-rail-changed'

export function shouldShowWorkspaceIconRail(
  workspaceSelectorRailEnabled: boolean,
  viewportWidth: number,
): boolean {
  return (
    workspaceSelectorRailEnabled && viewportWidth >= COMPACT_VIEWPORT_WIDTH
  )
}

export function getTopBarLeftInset(showWorkspaceIconRail: boolean): number {
  return showWorkspaceIconRail ? WORKSPACE_ICON_RAIL_WIDTH : 0
}
