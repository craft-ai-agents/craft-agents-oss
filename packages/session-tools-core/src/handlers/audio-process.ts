import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export type AudioProcessOperation = 'stretch' | 'transpose' | 'trim' | 'normalize'

export interface AudioProcessArgs {
  operation: AudioProcessOperation
  inputPath: string
  ratio?: number
  semitones?: number
  start?: number
  duration?: number
}

const AUDIO_TOOLS_DIR = resolve(process.cwd(), 'tools', 'audio')
const DEFAULT_OUTPUT_ROOT = resolve(process.cwd(), 'audio-output')

function resolvePython(): string {
  return process.env.AUDIO_PYTHON?.trim() || 'python'
}

export async function handleAudioProcess(
  ctx: SessionToolContext,
  args: AudioProcessArgs
): Promise<ToolResult> {
  if (!args?.operation) return errorResponse('operation is required')
  if (!args?.inputPath) return errorResponse('inputPath is required')

  const inputPath = resolve(args.inputPath)
  if (!existsSync(inputPath)) {
    return errorResponse(`Input file not found: ${args.inputPath}`)
  }

  if (!existsSync(AUDIO_TOOLS_DIR)) {
    return errorResponse(`Audio tools not found at ${AUDIO_TOOLS_DIR}. Run from the ARCHstudio repo root.`)
  }

  const outputRoot = process.env.AUDIO_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT
  const processedDir = join(outputRoot, 'processed')
  mkdirSync(processedDir, { recursive: true })
  const outputFile = join(processedDir, `${randomUUID().slice(0, 8)}.wav`)

  const cmdArgs: string[] = ['audio_processor.py', '--operation', args.operation, '--input', inputPath, '--output', outputFile]

  switch (args.operation) {
    case 'stretch':
      if (!args.ratio) return errorResponse('ratio is required for stretch')
      cmdArgs.push('--ratio', String(args.ratio))
      break
    case 'transpose':
      if (args.semitones === undefined) return errorResponse('semitones is required for transpose')
      cmdArgs.push('--semitones', String(args.semitones))
      break
    case 'trim':
      if (!args.duration) return errorResponse('duration is required for trim')
      cmdArgs.push('--start', String(args.start ?? 0), '--duration', String(args.duration))
      break
    case 'normalize':
      break
    default:
      return errorResponse(`Unknown operation: ${args.operation}`)
  }

  return new Promise<ToolResult>((resolvePromise) => {
    const python = resolvePython()
    const child = spawn(python, cmdArgs, {
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
        `Audio ${args.operation} completed:\n  ${outputPath}`,
        { output: outputPath } as unknown as Record<string, unknown>,
      ))
    })
  })
}