/**
 * Audio Player — runs in Electron UtilityProcess
 *
 * Uses Chromium's Web Audio API for cross-platform audio playback.
 * Communicates with main process via MessagePort.
 *
 * Supported formats: WAV, MP3, OGG/Opus (Chromium decodes natively)
 */

import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

// ---------------------------------------------------------------------------
// Audio Context & Graph
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null
const cache: Map<string, AudioBuffer> = new Map()
let lastPlayedFile: string | null = null
let activeSources: Set<AudioBufferSourceNode> = new Set()

function ensureAudioContext(): { ctx: AudioContext; gain: GainNode } {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext()
    masterGain = audioContext.createGain()
    masterGain.connect(audioContext.destination)
  }
  return { ctx: audioContext, gain: masterGain! }
}

// ---------------------------------------------------------------------------
// Audio Buffer Loading
// ---------------------------------------------------------------------------

async function loadAudioBuffer(filePath: string): Promise<AudioBuffer> {
  if (cache.has(filePath)) {
    return cache.get(filePath)!
  }

  const { ctx } = ensureAudioContext()
  const buffer = await readFile(filePath)
  const audioBuffer = await ctx.decodeAudioData(buffer.buffer.slice(0))
  cache.set(filePath, audioBuffer)

  // Notify main process of cache size
  parentPort?.postMessage({ type: 'cache:update', size: cache.size })

  return audioBuffer
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

async function playSound(filePath: string, volume: number): Promise<void> {
  const { ctx, gain } = ensureAudioContext()

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }

  const audioBuffer = await loadAudioBuffer(filePath)
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer

  // Per-play volume node
  const playGain = ctx.createGain()
  playGain.gain.value = volume

  source.connect(playGain)
  playGain.connect(gain)

  activeSources.add(source)
  source.start()

  lastPlayedFile = filePath

  source.onended = () => {
    activeSources.delete(source)
    parentPort?.postMessage({ type: 'play:ended', filePath: basename(filePath) })
  }

  parentPort?.postMessage({ type: 'play:started', filePath: basename(filePath) })
}

function stopAll(): void {
  for (const source of activeSources) {
    try {
      source.stop()
    } catch {
      // Already stopped — ignore
    }
  }
  activeSources.clear()
}

function setMasterVolume(volume: number): void {
  if (masterGain) {
    masterGain.gain.value = volume
  }
}

function preloadSound(filePath: string): Promise<void> {
  return loadAudioBuffer(filePath).then(() => {
    parentPort?.postMessage({ type: 'preload:done', filePath: basename(filePath) })
  })
}

function clearCache(): void {
  cache.clear()
  parentPort?.postMessage({ type: 'cache:cleared' })
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

parentPort?.on('message', async (msg: {
  type: string
  filePath?: string
  volume?: number
  [key: string]: unknown
}) => {
  try {
    switch (msg.type) {
      case 'play':
        if (!msg.filePath) throw new Error('Missing filePath')
        await playSound(msg.filePath, msg.volume ?? 1.0)
        break

      case 'stop':
        stopAll()
        break

      case 'set-volume':
        if (typeof msg.volume === 'number') setMasterVolume(msg.volume)
        break

      case 'preload':
        if (!msg.filePath) throw new Error('Missing filePath')
        await preloadSound(msg.filePath)
        break

      case 'clear-cache':
        clearCache()
        break

      case 'get-last-played':
        parentPort?.postMessage({ type: 'last-played', filePath: lastPlayedFile })
        break

      default:
        parentPort?.postMessage({ type: 'error', error: `Unknown message type: ${msg.type}` })
    }
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
      originalType: msg.type,
    })
  }
})

// Signal ready
parentPort?.postMessage({ type: 'ready' })
