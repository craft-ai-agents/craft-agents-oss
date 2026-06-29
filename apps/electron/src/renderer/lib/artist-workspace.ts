export interface ArtistWorkspaceLike {
  id: string
  name: string
  slug?: string
}

export function isArtistHQWorkspace(
  workspace: ArtistWorkspaceLike | undefined,
  workspaces: ArtistWorkspaceLike[],
): boolean {
  if (!workspace) return false
  const text = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
  if (/\b(master|artist hq|global|hq|home)\b/.test(text)) return true
  return workspaces[0]?.id === workspace.id
}
