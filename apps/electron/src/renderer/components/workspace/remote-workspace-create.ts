import { slugify } from "@/lib/slugify"

/** Resolve a unique local workspace slug by appending suffixes if needed.
 * Tries: baseName → baseName-remote → baseName-2 → baseName-3 → ... */
export async function resolveUniqueSlug(baseName: string): Promise<{ slug: string; path: string }> {
  const baseSlug = slugify(baseName)
  if (!baseSlug) return { slug: 'remote', path: '' }

  let slug = baseSlug
  let attempt = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await window.electronAPI.checkWorkspaceSlug(slug)
    if (!result.exists) {
      return { slug, path: result.path }
    }
    attempt++
    slug = attempt === 1 ? `${baseSlug}-remote` : `${baseSlug}-${attempt}`
    if (attempt > 20) {
      // Safety valve — shouldn't happen in practice
      return {
        slug: `${baseSlug}-${Date.now()}`,
        path: result.path.replace(baseSlug, `${baseSlug}-${Date.now()}`),
      }
    }
  }
}

export interface RemoteServerBinding {
  url: string
  token: string
  remoteWorkspaceId: string
  /** Set for SSH-backed workspaces: makes the SSH host the durable identity so reconnects
   * re-establish a fresh tunnel instead of dialing the (now dead) ephemeral `url`. */
  sshHostId?: string
}

/** Create (or reuse) a workspace on the remote server and resolve the local folder path + remote binding.
 * With `remoteWorkspaceId`, connects to that existing remote workspace; otherwise creates a new one named `name`. */
export async function prepareRemoteWorkspace(args: {
  url: string
  token: string
  name: string
  homeDir: string
  remoteWorkspaceId?: string
  /** When set, the created workspace is SSH-backed and durably bound to this host. */
  sshHostId?: string
}): Promise<{ folderPath: string; name: string; remoteServer: RemoteServerBinding }> {
  const { url, token, name, homeDir, sshHostId } = args
  const defaultBasePath = `${homeDir}/.craft-agent/workspaces`

  let remoteWorkspaceId = args.remoteWorkspaceId
  let workspaceName = name
  if (!remoteWorkspaceId) {
    const created = (await window.electronAPI.invokeOnServer(
      url,
      token,
      'server:createWorkspace',
      name,
    )) as { id: string; name: string }
    remoteWorkspaceId = created.id
    workspaceName = created.name || name
  }

  const { slug, path } = await resolveUniqueSlug(workspaceName)
  const folderPath = path || `${defaultBasePath}/${slug}`
  return {
    folderPath,
    name: workspaceName,
    remoteServer: { url, token, remoteWorkspaceId, ...(sshHostId ? { sshHostId } : {}) },
  }
}
