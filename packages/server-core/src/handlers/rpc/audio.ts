import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RpcServer } from '@archstudio/server-core/transport'
import {
  RPC_CHANNELS,
  type AudioJobStartResult,
  type AudioJobStatus,
  type AudioJobState,
  type AudioProcessRequest,
  type BeatRenderRequest,
  type StemSplitRequest,
} from '@archstudio/shared/protocol'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.media.STEM_SPLIT,
  RPC_CHANNELS.media.BEAT_RENDER,
  RPC_CHANNELS.media.AUDIO_PROCESS,
  RPC_CHANNELS.media.AUDIO_JOB_STATUS,
] as const

interface AudioJob {
  jobId: string
  state: AudioJobState
  progress: number
  stage?: string
  outputs?: Record<string, string>
  output?: string
  error?: string
  startedAt: number
  finishedAt?: number
  process?: ChildProcess
}

const jobs = new Map<string, AudioJob>()

const AUDIO_TOOLS_DIR = join(process.cwd(), 'tools', 'audio')
const DEFAULT_OUTPUT_ROOT = join(process.cwd(), 'audio-output')

function resolvePython(): string {
  return process.env.AUDIO_PYTHON?.trim() || 'python'
}

function resolveOutputRoot(): string {
  return process.env.AUDIO_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT
}

function parseProgressLine(line: string, job: AudioJob): void {
  try {
    const data = JSON.parse(line)
    if (typeof data.progress === 'number') job.progress = data.progress
    if (typeof data.stage === 'string') job.stage = data.stage
    if (data.stems && typeof data.stems === 'object') {
      job.outputs = data.stems as Record<string, string>
    }
    if (typeof data.output === 'string') job.output = data.output
    if (data.stage === 'done') {
      job.state = 'completed'
      job.progress = 1.0
      job.finishedAt = Date.now()
    }
  } catch {
    // Not JSON — ignore (diagnostic output)
  }
}

function parseErrorLine(line: string, job: AudioJob): boolean {
  try {
    const data = JSON.parse(line)
    if (data.error) {
      job.state = 'failed'
      job.error = data.error
      job.finishedAt = Date.now()
      return true
    }
  } catch {
    // Non-JSON on stderr — treat as error text
    if (line.trim()) {
      job.state = 'failed'
      job.error = line.trim().slice(0, 500)
      job.finishedAt = Date.now()
      return true
    }
  }
  return false
}

function spawnAudioTool(
  args: string[],
  deps: HandlerDeps,
  onProgress?: (job: AudioJob) => void,
): AudioJob {
  const jobId = randomUUID()
  const job: AudioJob = {
    jobId,
    state: 'running',
    progress: 0,
    startedAt: Date.now(),
  }

  const python = resolvePython()
  const child = spawn(python, args, {
    cwd: AUDIO_TOOLS_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  job.process = child
  jobs.set(jobId, job)

  let errorBuffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      parseProgressLine(line, job)
      onProgress?.(job)
    }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    errorBuffer += chunk.toString()
    for (const line of errorBuffer.split(/\r?\n/)) {
      if (!line.trim()) continue
      if (parseErrorLine(line, job)) {
        deps.platform.logger.warn('Audio tool error', { jobId, error: job.error })
        onProgress?.(job)
      }
    }
    errorBuffer = errorBuffer.split(/\r?\n/).pop() ?? ''
  })

  child.on('error', (err) => {
    job.state = 'failed'
    job.error = err.message
    job.finishedAt = Date.now()
    deps.platform.logger.error('Audio tool spawn failed', { jobId, error: err.message })
    onProgress?.(job)
  })

  child.on('close', (code) => {
    if (code !== 0 && job.state !== 'failed' && job.state !== 'completed') {
      job.state = 'failed'
      job.error = `Process exited with code ${code}`
      job.finishedAt = Date.now()
    }
    if (job.state === 'running') {
      job.state = 'completed'
      job.progress = 1.0
      job.finishedAt = Date.now()
    }
    job.process = undefined
    onProgress?.(job)
  })

  return job
}

export function registerAudioHandlers(server: RpcServer, deps: HandlerDeps): void {
  const outputRoot = resolveOutputRoot()

  server.handle(RPC_CHANNELS.media.STEM_SPLIT, async (ctx, request: StemSplitRequest): Promise<AudioJobStartResult> => {
    if (!request?.inputPath) throw new Error('inputPath is required')

    const job = spawnAudioTool(
      [
        'stem_splitter.py',
        '--input', request.inputPath,
        '--model', request.model ?? 'htdemucs',
        '--output-dir', outputRoot,
        '--job-id', randomUUID().slice(0, 8),
      ],
      deps,
    )
    deps.platform.logger.info('Started stem split', { jobId: job.jobId, input: request.inputPath })
    return { jobId: job.jobId }
  })

  server.handle(RPC_CHANNELS.media.BEAT_RENDER, async (ctx, request: BeatRenderRequest): Promise<AudioJobStartResult> => {
    if (!request?.tracks?.length) throw new Error('At least one track is required')
    if (!request.bpm) throw new Error('bpm is required')

    const pattern = JSON.stringify({
      bpm: request.bpm,
      bars: request.bars ?? 1,
      steps: request.steps ?? 16,
      tracks: request.tracks,
    })
    const outputFile = join(outputRoot, 'beats', `${randomUUID().slice(0, 8)}.wav`)

    const job = spawnAudioTool(
      [
        'audio_processor.py',
        '--operation', 'beat',
        '--pattern', pattern,
        '--output', outputFile,
      ],
      deps,
    )
    deps.platform.logger.info('Started beat render', { jobId: job.jobId, bpm: request.bpm })
    return { jobId: job.jobId }
  })

  server.handle(RPC_CHANNELS.media.AUDIO_PROCESS, async (ctx, request: AudioProcessRequest): Promise<AudioJobStartResult> => {
    if (!request?.operation) throw new Error('operation is required')

    const args: string[] = ['audio_processor.py', '--operation', request.operation]
    const outputFile = request.outputPath ?? join(outputRoot, 'processed', `${randomUUID().slice(0, 8)}.wav`)

    switch (request.operation) {
      case 'stretch':
        if (!request.inputPath) throw new Error('inputPath is required for stretch')
        if (!request.ratio) throw new Error('ratio is required for stretch')
        args.push('--input', request.inputPath, '--output', outputFile, '--ratio', String(request.ratio))
        break
      case 'transpose':
        if (!request.inputPath) throw new Error('inputPath is required for transpose')
        if (request.semitones === undefined) throw new Error('semitones is required for transpose')
        args.push('--input', request.inputPath, '--output', outputFile, '--semitones', String(request.semitones))
        break
      case 'trim':
        if (!request.inputPath) throw new Error('inputPath is required for trim')
        if (!request.duration) throw new Error('duration is required for trim')
        args.push('--input', request.inputPath, '--output', outputFile, '--start', String(request.start ?? 0), '--duration', String(request.duration))
        break
      case 'normalize':
        if (!request.inputPath) throw new Error('inputPath is required for normalize')
        args.push('--input', request.inputPath, '--output', outputFile)
        break
      case 'mix':
        if (!request.mixInputs?.length) throw new Error('mixInputs is required for mix')
        args.push('--inputs', JSON.stringify(request.mixInputs), '--output', outputFile)
        break
      default:
        throw new Error(`Unknown operation: ${request.operation}`)
    }

    const job = spawnAudioTool(args, deps)
    deps.platform.logger.info('Started audio process', { jobId: job.jobId, operation: request.operation })
    return { jobId: job.jobId }
  })

  server.handle(RPC_CHANNELS.media.AUDIO_JOB_STATUS, async (ctx, request: { jobId: string }): Promise<AudioJobStatus> => {
    if (!request?.jobId) throw new Error('jobId is required')
    const job = jobs.get(request.jobId)
    if (!job) {
      return {
        jobId: request.jobId,
        state: 'unknown',
        progress: 0,
        error: 'Job not found',
      }
    }
    return {
      jobId: job.jobId,
      state: job.state,
      progress: job.progress,
      stage: job.stage,
      outputs: job.outputs,
      output: job.output,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  })
}