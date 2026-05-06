import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { RPC_CHANNELS, type GitCommit, type GitFileChange, type GitFileChangeStatus, type GitStatusEntry, type GitStatusEntryStatus } from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types'

const execFileAsync = promisify(execFile)
const LOG_LIMIT = 50
const FIELD_SEPARATOR = '\x1f'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.git.GET_LOG,
  RPC_CHANNELS.git.GET_STATUS,
  RPC_CHANNELS.git.GET_FILE_DIFF,
  RPC_CHANNELS.git.GET_COMMIT_DETAIL,
] as const

async function isGitRepository(workspacePath: string): Promise<boolean> {
  try {
    await access(join(workspacePath, '.git'))
    return true
  } catch {
    return false
  }
}

async function runGit(workspacePath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspacePath,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  return stdout.trimEnd()
}

function mapFileChangeStatus(raw: string): GitFileChangeStatus {
  switch (raw[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'modified'
  }
}

function parseNumstatLine(line: string): Omit<GitFileChange, 'status'> | null {
  const [additionsRaw, deletionsRaw, ...pathParts] = line.split('\t')
  const path = pathParts.join('\t')
  if (!path) return null

  return {
    path,
    additions: Number.parseInt(additionsRaw, 10) || 0,
    deletions: Number.parseInt(deletionsRaw, 10) || 0,
  }
}

function parseNameStatus(output: string): Map<string, GitFileChangeStatus> {
  const statuses = new Map<string, GitFileChangeStatus>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const [statusRaw, ...pathParts] = line.split('\t')
    const path = pathParts[pathParts.length - 1]
    if (path) statuses.set(path, mapFileChangeStatus(statusRaw ?? ''))
  }
  return statuses
}

function parseLog(output: string): GitCommit[] {
  if (!output.trim()) return []

  const commits: GitCommit[] = []
  const chunks = output.split('\n')

  for (const chunk of chunks) {
    const header = chunk.startsWith('commit ') ? chunk.slice('commit '.length) : chunk
    const [hash, shortHash, author, date, message] = header.split(FIELD_SEPARATOR)
    if (!hash || !shortHash) continue

    commits.push({
      hash,
      shortHash,
      author: author ?? '',
      date: date ?? '',
      message: message ?? '',
      filesChanged: [],
    })
  }

  return commits
}

async function getFilesChanged(workspacePath: string, commitHash: string): Promise<GitFileChange[]> {
  const [numstat, nameStatus] = await Promise.all([
    runGit(workspacePath, ['show', '--format=', '--numstat', commitHash]),
    runGit(workspacePath, ['show', '--format=', '--name-status', commitHash]),
  ])
  const statuses = parseNameStatus(nameStatus)
  return numstat.split('\n')
    .map(parseNumstatLine)
    .filter((entry): entry is Omit<GitFileChange, 'status'> => entry !== null)
    .map(entry => ({
      ...entry,
      status: statuses.get(entry.path) ?? 'modified',
    }))
}

function mapStatus(index: string, worktree: string): GitStatusEntryStatus {
  if (index === '?' && worktree === '?') return 'untracked'
  if (index !== ' ' && index !== '?') return 'staged'
  if (worktree === 'D') return 'deleted'
  return 'modified'
}

function parseStatus(output: string): GitStatusEntry[] {
  if (!output.trim()) return []

  return output.split('\n')
    .map((line) => {
      const index = line[0] ?? ' '
      const worktree = line[1] ?? ' '
      const rawPath = line.slice(3)
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath
      return {
        path,
        status: mapStatus(index, worktree),
      }
    })
    .filter(entry => entry.path.length > 0)
}

async function getGitLog(workspacePath: string): Promise<GitCommit[]> {
  if (!await isGitRepository(workspacePath)) return []
  const output = await runGit(workspacePath, [
    'log',
    `--max-count=${LOG_LIMIT}`,
    `--pretty=format:commit %H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s`,
  ])
  const commits = parseLog(output)
  return Promise.all(commits.map(async commit => ({
    ...commit,
    filesChanged: await getFilesChanged(workspacePath, commit.hash),
  })))
}

async function getGitStatus(workspacePath: string): Promise<GitStatusEntry[]> {
  if (!await isGitRepository(workspacePath)) return []
  return parseStatus(await runGit(workspacePath, ['status', '--porcelain']))
}

async function getGitFileDiff(workspacePath: string, filePath: string): Promise<string> {
  if (!await isGitRepository(workspacePath)) return ''
  const diff = await runGit(workspacePath, ['diff', '--', filePath])
  if (diff.trim()) return diff
  return runGit(workspacePath, ['diff', '--cached', '--', filePath])
}

async function getGitCommitDetail(workspacePath: string, commitHash: string): Promise<GitCommit | null> {
  if (!await isGitRepository(workspacePath)) return null
  const commits = parseLog(await runGit(workspacePath, [
    'show',
    '--format=format:commit %H%x1f%h%x1f%an%x1f%cI%x1f%s',
    '--no-ext-diff',
    commitHash,
  ]))

  const commit = commits[0]
  if (!commit) return null

  const changed = await getFilesChanged(workspacePath, commit.hash)
  const filesChanged = await Promise.all(changed.map(async (file) => ({
    ...file,
    diff: await runGit(workspacePath, ['show', '--format=', '--no-ext-diff', commitHash, '--', file.path]),
  })))

  return { ...commit, filesChanged }
}

export function registerGitHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.git.GET_LOG, async (_ctx, workspacePath: string) => getGitLog(workspacePath))
  server.handle(RPC_CHANNELS.git.GET_STATUS, async (_ctx, workspacePath: string) => getGitStatus(workspacePath))
  server.handle(RPC_CHANNELS.git.GET_FILE_DIFF, async (_ctx, workspacePath: string, filePath: string) => getGitFileDiff(workspacePath, filePath))
  server.handle(RPC_CHANNELS.git.GET_COMMIT_DETAIL, async (_ctx, workspacePath: string, commitHash: string) => getGitCommitDetail(workspacePath, commitHash))
}
