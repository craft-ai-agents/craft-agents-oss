/**
 * SoundEngine — Core singleton managing sound notification playback.
 *
 * Uses a hidden BrowserWindow with HTMLAudioElement for reliable cross-platform
 * audio playback. Avoids Web Audio API because AudioContext is suspended
 * in hidden windows until user interaction (which never happens).
 *
 * Architecture:
 *   Main process (SoundEngine):
 *     - Manages state: packs, settings, cooldowns, spam detection
 *     - Reads audio files from disk
 *     - Sends Uint8Array data to the player window via IPC
 *   Hidden BrowserWindow (sound-player HTML):
 *     - Receives audio data via IPC
 *     - Creates a Blob URL and plays via new Audio(url).play()
 *     - No AudioContext, no decodeAudioData — Chromium handles everything
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
  private pendingPlays: Array<{ data: Uint8Array; filePath: string; volume: number; ext: string }> = []

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
      console.warn('[sound] Player window closed, restarting in 2s...')
      setTimeout(() => this.createPlayerWindow(), 2000)
    })

    // Listen for player errors
    this.playerWindow.webContents.ipc.on('sound:player-error', (_event, error: string) => {
      console.error('[sound] Audio player error:', error)
    })

    // Player is ready
    this.playerWindow.webContents.ipc.on('sound:ready', () => {
      this.ready = true
      console.info('[sound] Audio player window ready')
      // Set initial volume
      this.playerWindow?.webContents.send('sound:set-volume', this.settings.volume)
      // Play any queued sounds
      for (const { data, filePath, volume, ext } of this.pendingPlays) {
        this.playerWindow?.webContents.send('sound:play', data, volume, ext)
      }
      this.pendingPlays = []
    })

    // Load minimal HTML player
    this.playerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PLAYER_HTML)}`)
      .catch(err => console.error('[sound] Failed to load player HTML:', err))
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
    if (!this.settings.enabled) {
      console.debug(`[sound] Playback skipped: sound notifications disabled`)
      return
    }

    const catSettings = this.settings.categories[category]
    if (catSettings && !catSettings.enabled) {
      console.debug(`[sound] Playback skipped: category ${category} disabled`)
      return
    }

    if (!this.cooldownTracker.canPlay(category, this.settings.cooldownMs)) {
      console.debug(`[sound] Playback skipped: category ${category} on cooldown`)
      return
    }

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
    if (!categoryDef || categoryDef.sounds.length === 0) {
      console.warn(`[sound] Category ${category} has no sounds in pack ${pack.name}`)
      return
    }

    const lastFile = this.settings.noRepeat ? this.lastPlayedFile : null
    const result = pickRandomSound(categoryDef, pack.directory, lastFile)
    if (!result) {
      console.warn(`[sound] No sound picked for category ${category}`)
      return
    }

    this.lastPlayedFile = result.entry.file
    console.info(`[sound] Playing ${category}: ${result.filePath}`)
    await this.playFile(result.filePath, catSettings?.volume ?? this.settings.volume)
    this.cooldownTracker.record(category)
  }

  /**
   * Play a test sound (from settings page).
   */
  async playTest(filePath: string): Promise<void> {
    console.info(`[sound] Playing test: ${filePath}`)
    if (!this.playerWindow) {
      console.warn('[sound] playTest called but player window does not exist')
      return
    }
    if (!this.ready) {
      console.warn('[sound] playTest called but player is not ready yet')
    }
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

    // Extract extension for MIME type detection
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()

    try {
      const buf = await readFile(filePath)
      // Create a standalone Uint8Array copy to avoid Buffer pooling issues
      const data = new Uint8Array(buf)

      if (!this.ready || !this.playerWindow || this.playerWindow.isDestroyed()) {
        // Queue the sound if player isn't ready yet
        console.debug(`[sound] Queuing ${filePath} (player not ready)`)
        this.pendingPlays.push({ data, filePath, volume: clampedVolume, ext })
        return
      }

      console.debug(`[sound] Sending ${data.byteLength} bytes to player: ${filePath}`)
      this.playerWindow.webContents.send('sound:play', data, clampedVolume, ext)
    } catch (err) {
      console.error(`[sound] Failed to read audio file: ${filePath}`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// HTML for the hidden audio player BrowserWindow
// Uses HTMLAudioElement (not Web Audio API) to avoid AudioContext suspension.
// ---------------------------------------------------------------------------

const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head><title>Sound Player</title></head>
<body>
<script>
// Map file extensions to MIME types
function getMimeType(ext) {
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.oga': return 'audio/ogg';
    case '.wav': return 'audio/wav';
    default: return 'audio/mpeg';
  }
}

let currentAudio = null;
let masterVolume = 0.8;

function playSound(uint8Array, volume, ext) {
  try {
    // Stop any currently playing sound
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const mimeType = getMimeType(ext || '');
    const blob = new Blob([uint8Array], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume * masterVolume;

    audio.play().then(() => {
      // Success — nothing to do
    }).catch(err => {
      window.electronAPI.reportError('Playback failed: ' + (err.message || String(err)));
    });

    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      window.electronAPI.reportError('Audio error: ' + (audio.error?.message || 'unknown'));
      if (currentAudio === audio) currentAudio = null;
    };

    currentAudio = audio;
  } catch (err) {
    window.electronAPI.reportError('playSound error: ' + (err.message || String(err)));
  }
}

function setVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  if (currentAudio) currentAudio.volume = masterVolume;
}

// IPC from main process
if (window.electronAPI.onPlay) {
  window.electronAPI.onPlay((data, volume, ext) => {
    playSound(data, volume, ext);
  });
}

if (window.electronAPI.onSetVolume) {
  window.electronAPI.onSetVolume((v) => {
    setVolume(v);
  });
}

// Signal ready to main process
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