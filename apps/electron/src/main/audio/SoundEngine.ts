/**
 * SoundEngine — Core singleton managing sound notification playback.
 *
 * Uses a temporary-file BrowserWindow with nodeIntegration: true for
 * rock-solid IPC. No preload, no data: URL quirks, no contextIsolation.
 * Electron's IPC handles all the complexity.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { CespCategory, SoundPack, SoundSettings } from '@craft-agent/shared/audio'
import { DEFAULT_SOUND_SETTINGS } from '@craft-agent/shared/audio'
import { loadPreferences, updatePreferences as updatePrefs } from '@craft-agent/shared/config'
import { discoverPacks, resolveCategory, pickRandomSound } from './PackLoader.js'

// ---------------------------------------------------------------------------
// Sentinel pack name — means "silence all sounds for this session"
// ---------------------------------------------------------------------------

export const NO_SOUND_PACK = '__none__'

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
// Minimal HTML player — loaded from a temp file for reliable origin + preload
// ---------------------------------------------------------------------------

const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head><title>Sound Player</title></head>
<body>
<div id="status" style="font-size:10px;font-family:monospace;" >Initializing...</div>
<script>
(function() {
  const { ipcRenderer } = require('electron');

  let currentAudio = null;
  let currentUrl = null;
  let masterVolume = 0.8;
  const status = document.getElementById('status');

  function setStatus(msg) {
    if (status) status.textContent = msg;
    console.log('[SoundPlayer]', msg);
  }

  function getMimeType(ext) {
    switch (ext) {
      case '.mp3': return 'audio/mpeg';
      case '.ogg': return 'audio/ogg';
      case '.oga': return 'audio/ogg';
      case '.wav': return 'audio/wav';
      default: return 'audio/mpeg';
    }
  }

  function playSound(data, volume, ext) {
    try {
      setStatus('Received ' + data.length + ' bytes, ext=' + ext);

      // Stop previous audio
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }

      const mimeType = getMimeType(ext || '');
      const blob = new Blob([data], { type: mimeType });
      currentUrl = URL.createObjectURL(blob);
      const audio = new Audio(currentUrl);
      audio.volume = volume * masterVolume;
      setStatus('Created Audio(' + mimeType + ') vol=' + audio.volume);

      audio.onended = function() {
        URL.revokeObjectURL(currentUrl);
        currentAudio = null; currentUrl = null;
        setStatus('Playback ended');
      };

      audio.onerror = function() {
        URL.revokeObjectURL(currentUrl);
        currentAudio = null; currentUrl = null;
        setStatus('Playback error: ' + (audio.error ? audio.error.message : 'unknown'));
      };

      audio.oncanplay = function() {
        setStatus('Can play — starting playback');
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(function() {
          setStatus('Playback started successfully');
        }).catch(function(err) {
          setStatus('PLAY PROMISE REJECTED: ' + (err.message || String(err)));
          URL.revokeObjectURL(currentUrl);
          currentAudio = null; currentUrl = null;
        });
      } else {
        setStatus('play() returned undefined (old API?)');
      }

      currentAudio = audio;
    } catch (err) {
      setStatus('playSound() JS error: ' + (err.message || String(err)));
    }
  }

  function setVolume(v) {
    masterVolume = Math.max(0, Math.min(1, v));
    if (currentAudio) currentAudio.volume = masterVolume;
    setStatus('Volume set to ' + masterVolume);
  }

  ipcRenderer.on('sound:play', function(event, data, volume, ext) {
    setStatus('IPC sound:play received — data.length=' + data.length);
    playSound(data, volume, ext);
  });

  ipcRenderer.on('sound:set-volume', function(event, v) {
    setStatus('IPC sound:set-volume received');
    setVolume(v);
  });

  // Signal ready
  setStatus('Ready');
  ipcRenderer.send('sound:ready');
})();
</script>
</body>
</html>`

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
  private tempHtmlPath: string | null = null
  private ipcReadyHandler: any = null
  private ipcErrorHandler: any = null

  // Per-session active pack
  private sessionPacks = new Map<string, string>()

  // Tracks whether init() has completed (packs discovered, player window created)
  private initialized = false
  // Queue of play requests made before init() completed
  private pendingInitPlays: Array<{ category: CespCategory; sessionId?: string }> = []

  constructor() {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    console.info('[sound] === SoundEngine.init() starting ===')

    // Load persisted settings from preferences.json
    try {
      const prefs = loadPreferences()
      if (prefs.sound) {
        this.settings = { ...DEFAULT_SOUND_SETTINGS, ...prefs.sound }
        console.info(`[sound] Loaded persisted settings: enabled=${this.settings.enabled} volume=${this.settings.volume} defaultPack=${this.settings.defaultPack}`)
      }
    } catch (err) {
      console.warn('[sound] Failed to load persisted settings, using defaults:', err)
    }

    this.packs = await discoverPacks()
    console.info(`[sound] Discovered ${this.packs.size} packs`)

    await this.createPlayerWindow()

    this.initialized = true
    console.info(`[sound] === Initialized with ${this.packs.size} packs: ${[...this.packs.keys()].join(', ')} ===`)

    // Drain any play requests that were queued before init completed
    if (this.pendingInitPlays.length > 0) {
      console.info(`[sound] Draining ${this.pendingInitPlays.length} queued play requests`)
      for (const { category, sessionId } of this.pendingInitPlays) {
        this.play(category, sessionId).catch(() => {})
      }
      this.pendingInitPlays = []
    }
  }

  private async createPlayerWindow(): Promise<void> {
    // Write HTML to a temp file for reliable file:// origin
    const tempDir = join(tmpdir(), 'craft-agents-sound-player')
    await mkdir(tempDir, { recursive: true })
    this.tempHtmlPath = join(tempDir, 'sound-player.html')
    await writeFile(this.tempHtmlPath, PLAYER_HTML, 'utf-8')
    console.info('[sound] Created temp HTML at:', this.tempHtmlPath)

    this.playerWindow = new BrowserWindow({
      width: 300,
      height: 150,
      show: false,
      skipTaskbar: true,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: true,        // allow require('electron') in HTML
        contextIsolation: false,      // needed for nodeIntegration to work
        backgroundThrottling: false,  // keep audio processing alive
      },
    })

    this.playerWindow.setMenu(null)

    // Auto-restart on crash
    this.playerWindow.on('closed', () => {
      console.warn('[sound] Player window closed')
      this.playerWindow = null
      this.ready = false
      // Clean up temp file
      this.cleanupTempFile()
      // Restart after 2s
      setTimeout(() => this.createPlayerWindow().catch(err => {
        console.error('[sound] Failed to restart player window:', err)
      }), 2000)
    })

    // Handle IPC
    this.ipcReadyHandler = (_event: any) => {
      console.info('[sound] Player window reported READY')
      this.ready = true
      // Set volume
      this.playerWindow?.webContents.send('sound:set-volume', this.settings.volume)
      // Play queued
      for (const p of this.pendingPlays) {
        console.info('[sound] Sending queued sound:', p.filePath)
        this.playerWindow?.webContents.send('sound:play', p.data, p.volume, p.ext)
      }
      this.pendingPlays = []
    }
    ipcMain.on('sound:ready', this.ipcReadyHandler)

    this.ipcErrorHandler = (_event: any, err: string) => {
      console.error('[sound] Player window error:', err)
    }
    ipcMain.on('sound:player-error', this.ipcErrorHandler)

    // Load the temp HTML file
    const fileUrl = 'file://' + this.tempHtmlPath.replace(/\\/g, '/')
    console.info('[sound] Loading player URL:', fileUrl)

    this.playerWindow.webContents.on('did-finish-load', () => {
      console.info('[sound] Player window did-finish-load')
    })

    this.playerWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[sound] Player window FAILED to load:', errorCode, errorDescription)
    })

    await this.playerWindow.loadURL(fileUrl)
    console.info('[sound] BrowserWindow.loadURL() returned for:', fileUrl)
  }

  private cleanupTempFile(): void {
    if (this.tempHtmlPath) {
      try {
        const { unlinkSync } = require('node:fs')
        unlinkSync(this.tempHtmlPath)
      } catch {
        // ignore cleanup errors
      }
      this.tempHtmlPath = null
    }
  }

  async dispose(): Promise<void> {
    if (this.ipcReadyHandler) {
      ipcMain.off('sound:ready', this.ipcReadyHandler)
      this.ipcReadyHandler = null
    }
    if (this.ipcErrorHandler) {
      ipcMain.off('sound:player-error', this.ipcErrorHandler)
      this.ipcErrorHandler = null
    }
    if (this.playerWindow) {
      this.playerWindow.close()
      this.playerWindow = null
    }
    this.ready = false
    this.cleanupTempFile()
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
    // Persist to preferences.json
    try {
      updatePrefs({ sound: settings })
    } catch (err) {
      console.error('[sound] Failed to persist settings:', err)
    }
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
    if (packName) this.sessionPacks.set(sessionId, packName)
    else this.sessionPacks.delete(sessionId)
  }

  /** Remove all session-specific state (call after session is deleted). */
  removeSession(sessionId: string): void {
    this.sessionPacks.delete(sessionId)
  }

  private getActivePack(sessionId?: string): SoundPack | undefined {
    // 0. Explicit "no sounds" sentinel — skip all playback for this session
    if (sessionId) {
      const sp = this.sessionPacks.get(sessionId)
      if (sp === NO_SOUND_PACK) return undefined // explicitly no pack
    }
    // 1. Try session-specific pack
    if (sessionId) {
      const sp = this.sessionPacks.get(sessionId)
      if (sp) {
        const p = this.packs.get(sp)
        if (p) return p
        console.warn(`[sound] Session pack '${sp}' not found for session ${sessionId}, falling back`)
      }
    }
    // 2. Try global default pack
    const defaultPack = this.packs.get(this.settings.defaultPack)
    if (defaultPack) return defaultPack
    // 3. Fall back to first available pack
    const first = [...this.packs.values()][0]
    if (first) return first
    return undefined
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  async play(category: CespCategory, sessionId?: string): Promise<void> {
    console.info(`[sound] === play() called: category=${category} sessionId=${sessionId} ===`)

    // If init() hasn't completed yet (packs not discovered), queue the request
    // instead of silently dropping it.
    if (!this.initialized) {
      console.info(`[sound] Not yet initialized, queuing ${category} for later`)
      this.pendingInitPlays.push({ category, sessionId })
      return
    }

    if (!this.settings.enabled) {
      console.info('[sound] Skipped: sound notifications disabled globally')
      return
    }

    const catSettings = this.settings.categories[category]
    if (catSettings && !catSettings.enabled) {
      console.info(`[sound] Skipped: category ${category} disabled`)
      return
    }

    if (!this.cooldownTracker.canPlay(category, this.settings.cooldownMs)) {
      console.info(`[sound] Skipped: category ${category} on cooldown`)
      return
    }

    // Check for explicit "no sounds" sentinel before resolving pack
    if (sessionId) {
      const sp = this.sessionPacks.get(sessionId)
      if (sp === NO_SOUND_PACK) {
        console.info(`[sound] Skipped: session ${sessionId} has No Sounds selected`)
        return
      }
    }

    const pack = this.getActivePack(sessionId)
    if (!pack) {
      console.info(`[sound] No active pack for session ${sessionId}`)
      return
    }

    if (catSettings?.overrideFilePath) {
      console.info(`[sound] Using override file: ${catSettings.overrideFilePath}`)
      await this.playFile(catSettings.overrideFilePath, catSettings.volume ?? this.settings.volume)
      this.cooldownTracker.record(category)
      return
    }

    const categoryDef = resolveCategory(pack.manifest, category)
    if (!categoryDef || categoryDef.sounds.length === 0) {
      // If the active pack doesn't have this category, try falling back to the default pack
      // This handles cases where custom packs don't include extended categories like session.end
      if (pack.name !== 'default') {
        const defaultPack = this.packs.get('default')
        if (defaultPack) {
          const defaultCatDef = resolveCategory(defaultPack.manifest, category)
          if (defaultCatDef && defaultCatDef.sounds.length > 0) {
            console.info(`[sound] Category ${category} not in pack ${pack.name}, falling back to default pack`)
            const lastFile2 = this.lastPlayedFile
            const result2 = pickRandomSound(defaultCatDef, defaultPack.directory, lastFile2)
            if (result2) {
              this.lastPlayedFile = result2.entry.file
              console.info(`[sound] Playing ${category} from default pack: ${result2.filePath}`)
              await this.playFile(result2.filePath, catSettings?.volume ?? this.settings.volume)
              this.cooldownTracker.record(category)
              return
            }
          }
        }
      }
      console.warn(`[sound] Category ${category} has no sounds in pack ${pack.name} (and no default fallback)`)
      return
    }

    const lastFile = this.settings.noRepeat ? this.lastPlayedFile : null
    const result = pickRandomSound(categoryDef, pack.directory, lastFile)
    if (!result) {
      console.warn(`[sound] No sound picked for ${category}`)
      return
    }

    this.lastPlayedFile = result.entry.file
    console.info(`[sound] Playing ${category}: ${result.filePath}`)
    await this.playFile(result.filePath, catSettings?.volume ?? this.settings.volume)
    this.cooldownTracker.record(category)
  }

  async playTest(filePath: string): Promise<void> {
    console.info(`[sound] === playTest() called: ${filePath} ===`)
    if (!this.playerWindow) {
      console.warn('[sound] playTest: NO player window exists')
      return
    }
    console.info(`[sound] playTest: ready=${this.ready} destroyed=${this.playerWindow?.isDestroyed()}`)
    await this.playFile(filePath, this.settings.volume)
  }

  checkSpam(): boolean {
    return this.spamDetector.check()
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async playFile(filePath: string, volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(1, volume))
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    console.info(`[sound] playFile: ${filePath} ext=${ext} vol=${clampedVolume}`)

    try {
      const buf = await readFile(filePath)
      console.info(`[sound] Read ${buf.length} bytes from ${filePath}`)
      const data = new Uint8Array(buf)
      console.info(`[sound] Created Uint8Array length=${data.length}`)

      if (!this.ready || !this.playerWindow || this.playerWindow.isDestroyed()) {
        console.info('[sound] Player not ready, queuing sound')
        this.pendingPlays.push({ data, filePath, volume: clampedVolume, ext })
        return
      }

      console.info(`[sound] Sending sound:play IPC with ${data.length} bytes`)
      this.playerWindow.webContents.send('sound:play', data, clampedVolume, ext)
      console.info('[sound] IPC sent successfully')
    } catch (err) {
      console.error(`[sound] FAILED to read/play ${filePath}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: SoundEngine | null = null

export function getSoundEngine(): SoundEngine {
  if (!instance) instance = new SoundEngine()
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