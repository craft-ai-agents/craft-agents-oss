/** Extract workspace slug from root path (last path component). */
export function extractWorkspaceSlug(rootPath: string, fallbackId: string): string {
  const pathParts = rootPath.split('/').filter(Boolean)
  return pathParts[pathParts.length - 1] || fallbackId
}
