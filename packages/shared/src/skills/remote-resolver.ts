import { execFile } from 'child_process'
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import matter from 'gray-matter'
import type { DiscoveredSkill, SkillMetadata } from './types.ts'

const execFileAsync = promisify(execFile)

export type RemoteResolveResult = DiscoveredSkill[] | { error: string }

// ── URL parsing ───────────────────────────────────────────────────────────────

type ParsedInput =
  | { kind: 'github-repo'; owner: string; repo: string }
  | { kind: 'github-subpath'; owner: string; repo: string; ref: string; subpath: string }
  | { kind: 'gitlab-repo'; owner: string; repo: string }
  | { kind: 'git-clone'; url: string }

export function parseRemoteInput(input: string): ParsedInput {
  const trimmed = input.trim()

  // GitHub direct subpath (must check before github-repo to avoid partial match)
  const githubSubpath = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/
  )
  if (githubSubpath) {
    return {
      kind: 'github-subpath',
      owner: githubSubpath[1]!,
      repo: githubSubpath[2]!,
      ref: githubSubpath[3]!,
      subpath: githubSubpath[4]!,
    }
  }

  // Full GitHub URL
  const githubRepo = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  )
  if (githubRepo) {
    return { kind: 'github-repo', owner: githubRepo[1]!, repo: githubRepo[2]! }
  }

  // Full GitLab URL
  const gitlabRepo = trimmed.match(
    /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  )
  if (gitlabRepo) {
    return { kind: 'gitlab-repo', owner: gitlabRepo[1]!, repo: gitlabRepo[2]! }
  }

  // owner/repo shorthand (exactly one slash, no protocol)
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) {
    return { kind: 'github-repo', owner: shorthand[1]!, repo: shorthand[2]! }
  }

  return { kind: 'git-clone', url: trimmed }
}

// ── SKILL.md parsing ──────────────────────────────────────────────────────────

function parseSkillMd(raw: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(raw)
    if (!parsed.data.name || !parsed.data.description) return null
    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon: parsed.data.icon as string | undefined,
      },
      body: parsed.content,
    }
  } catch {
    return null
  }
}

const INACCESSIBLE_ERROR =
  'This repository is not accessible. Make sure it is public, or use the Upload tab to install from a zip file.'

// ── GitHub API ────────────────────────────────────────────────────────────────

type GhContent = {
  name: string
  type: 'file' | 'dir'
  path: string
  download_url?: string
}

async function ghApiGet(path: string): Promise<Response> {
  return fetch(`https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
}

async function fetchGithubSkillMd(downloadUrl: string): Promise<string | null> {
  const res = await fetch(downloadUrl)
  if (!res.ok) return null
  return res.text()
}

async function listGhContents(owner: string, repo: string, path: string): Promise<GhContent[] | null> {
  const res = await ghApiGet(`repos/${owner}/${repo}/contents/${path}`)
  if (res.status === 403 || res.status === 404) return null
  if (!res.ok) return []
  const data = await res.json() as GhContent | GhContent[]
  return Array.isArray(data) ? data : [data]
}

async function resolveGithubRepo(owner: string, repo: string): Promise<RemoteResolveResult> {
  const rootEntries = await listGhContents(owner, repo, '')
  if (rootEntries === null) return { error: INACCESSIBLE_ERROR }

  // Check root for SKILL.md first
  const rootSkillMd = rootEntries.find(e => e.type === 'file' && e.name === 'SKILL.md')
  if (rootSkillMd?.download_url) {
    const raw = await fetchGithubSkillMd(rootSkillMd.download_url)
    if (raw) {
      const parsed = parseSkillMd(raw)
      if (parsed) {
        return [{
          slug: repo,
          metadata: parsed.metadata,
          content: parsed.body,
          sourcePath: `https://github.com/${owner}/${repo}`,
        }]
      }
    }
  }

  // Scan up to 2 directory levels deep
  const skills: DiscoveredSkill[] = []
  const depth1Dirs = rootEntries.filter(e => e.type === 'dir')

  for (const dir1 of depth1Dirs) {
    const depth1Entries = await listGhContents(owner, repo, dir1.path)
    if (!depth1Entries) continue

    const skillMd1 = depth1Entries.find(e => e.type === 'file' && e.name === 'SKILL.md')
    if (skillMd1?.download_url) {
      const raw = await fetchGithubSkillMd(skillMd1.download_url)
      if (raw) {
        const parsed = parseSkillMd(raw)
        if (parsed) {
          skills.push({
            slug: dir1.name,
            metadata: parsed.metadata,
            content: parsed.body,
            sourcePath: `https://github.com/${owner}/${repo}/tree/HEAD/${dir1.path}`,
          })
          continue
        }
      }
    }

    // Check depth-2 subdirectories
    const depth2Dirs = depth1Entries.filter(e => e.type === 'dir')
    for (const dir2 of depth2Dirs) {
      const depth2Entries = await listGhContents(owner, repo, dir2.path)
      if (!depth2Entries) continue

      const skillMd2 = depth2Entries.find(e => e.type === 'file' && e.name === 'SKILL.md')
      if (skillMd2?.download_url) {
        const raw = await fetchGithubSkillMd(skillMd2.download_url)
        if (raw) {
          const parsed = parseSkillMd(raw)
          if (parsed) {
            skills.push({
              slug: dir2.name,
              metadata: parsed.metadata,
              content: parsed.body,
              sourcePath: `https://github.com/${owner}/${repo}/tree/HEAD/${dir2.path}`,
            })
          }
        }
      }
    }
  }

  return skills
}

async function resolveGithubSubpath(
  owner: string,
  repo: string,
  ref: string,
  subpath: string
): Promise<RemoteResolveResult> {
  const rawUrl =
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${subpath}/SKILL.md`
  const res = await fetch(rawUrl)
  if (res.status === 403 || res.status === 404) return { error: INACCESSIBLE_ERROR }
  if (!res.ok) return { error: `Failed to fetch skill: HTTP ${res.status}` }

  const raw = await res.text()
  const parsed = parseSkillMd(raw)
  if (!parsed) return { error: 'No valid SKILL.md found at the specified path.' }

  const slug = basename(subpath)
  return [{
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    sourcePath: `https://github.com/${owner}/${repo}/tree/${ref}/${subpath}`,
  }]
}

// ── GitLab API ────────────────────────────────────────────────────────────────

type GlTreeEntry = {
  name: string
  type: 'blob' | 'tree'
  path: string
}

async function glApiGet(projectId: string, apiPath: string): Promise<Response> {
  return fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/${apiPath}`)
}

async function listGlTree(projectId: string, path: string): Promise<GlTreeEntry[] | null> {
  const pathParam = path ? `&path=${encodeURIComponent(path)}` : ''
  const res = await glApiGet(projectId, `repository/tree?ref=HEAD${pathParam}`)
  if (res.status === 403 || res.status === 404) return null
  if (!res.ok) return []
  return res.json() as Promise<GlTreeEntry[]>
}

async function fetchGlFile(projectId: string, filePath: string): Promise<string | null> {
  const res = await glApiGet(
    projectId,
    `repository/files/${encodeURIComponent(filePath)}/raw?ref=HEAD`
  )
  if (!res.ok) return null
  return res.text()
}

async function resolveGitlabRepo(owner: string, repo: string): Promise<RemoteResolveResult> {
  const projectId = `${owner}/${repo}`

  const rootEntries = await listGlTree(projectId, '')
  if (rootEntries === null) return { error: INACCESSIBLE_ERROR }

  // Check root SKILL.md
  const rootSkillMd = rootEntries.find(e => e.type === 'blob' && e.name === 'SKILL.md')
  if (rootSkillMd) {
    const raw = await fetchGlFile(projectId, 'SKILL.md')
    if (raw) {
      const parsed = parseSkillMd(raw)
      if (parsed) {
        return [{
          slug: repo,
          metadata: parsed.metadata,
          content: parsed.body,
          sourcePath: `https://gitlab.com/${owner}/${repo}`,
        }]
      }
    }
  }

  const skills: DiscoveredSkill[] = []
  const depth1Dirs = rootEntries.filter(e => e.type === 'tree')

  for (const dir1 of depth1Dirs) {
    const depth1Entries = await listGlTree(projectId, dir1.path)
    if (!depth1Entries) continue

    const skillMd1 = depth1Entries.find(e => e.type === 'blob' && e.name === 'SKILL.md')
    if (skillMd1) {
      const raw = await fetchGlFile(projectId, skillMd1.path)
      if (raw) {
        const parsed = parseSkillMd(raw)
        if (parsed) {
          skills.push({
            slug: dir1.name,
            metadata: parsed.metadata,
            content: parsed.body,
            sourcePath: `https://gitlab.com/${owner}/${repo}/-/tree/HEAD/${dir1.path}`,
          })
          continue
        }
      }
    }

    const depth2Dirs = depth1Entries.filter(e => e.type === 'tree')
    for (const dir2 of depth2Dirs) {
      const depth2Entries = await listGlTree(projectId, dir2.path)
      if (!depth2Entries) continue

      const skillMd2 = depth2Entries.find(e => e.type === 'blob' && e.name === 'SKILL.md')
      if (skillMd2) {
        const raw = await fetchGlFile(projectId, skillMd2.path)
        if (raw) {
          const parsed = parseSkillMd(raw)
          if (parsed) {
            skills.push({
              slug: dir2.name,
              metadata: parsed.metadata,
              content: parsed.body,
              sourcePath: `https://gitlab.com/${owner}/${repo}/-/tree/HEAD/${dir2.path}`,
            })
          }
        }
      }
    }
  }

  return skills
}

// ── git clone fallback ────────────────────────────────────────────────────────

function scanLocalSkills(dir: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = []

  function trySkillMd(filePath: string, slug: string, sourcePath: string): boolean {
    if (!existsSync(filePath)) return false
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = parseSkillMd(raw)
      if (!parsed) return false
      skills.push({ slug, metadata: parsed.metadata, content: parsed.body, sourcePath })
      return true
    } catch {
      return false
    }
  }

  if (trySkillMd(join(dir, 'SKILL.md'), basename(dir), dir)) {
    return skills
  }

  try {
    const depth1Entries = readdirSync(dir, { withFileTypes: true })
    for (const d1 of depth1Entries) {
      if (!d1.isDirectory() || d1.name.startsWith('.')) continue
      const d1Path = join(dir, d1.name)
      if (trySkillMd(join(d1Path, 'SKILL.md'), d1.name, d1Path)) continue

      try {
        const depth2Entries = readdirSync(d1Path, { withFileTypes: true })
        for (const d2 of depth2Entries) {
          if (!d2.isDirectory() || d2.name.startsWith('.')) continue
          const d2Path = join(d1Path, d2.name)
          trySkillMd(join(d2Path, 'SKILL.md'), d2.name, d2Path)
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch { /* skip unreadable root */ }

  return skills
}

async function resolveGitClone(url: string): Promise<RemoteResolveResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'skill-resolver-'))
  try {
    await execFileAsync('git', ['clone', '--depth', '1', url, tmpDir], { timeout: 60_000 })
    return scanLocalSkills(tmpDir)
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err)
    return { error: `git clone failed: ${stderr.trim()}` }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ── main entry point ──────────────────────────────────────────────────────────

export async function resolveRemoteSkills(input: string): Promise<RemoteResolveResult> {
  const parsed = parseRemoteInput(input)
  switch (parsed.kind) {
    case 'github-repo':
      return resolveGithubRepo(parsed.owner, parsed.repo)
    case 'github-subpath':
      return resolveGithubSubpath(parsed.owner, parsed.repo, parsed.ref, parsed.subpath)
    case 'gitlab-repo':
      return resolveGitlabRepo(parsed.owner, parsed.repo)
    case 'git-clone':
      return resolveGitClone(parsed.url)
  }
}
