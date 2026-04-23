/**
 * SoundEngine — Core singleton managing sound notification playback.
 *
 * Responsibilities:
 * - Manages the UtilityProcess audio player lifecycle
 * - Tracks active sound pack per session
 * - Enforces cooldowns and no-repeat rules
 * - Dispatches play commands to the audio utility process
 */

import { utilityProcess, app } from 'electron'
import { join } from 'node:path'
import type { UtilityProcess } from 'electron'
import type {
  CespCategory,
  SoundPack,
  SoundSettings,
} from '@craft-agent/shared/audio'
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
  private audioProcess: UtilityProcess | null = null
  private packs = new Map<string, SoundPack>()
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS }
  private cooldownTracker = new CooldownTracker()
  private spamDetector = new SpamDetector()
  private lastPlayedFile: string | null = null

  // Per-session active pack
  private sessionPacks = new Map<string, string>() // sessionId → packName

  constructor() {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    // Discover available packs
    this.packs = await discoverPacks()

    // Spawn the audio utility process
    this.spawnAudioProcess()

    console.info(`[sound] Initialized with ${this.packs.size} packs: ${[...this.packs.keys()].join(', ')}`)
  }

  private spawnAudioProcess(): void {
    const modulePath = join(__dirname, '..', 'utility', 'audio-player.js')
    // Note: In dev, this may need to point to the compiled output.
    // For now, we assume it's compiled alongside the main process.
    try {
      this.audioProcess = utilityProcess.fork(modulePath, [], {
        serviceName: 'audio-player',
      })

      this.audioProcess.on('message', (msg: { type: string; [key: string]: unknown }) => {
        if (msg.type === 'error') {
          console.error('[sound] Audio process error:', msg.error)
        }
      })

      this.audioProcess.on('exit', (code) => {
        console.warn(`[sound] Audio process exited with code ${code} — restarting`)
        this.audioProcess = null
        // Auto-restart after a brief delay
        setTimeout(() => this.spawnAudioProcess(), 1000)
      })
    } catch (err) {
      console.error('[sound] Failed to spawn audio process:', err)
    }
  }

  async dispose(): Promise<void> {
    if (this.audioProcess) {
      this.audioProcess.postMessage({ type: 'stop' })
      this.audioProcess.kill()
      this.audioProcess = null
    }
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

    // Push volume to audio process
    if (settings.volume !== undefined && this.audioProcess) {
      this.audioProcess.postMessage({ type: 'set-volume', volume: settings.volume })
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
    // Session-specific override first
    if (sessionId) {
      const sessionPack = this.sessionPacks.get(sessionId)
      if (sessionPack) {
        const pack = this.packs.get(sessionPack)
        if (pack) return pack
      }
    }
    // Global default
    return this.packs.get(this.settings.defaultPack)
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  /**
   * Play a sound for a CESP event category.
   */
  play(category: CespCategory, sessionId?: string): void {
    if (!this.settings.enabled) return
    if (!this.audioProcess) return

    // Check per-category settings
    const catSettings = this.settings.categories[category]
    if (catSettings && !catSettings.enabled) return

    // Check cooldown
    if (!this.cooldownTracker.canPlay(category, this.settings.cooldownMs)) return

    // Get the active pack
    const pack = this.getActivePack(sessionId)
    if (!pack) {
      console.warn(`[sound] No active pack found for session ${sessionId}`)
      return
    }

    // Check for per-category override file
    if (catSettings?.overrideFilePath) {
      this.playFile(catSettings.overrideFilePath, catSettings.volume ?? this.settings.volume)
      this.cooldownTracker.record(category)
      return
    }

    // Resolve category from pack (considering aliases)
    const categoryDef = resolveCategory(pack.manifest, category)
    if (!categoryDef || categoryDef.sounds.length === 0) return // Silently skip

    // Pick random sound (no-repeat if enabled)
    const lastFile = this.settings.noRepeat ? this.lastPlayedFile : null
    const result = pickRandomSound(categoryDef, pack.directory, lastFile)
    if (!result) return

    this.lastPlayedFile = result.entry.file
    this.playFile(result.filePath, catSettings?.volume ?? this.settings.volume)
    this.cooldownTracker.record(category)
  }

  /**
   * Play a test sound (from settings page).
   */
  playTest(filePath: string): void {
    if (!this.audioProcess) {
      console.warn('[sound] playTest called but audio process is not running')
      return
    }
    console.info(`[sound] Playing test: ${filePath}`)
    this.playFile(filePath, this.settings.volume)
  }

  /**
   * Check if user input constitutes spam (rapid-fire).
   */
  checkSpam(): boolean {
    return this.spamDetector.check()
  }

  private playFile(filePath: string, volume: number): void {
    this.audioProcess?.postMessage({
      type: 'play',
      filePath,
      volume: Math.max(0, Math.min(1, volume)),
    })
  }
}

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
