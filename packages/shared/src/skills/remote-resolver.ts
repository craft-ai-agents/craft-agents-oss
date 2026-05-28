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
        metadata: isRecord(parsed.data.metadata) ? parsed.data.metadata : undefined,
      },
      body: parsed.content,
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INACCESSIBLE_ERROR =
  'This repository is not accessible. Make sure it is public, or use the Upload tab to install from a zip file.'
const GITHUB_RATE_LIMIT_ERROR =
  'GitHub API rate limit reached. Try again later, use a GitHub-authenticated session if available, or use the Upload tab to install from a zip file.'
const GITHUB_RATE_LIMIT_BODY_MARKERS = [
  'rate limit',
  'secondary rate',
  'abuse detection',
  'abuse limit',
]
const MAX_SKILL_DIRECTORY_DEPTH = 3

// ── GitHub API ────────────────────────────────────────────────────────────────

type GhContent = {
  name: string
  type: 'file' | 'dir'
  path: string
  download_url?: string
}

type GhContentsResult =
  | { ok: true; entries: GhContent[] }
  | { ok: false; error: string }

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

function formatGithubRateLimitResetDetail(res: Response): string {
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  if (!Number.isFinite(reset) || reset <= 0) return ''
  return ` Retry after ${new Date(reset * 1000).toISOString()}.`
}

function isGithubRateLimitResponse(res: Response, body: string): boolean {
  const lowerBody = body.toLowerCase()
  return (
    res.headers.get('x-ratelimit-remaining') === '0' ||
    GITHUB_RATE_LIMIT_BODY_MARKERS.some(marker => lowerBody.includes(marker))
  )
}

async function githubForbiddenMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  if (!isGithubRateLimitResponse(res, body)) return INACCESSIBLE_ERROR
  return `${GITHUB_RATE_LIMIT_ERROR}${formatGithubRateLimitResetDetail(res)}`
}

async function listGhContents(owner: string, repo: string, path: string): Promise<GhContentsResult> {
  const res = await ghApiGet(`repos/${owner}/${repo}/contents/${path}`)
  if (res.status === 403) return { ok: false, error: await githubForbiddenMessage(res) }
  if (res.status === 404) return { ok: false, error: INACCESSIBLE_ERROR }
  if (!res.ok) return { ok: true, entries: [] }
  const data = await res.json() as GhContent | GhContent[]
  return { ok: true, entries: Array.isArray(data) ? data : [data] }
}

async function resolveGithubRepo(owner: string, repo: string): Promise<RemoteResolveResult> {
  const rootContents = await listGhContents(owner, repo, '')
  if (!rootContents.ok) return { error: rootContents.error }

  const rootEntries = rootContents.entries

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

  const skills: DiscoveredSkill[] = []

  async function scanDir(dir: GhContent, depth: number): Promise<string | null> {
    if (depth > MAX_SKILL_DIRECTORY_DEPTH) return null

    const contents = await listGhContents(owner, repo, dir.path)
    if (!contents.ok) return contents.error

    const entries = contents.entries

    const skillMd = entries.find(e => e.type === 'file' && e.name === 'SKILL.md')
    if (skillMd?.download_url) {
      const raw = await fetchGithubSkillMd(skillMd.download_url)
      if (raw) {
        const parsed = parseSkillMd(raw)
        if (parsed) {
          skills.push({
            slug: dir.name,
            metadata: parsed.metadata,
            content: parsed.body,
            sourcePath: `https://github.com/${owner}/${repo}/tree/HEAD/${dir.path}`,
          })
          return null
        }
      }
    }

    for (const child of entries.filter(e => e.type === 'dir')) {
      const error = await scanDir(child, depth + 1)
      if (error) return error
    }

    return null
  }

  for (const dir of rootEntries.filter(e => e.type === 'dir')) {
    const error = await scanDir(dir, 1)
    if (error) return { error }
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
  if (res.status === 403) return { error: await githubForbiddenMessage(res) }
  if (res.status === 404) return { error: INACCESSIBLE_ERROR }
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

  async function scanDir(dir: GlTreeEntry, depth: number): Promise<void> {
    if (depth > MAX_SKILL_DIRECTORY_DEPTH) return

    const entries = await listGlTree(projectId, dir.path)
    if (!entries) return

    const skillMd = entries.find(e => e.type === 'blob' && e.name === 'SKILL.md')
    if (skillMd) {
      const raw = await fetchGlFile(projectId, skillMd.path)
      if (raw) {
        const parsed = parseSkillMd(raw)
        if (parsed) {
          skills.push({
            slug: dir.name,
            metadata: parsed.metadata,
            content: parsed.body,
            sourcePath: `https://gitlab.com/${owner}/${repo}/-/tree/HEAD/${dir.path}`,
          })
          return
        }
      }
    }

    for (const child of entries.filter(e => e.type === 'tree')) {
      await scanDir(child, depth + 1)
    }
  }

  for (const dir of rootEntries.filter(e => e.type === 'tree')) {
    await scanDir(dir, 1)
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
    function scanDir(currentDir: string, slug: string, depth: number): void {
      if (depth > MAX_SKILL_DIRECTORY_DEPTH) return
      if (trySkillMd(join(currentDir, 'SKILL.md'), slug, currentDir)) return

      try {
        const entries = readdirSync(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          scanDir(join(currentDir, entry.name), entry.name, depth + 1)
        }
      } catch { /* skip unreadable dirs */ }
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      scanDir(join(dir, entry.name), entry.name, 1)
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
