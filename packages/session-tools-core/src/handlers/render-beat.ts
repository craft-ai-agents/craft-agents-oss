import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export interface RenderBeatArgs {
  bpm: number
  bars?: number
  steps?: number
  tracks: Array<{
    name: string
    sample: string
    steps: number[]
    volume?: number
    freq?: number
  }>
}

const AUDIO_TOOLS_DIR = resolve(process.cwd(), 'tools', 'audio')
const DEFAULT_OUTPUT_ROOT = resolve(process.cwd(), 'audio-output')

function resolvePython(): string {
  return process.env.AUDIO_PYTHON?.trim() || 'python'
}

export async function handleRenderBeat(
  ctx: SessionToolContext,
  args: RenderBeatArgs
): Promise<ToolResult> {
  if (!args?.bpm) return errorResponse('bpm is required')
  if (!args?.tracks?.length) return errorResponse('At least one track is required')

  if (!existsSync(AUDIO_TOOLS_DIR)) {
    return errorResponse(`Audio tools not found at ${AUDIO_TOOLS_DIR}. Run from the ARCHstudio repo root.`)
  }

  const outputRoot = process.env.AUDIO_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT
  const beatsDir = join(outputRoot, 'beats')
  mkdirSync(beatsDir, { recursive: true })
  const outputFile = join(beatsDir, `${randomUUID().slice(0, 8)}.wav`)

  const pattern = JSON.stringify({
    bpm: args.bpm,
    bars: args.bars ?? 1,
    steps: args.steps ?? 16,
    tracks: args.tracks,
  })

  return new Promise<ToolResult>((resolvePromise) => {
    const python = resolvePython()
    const child = spawn(python, [
      'audio_processor.py',
      '--operation', 'beat',
      '--pattern', pattern,
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
        `Beat rendered at ${args.bpm} BPM with ${args.tracks.length} tracks to:\n  ${outputPath}`,
        { output: outputPath } as unknown as Record<string, unknown>,
      ))
    })
  })
}