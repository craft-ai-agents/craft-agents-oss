import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000
const DEFAULT_CONVERSION_MAX_BUFFER = 1024 * 1024

export interface OfficeConversionOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

function resolveScriptsDir(env: NodeJS.ProcessEnv): string {
  if (env.CRAFT_SCRIPTS) return env.CRAFT_SCRIPTS
  if (env.CRAFT_BUNDLED_ASSETS_ROOT) return join(env.CRAFT_BUNDLED_ASSETS_ROOT, 'resources', 'scripts')
  return join(process.cwd(), 'apps', 'electron', 'resources', 'scripts')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    return stderr ? `${error.message}: ${stderr}` : error.message
  }
  return String(error)
}

export async function convertOfficeFileToMarkdown(
  inputPath: string,
  outputPath: string,
  options: OfficeConversionOptions = {},
): Promise<void> {
  const env = { ...process.env, ...(options.env ?? {}) }
  const uvPath = env.CRAFT_UV?.trim() || 'uv'
  const scriptPath = join(resolveScriptsDir(env), 'markitdown_cli.py')

  try {
    await access(scriptPath)
  } catch {
    throw new Error(`Document converter script not found: ${scriptPath}`)
  }

  try {
    await execFileAsync(
      uvPath,
      ['run', '--python', '3.12', scriptPath, inputPath, '-o', outputPath],
      {
        env,
        timeout: options.timeoutMs ?? DEFAULT_CONVERSION_TIMEOUT_MS,
        maxBuffer: DEFAULT_CONVERSION_MAX_BUFFER,
      },
    )
  } catch (error) {
    throw new Error(`Document converter failed: ${getErrorMessage(error)}`)
  }
}

