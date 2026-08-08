import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export interface SplitStemsArgs {
  inputPath: string
  model?: string
}

const AUDIO_TOOLS_DIR = resolve(process.cwd(), 'tools', 'audio')
const DEFAULT_OUTPUT_ROOT = resolve(process.cwd(), 'audio-output')

function resolvePython(): string {
  return process.env.AUDIO_PYTHON?.trim() || 'python'
}

function resolveOutputRoot(): string {
  return process.env.AUDIO_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT
}

export async function handleSplitStems(
  ctx: SessionToolContext,
  args: SplitStemsArgs
): Promise<ToolResult> {
  if (!args?.inputPath) {
    return errorResponse('inputPath is required')
  }

  const inputPath = resolve(args.inputPath)
  if (!existsSync(inputPath)) {
    return errorResponse(`Input file not found: ${args.inputPath}`)
  }

  if (!existsSync(AUDIO_TOOLS_DIR)) {
    return errorResponse(`Audio tools not found at ${AUDIO_TOOLS_DIR}. Run from the ARCHstudio repo root.`)
  }

  const outputRoot = resolveOutputRoot()
  const jobId = randomUUID().slice(0, 8)
  const outputDir = join(outputRoot, jobId)
  mkdirSync(outputDir, { recursive: true })

  return new Promise<ToolResult>((resolvePromise) => {
    const python = resolvePython()
    const child = spawn(python, [
      'stem_splitter.py',
      '--input', inputPath,
      '--model', args.model ?? 'htdemucs',
      '--output-dir', outputRoot,
      '--job-id', jobId,
    ], {
      cwd: AUDIO_TOOLS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stems: Record<string, string> | null = null
    let errorMsg: string | null = null

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.stems) stems = data.stems as Record<string, string>
        } catch { /* not JSON */ }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.error) errorMsg = data.error
        } catch {
          if (!errorMsg) errorMsg = line.trim().slice(0, 500)
        }
      }
    })

    child.on('error', (err) => {
      resolvePromise(errorResponse(`Failed to spawn stem splitter: ${err.message}. Ensure Python + Demucs are installed (pip install -r tools/audio/requirements.txt).`))
    })

    child.on('close', (code) => {
      if (code !== 0 && !stems) {
        resolvePromise(errorResponse(errorMsg ?? `Stem splitter exited with code ${code}. Ensure Python + Demucs are installed (pip install -r tools/audio/requirements.txt).`))
        return
      }
      if (!stems) {
        resolvePromise(errorResponse('Stem splitter completed but produced no output'))
        return
      }
      resolvePromise(successResponse(
        `Split into ${Object.keys(stems).length} stems:\n` +
        Object.entries(stems).map(([name, path]) => `  ${name}: ${path}`).join('\n'),
        { stems } as unknown as Record<string, unknown>,
      ))
    })
  })
}