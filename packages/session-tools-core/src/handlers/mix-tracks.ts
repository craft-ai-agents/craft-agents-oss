import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export interface MixTracksArgs {
  tracks: Array<{
    path: string
    gain?: number
    pan?: number
  }>
}

const AUDIO_TOOLS_DIR = resolve(process.cwd(), 'tools', 'audio')
const DEFAULT_OUTPUT_ROOT = resolve(process.cwd(), 'audio-output')

function resolvePython(): string {
  return process.env.AUDIO_PYTHON?.trim() || 'python'
}

export async function handleMixTracks(
  ctx: SessionToolContext,
  args: MixTracksArgs
): Promise<ToolResult> {
  if (!args?.tracks?.length) return errorResponse('At least one track is required')
  if (args.tracks.length < 2) return errorResponse('Mixing requires at least 2 tracks')

  for (const track of args.tracks) {
    if (!existsSync(resolve(track.path))) {
      return errorResponse(`Track not found: ${track.path}`)
    }
  }

  if (!existsSync(AUDIO_TOOLS_DIR)) {
    return errorResponse(`Audio tools not found at ${AUDIO_TOOLS_DIR}. Run from the ARCHstudio repo root.`)
  }

  const outputRoot = process.env.AUDIO_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT
  const mixDir = join(outputRoot, 'mixed')
  mkdirSync(mixDir, { recursive: true })
  const outputFile = join(mixDir, `${randomUUID().slice(0, 8)}.wav`)

  const inputsJson = JSON.stringify(args.tracks)

  return new Promise<ToolResult>((resolvePromise) => {
    const python = resolvePython()
    const child = spawn(python, [
      'audio_processor.py',
      '--operation', 'mix',
      '--inputs', inputsJson,
      '--output', outputFile,
    ], {
      cwd: AUDIO_TOOLS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let outputPath: string | null = null
    let errorMsg: string | null = null

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.output) outputPath = data.output
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
      resolvePromise(errorResponse(`Failed to spawn audio processor: ${err.message}. Ensure Python + ffmpeg are installed.`))
    })

    child.on('close', (code) => {
      if (code !== 0 && !outputPath) {
        resolvePromise(errorResponse(errorMsg ?? `Audio processor exited with code ${code}. Ensure ffmpeg is installed.`))
        return
      }
      resolvePromise(successResponse(
        `Mixed ${args.tracks.length} tracks into:\n  ${outputPath}`,
        { output: outputPath } as unknown as Record<string, unknown>,
      ))
    })
  })
}