import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export type RemotePlatform = 'linux' | 'darwin'
export type RemoteArch = 'x64' | 'arm64'

export interface RemoteTarget {
  platform: RemotePlatform
  arch: RemoteArch
}

/** Parse the output of `uname -sm` into a supported target, or throw. */
export function parseUnameTarget(unameOutput: string): RemoteTarget {
  const parts = unameOutput.trim().split(/\s+/)
  const sys = (parts[0] ?? '').toLowerCase()
  const machine = (parts[1] ?? '').toLowerCase()

  let platform: RemotePlatform
  if (sys === 'linux') platform = 'linux'
  else if (sys === 'darwin') platform = 'darwin'
  else throw new Error(`Unsupported remote OS "${parts[0] || 'unknown'}" (only Linux and macOS are supported).`)

  let arch: RemoteArch
  if (machine === 'x86_64' || machine === 'amd64') arch = 'x64'
  else if (machine === 'arm64' || machine === 'aarch64') arch = 'arm64'
  else throw new Error(`Unsupported remote architecture "${parts[1] || 'unknown'}" (only x64 and arm64 are supported).`)

  return { platform, arch }
}

/** Locate the monorepo root by walking up until a root package.json + scripts/ is found. */
function findRepoRoot(): string | undefined {
  // The main process is bundled to CJS (import.meta.url undefined) — prefer
  // __dirname, fall back to import.meta.url for direct ts execution (e.g. bun test).
  let dir =
    typeof __dirname !== 'undefined' && __dirname
      ? __dirname
      : dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'scripts', 'build-server.ts')) && existsSync(join(dir, 'package.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** App version, used to name/cache artifacts (mirrors build-server.ts). */
function readAppVersion(repoRoot: string): string {
  try {
    const pkg = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs').readFileSync(join(repoRoot, 'apps', 'electron', 'package.json'), 'utf-8'),
    ) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export interface ResolveArtifactDeps {
  /** Whether the app is running packaged (no build toolchain available). */
  isPackaged: boolean
  /** Run `bun run scripts/build-server.ts ...` for a target. Injectable for tests;
   * resolves on exit 0, rejects otherwise. */
  runBuild?: (repoRoot: string, args: string[]) => Promise<void>
  /** existsSync override for tests. */
  fileExists?: (path: string) => boolean
}

function defaultRunBuild(repoRoot: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', 'scripts/build-server.ts', ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (c) => {
      stderr = (stderr + String(c)).slice(-4000)
    })
    proc.once('error', (err) => reject(new Error(`Failed to run server build: ${err.message}`)))
    proc.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Server build failed (exit ${code ?? 'null'}). ${stderr.trim()}`))
    })
  })
}

export interface ResolvedArtifact {
  /** Absolute path to the .tar.gz on the local machine. */
  archivePath: string
  /** Basename of the archive (used for the remote filename). */
  archiveName: string
  version: string
}

/** Ensure a server artifact for `target` exists locally and return its path.
 * Reuses a cached artifact matching the current app version; otherwise builds. */
export async function resolveServerArtifact(
  target: RemoteTarget,
  deps: ResolveArtifactDeps,
): Promise<ResolvedArtifact> {
  const fileExists = deps.fileExists ?? existsSync
  const runBuild = deps.runBuild ?? defaultRunBuild

  const repoRoot = findRepoRoot()
  if (!repoRoot) {
    // TODO(packaged-bootstrap): no monorepo/build toolchain in a packaged app.
    // Ship or download prebuilt per-target artifacts and return that path here.
    throw new Error(
      'One-click server install is only available in development builds right now. ' +
        'Use "Connect to remote server" to connect to a server you started manually.',
    )
  }

  if (deps.isPackaged) {
    // TODO(packaged-bootstrap): same as above — resolve a bundled/downloaded
    // artifact instead of building. Building requires the dev toolchain.
    throw new Error(
      'One-click server install is not yet supported in packaged builds. ' +
        'Use "Connect to remote server" to connect to a server you started manually.',
    )
  }

  const version = readAppVersion(repoRoot)
  const archiveName = `craft-server-${version}-${target.platform}-${target.arch}.tar.gz`
  // build-server.ts writes the archive next to the output dir; use a per-target
  // dir under dist/ so parallel targets don't clash — archive lands at dist/<archiveName>.
  const outputRel = join('dist', `server-${target.platform}-${target.arch}`)
  const archivePath = join(repoRoot, 'dist', archiveName)

  if (!fileExists(archivePath)) {
    await runBuild(repoRoot, [
      `--platform=${target.platform}`,
      `--arch=${target.arch}`,
      `--output=${outputRel}`,
      '--compress',
    ])
    if (!fileExists(archivePath)) {
      throw new Error(`Server build completed but artifact was not found at ${archivePath}.`)
    }
  }

  return { archivePath, archiveName, version }
}
