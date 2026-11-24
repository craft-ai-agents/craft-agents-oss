/**
 * Coding mode's "Create new worktree": the repositories a new session can start a worktree from,
 * and the request/result of creating one. Pure types, safe to import from the renderer.
 *
 * Server: packages/server-core/src/services/coding-repos/ (RPCs `git:listRepos`, `git:createWorktree`).
 */

/** A repository on the workspace server's disk; its worktrees are grouped into one entry. */
export interface LocalRepo {
  kind: 'local'
  /** Display name: the GitHub repo name when the origin is on a git host, else the folder name */
  name: string
  /** `owner/repo` of the origin remote, when it is a recognizable git host URL */
  nameWithOwner?: string
  /** Shared git dir (`.git` or a bare repo): identifies the repository */
  gitDir: string
  /** Folder new worktrees are created next to */
  worktreeParent: string
  /** Number of checked-out worktrees (1 for a plain clone) */
  worktrees: number
  /** Why it is listed: one of the recently used folders, or found by the scan of the workspace folder and the folders holding recent repos (`workspace`) */
  origin: 'workspace' | 'recent'
}

/** A repository the GitHub CLI lists for the signed-in user that is not on this machine yet. */
export interface GitHubRepo {
  kind: 'github'
  nameWithOwner: string
  description?: string
  isPrivate: boolean
  /** Epoch ms */
  updatedAt?: number
}

export interface RepoListing {
  local: LocalRepo[]
  github: GitHubRepo[]
  /** Where a GitHub repo is cloned before its worktree is created (shown in the picker) */
  cloneRoot: string | null
  /** `gh` is missing or not signed in (the GitHub section explains instead of listing) */
  githubUnavailable?: 'not-installed' | 'not-signed-in'
}

export interface CreateWorktreeRequest {
  /** A local repository (its `gitDir`) … */
  gitDir?: string
  /** … or a GitHub repository to clone first */
  cloneNameWithOwner?: string
  /** New branch for the worktree */
  branch: string
}

export interface CreateWorktreeResult {
  /** The new worktree folder: becomes the session's working directory */
  path: string
  branch: string
  /** What it branched from, e.g. `origin/main` */
  base: string
  /** True when the GitHub repo was cloned first */
  cloned: boolean
}
