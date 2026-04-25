/**
 * SoundEngine — Core singleton managing sound notification playback.
 *
 * Uses a hidden BrowserWindow with Web Audio API for reliable cross-platform
 * audio playback. Electron's UtilityProcess does NOT have access to browser
 * APIs (AudioContext, GainNode), so a BrowserWindow is required.
 *
 * Architecture:
 *   Main process (SoundEngine):
 *     - Manages state: packs, settings, cooldowns, spam detection
 *     - Reads audio files from disk
 *     - Sends ArrayBuffer data + metadata to the player window via IPC
 *   Hidden BrowserWindow (sound-player HTML):
 *     - Receives audio data via IPC
 *     - Decodes and plays using Web Audio API
 *     - Reports status back via IPC
 */

import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { CespCategory, SoundPack, SoundSettings } from '@craft-agent/shared/audio'
import { DEFAULT_SOUND_SETTINGS } from '@craft-agent/shared/audio'
import { discoverPacks, resolveCategory, pickRandomSound } from './PackLoader.js'

// ---------------------------------------------------------------------------
// Cooldown Tracker
// ---------------------------------------------------------------------------

class CooldownTracker {
  private lastPlayedAt = new Map<CespCategory, number>()

  canPlay(category: CespCategory, cooldownMs: number): boolean {
    const last = this.lastPlayedAt.get(category)
    if (last === undefined) return true
    return Date.now() - last >= cooldownMs
  }

  record(category: CespCategory): void {
    this.lastPlayedAt.set(category, Date.now())
  }
}

// ---------------------------------------------------------------------------
// Spam Detector (for user.spam category)
// ---------------------------------------------------------------------------

class SpamDetector {
  private timestamps: number[] = []
  private readonly threshold = 3 // 3 prompts
  private readonly windowMs = 10000 // in 10 seconds

  check(): boolean {
    const now = Date.now()
    this.timestamps.push(now)
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    return this.timestamps.length >= this.threshold
  }

  reset(): void {
    this.timestamps = []
  }
}

// ---------------------------------------------------------------------------
// SoundEngine
// ---------------------------------------------------------------------------

export class SoundEngine {
  private playerWindow: BrowserWindow | null = null
  private packs = new Map<string, SoundPack>()
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS }
  private cooldownTracker = new CooldownTracker()
  private spamDetector = new SpamDetector()
  private lastPlayedFile: string | null = null
  private ready = false
  private pendingPlays: Array<{ data: ArrayBuffer; filePath: string; volume: number }> = []

  // Per-session active pack
  private sessionPacks = new Map<string, string>() // sessionId → packName

  constructor() {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    // Discover available packs
    this.packs = await discoverPacks()

    // Create the hidden audio player window
    this.createPlayerWindow()

    console.info(`[sound] Initialized with ${this.packs.size} packs: ${[...this.packs.keys()].join(', ')}`)
  }

  private createPlayerWindow(): void {
    const preloadPath = join(__dirname, 'sound-player-preload.cjs')

    this.playerWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    })

    this.playerWindow.setMenu(null)

    // Auto-restart on crash
    this.playerWindow.on('closed', () => {
      this.playerWindow = null
      this.ready = false
      setTimeout(() => this.createPlayerWindow(), 2000)
    })

    // Handle IPC from the audio player
    this.playerWindow.webContents.ipc.on('sound:ready', () => {
      this.ready = true
      console.info('[sound] Audio player window ready')
      // Set initial volume
      this.playerWindow?.webContents.send('sound:set-volume', this.settings.volume)
      // Play any queued sounds
      for (const { data, filePath, volume } of this.pendingPlays) {
        this.playerWindow?.webContents.send('sound:play-buffer', filePath, data, volume)
      }
      this.pendingPlays = []
    })

    this.playerWindow.webContents.ipc.on('sound:error', (_event, error: string) => {
      console.error('[sound] Audio player error:', error)
    })

    // Load minimal HTML with Web Audio player
    this.playerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PLAYER_HTML)}`)
  }

  async dispose(): Promise<void> {
    if (this.playerWindow) {
      this.playerWindow.close()
      this.playerWindow = null
    }
    this.ready = false
  }

  // -----------------------------------------------------------------------
  // Pack Management
  // -----------------------------------------------------------------------

  async refreshPacks(): Promise<SoundPack[]> {
    this.packs = await discoverPacks()
    return [...this.packs.values()]
  }

  getPacks(): SoundPack[] {
    return [...this.packs.values()]
  }

  getPack(name: string): SoundPack | undefined {
    return this.packs.get(name)
  }

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  updateSettings(settings: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...settings }

    // Push volume to audio player
    if (settings.volume !== undefined && this.ready && this.playerWindow) {
      this.playerWindow.webContents.send('sound:set-volume', settings.volume)
    }
  }

  getSettings(): SoundSettings {
    return { ...this.settings }
  }

  // -----------------------------------------------------------------------
  // Session Pack Tracking
  // -----------------------------------------------------------------------

  setSessionPack(sessionId: string, packName: string | undefined): void {
    if (packName) {
      this.sessionPacks.set(sessionId, packName)
    } else {
      this.sessionPacks.delete(sessionId)
    }
  }

  private getActivePack(sessionId?: string): SoundPack | undefined {
    if (sessionId) {
      const sessionPack = this.sessionPacks.get(sessionId)
      if (sessionPack) {
        const pack = this.packs.get(sessionPack)
        if (pack) return pack
      }
    }
    return this.packs.get(this.settings.defaultPack)
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  /**
   * Play a sound for a CESP event category.
   */
  async play(category: CespCategory, sessionId?: string): Promise<void> {
    if (!this.settings.enabled) return

    const catSettings = this.settings.categories[category]
    if (catSettings && !catSettings.enabled) return

    if (!this.cooldownTracker.canPlay(category, this.settings.cooldownMs)) return

    const pack = this.getActivePack(sessionId)
    if (!pack) {
      console.warn(`[sound] No active pack found for session ${sessionId}`)
      return
    }

    // Check for per-category override file
    if (catSettings?.overrideFilePath) {
      await this.playFile(catSettings.overrideFilePath, catSettings.volume ?? this.settings.volume)
      this.cooldownTracker.record(category)
      return
    }

    const categoryDef = resolveCategory(pack.manifest, category)
    if (!categoryDef || categoryDef.sounds.length === 0) return

    const lastFile = this.settings.noRepeat ? this.lastPlayedFile : null
    const result = pickRandomSound(categoryDef, pack.directory, lastFile)
    if (!result) return

    this.lastPlayedFile = result.entry.file
    await this.playFile(result.filePath, catSettings?.volume ?? this.settings.volume)
    this.cooldownTracker.record(category)
  }

  /**
   * Play a test sound (from settings page).
   */
  async playTest(filePath: string): Promise<void> {
    if (!this.playerWindow && !this.ready) {
      console.warn('[sound] playTest called but audio player is not ready')
      return
    }
    console.info(`[sound] Playing test: ${filePath}`)
    await this.playFile(filePath, this.settings.volume)
  }

  /**
   * Check if user input constitutes spam (rapid-fire).
   */
  checkSpam(): boolean {
    return this.spamDetector.check()
  }

  // -----------------------------------------------------------------------
  // Internal: Read file and send to player window
  // -----------------------------------------------------------------------

  private async playFile(filePath: string, volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(1, volume))

    try {
      const data = await readFile(filePath)

      if (!this.ready || !this.playerWindow || this.playerWindow.isDestroyed()) {
        // Queue the sound if player isn't ready yet
        this.pendingPlays.push({ data: data.buffer, filePath, volume: clampedVolume })
        return
      }

      this.playerWindow.webContents.send('sound:play-buffer', filePath, data.buffer, clampedVolume)
    } catch (err) {
      console.error(`[sound] Failed to read audio file: ${filePath}`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// HTML for the hidden audio player BrowserWindow
// ---------------------------------------------------------------------------

const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head><title>Sound Player</title></head>
<body>
<script>
// Web Audio API setup
let audioCtx = null;
let masterGain = null;
const cache = new Map();

function ensureAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

async function playFromBuffer(filePath, arrayBuffer, volume) {
  try {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    let buffer = cache.get(filePath);
    if (!buffer) {
      buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      cache.set(filePath, buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const playGain = ctx.createGain();
    playGain.gain.value = volume;
    source.connect(playGain);
    playGain.connect(masterGain);
    source.start();
  } catch (err) {
    window.electronAPI.onPlayError(err.message || String(err));
  }
}

// Listen for IPC commands from main process via preload
window.electronAPI.onPlayCommand((filePath, volume) => {
  // Legacy path — not used, main process sends buffers directly
});

window.electronAPI.onSetVolume((v) => {
  if (masterGain) masterGain.gain.value = v;
});

window.electronAPI.onClearCache(() => {
  cache.clear();
});

// Handle buffer-based playback from main process
// (The preload exposes this as window.electronAPI.onPlayBuffer)
if (window.electronAPI.onPlayBuffer) {
  window.electronAPI.onPlayBuffer((filePath, buffer, volume) => {
    playFromBuffer(filePath, buffer, volume);
  });
}

// Signal ready
window.electronAPI.signalReady();
</script>
</body>
</html>`

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: SoundEngine | null = null

export function getSoundEngine(): SoundEngine {
  if (!instance) {
    instance = new SoundEngine()
  }
  return instance
}

export async function initSoundEngine(): Promise<SoundEngine> {
  const engine = getSoundEngine()
  await engine.init()
  return engine
}

export async function disposeSoundEngine(): Promise<void> {
  if (instance) {
    await instance.dispose()
    instance = null
  }
}