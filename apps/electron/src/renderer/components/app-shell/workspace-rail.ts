export const COMPACT_VIEWPORT_WIDTH = 768
export const WORKSPACE_ICON_RAIL_WIDTH = 58
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
