/**
 * Sound Notification RPC Handlers
 *
 * Handles all sound-related RPC channels for the renderer process.
 * Follows the same pattern as settings.ts and system.ts handlers.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import {
  getSoundEngine,
  initSoundEngine,
  getUserPackDirectory,
  validateManifest,
} from '../audio/index.js'
import type { SoundSettings } from '@craft-agent/shared/audio'
import type { SoundPack } from '@craft-agent/shared/audio'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, unlinkSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all sound files from a pack into a flat list. */
function collectAllSounds(pack: SoundPack): { file: string; label?: string }[] {
  const all: { file: string; label?: string }[] = []
  for (const catDef of Object.values(pack.manifest.categories)) {
    if (catDef.sounds?.length) all.push(...catDef.sounds)
  }
  return all
}

/** Pick a sound at a specific index from a pack, wrapping around. Returns absolute path. */
function pickSoundAtIndex(pack: SoundPack, index: number): { filePath: string; total: number } | null {
  const all = collectAllSounds(pack)
  if (all.length === 0) return null
  const wrapped = ((index % all.length) + all.length) % all.length
  return { filePath: join(pack.directory, all[wrapped].file), total: all.length }
}

// ---------------------------------------------------------------------------
// Handler Registration
// ---------------------------------------------------------------------------

export function registerSoundHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get current sound settings
  server.handle(RPC_CHANNELS.sound.GET_SETTINGS, async () => {
    const engine = getSoundEngine()
    return engine.getSettings()
  })

  // Update sound settings
  server.handle(RPC_CHANNELS.sound.SET_SETTINGS, async (_ctx, settings: Partial<SoundSettings>) => {
    const engine = getSoundEngine()
    engine.updateSettings(settings)
    return { success: true }
  })

  // Get all available packs
  server.handle(RPC_CHANNELS.sound.GET_PACKS, async () => {
    const engine = getSoundEngine()
    return engine.getPacks().map(pack => ({
      name: pack.name,
      displayName: pack.displayName,
      version: pack.version,
      directory: pack.directory,
      soundCount: pack.soundCount,
      totalSizeBytes: pack.totalSizeBytes,
      source: pack.source,
      trustTier: pack.trustTier,
      previewSounds: pack.previewSounds,
      description: pack.manifest.description,
      author: pack.manifest.author,
      language: pack.manifest.language,
      categories: Object.keys(pack.manifest.categories),
    }))
  })

  // Set pack for a session
  server.handle(RPC_CHANNELS.sound.SET_PACK, async (_ctx, sessionId: string, packName: string | undefined) => {
    const engine = getSoundEngine()
    engine.setSessionPack(sessionId, packName)

    // Persist to disk and update managed session in memory
    await deps.sessionManager.updateSessionSoundPack(sessionId, packName)

    return { success: true }
  })

  // Browse OpenPeon registry
  server.handle(RPC_CHANNELS.sound.GET_REGISTRY, async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const response = await fetch('https://peonping.github.io/registry/index.json', {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) throw new Error(`Registry fetch failed: ${response.status}`)
      const data = await response.json()
      // Normalize: ensure .packs array exists
      if (!data.packs || !Array.isArray(data.packs)) {
        return { packs: [], error: 'Invalid registry format' }
      }
      return data
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[sound] Registry fetch error:', message)
      return { packs: [], error: `Failed to fetch registry: ${message}` }
    }
  })

  // Install a pack from the registry
  server.handle(RPC_CHANNELS.sound.INSTALL_PACK, async (_ctx, packName: string) => {
    // Fetch registry to get pack metadata
    const response = await fetch('https://peonping.github.io/registry/index.json')
    if (!response.ok) throw new Error(`Registry fetch failed: ${response.status}`)

    const index = await response.json()
    const pack = index.packs?.find((p: { name: string }) => p.name === packName)
    if (!pack) throw new Error(`Pack not found in registry: ${packName}`)

    // Download tarball from GitHub
    const tarballUrl = `https://github.com/${pack.source_repo}/archive/refs/tags/${pack.source_ref}.tar.gz`
    const tarResponse = await fetch(tarballUrl)
    if (!tarResponse.ok) throw new Error(`Download failed: ${tarResponse.status}`)

    // Extract to user pack directory
    const packDir = await getUserPackDirectory()
    const { extractTarball } = await import('../audio/TarExtractor.js')
    await extractTarball(
      await tarResponse.arrayBuffer(),
      packDir,
      packName,
      pack.source_path ?? '.',
    )

    // Validate the installed manifest
    const { readFileSync } = await import('node:fs')
    const manifestPath = join(packDir, packName, 'openpeon.json')
    const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const { valid, errors } = validateManifest(manifestRaw)
    if (!valid) {
      // Clean up invalid pack
      const { rmSync } = await import('node:fs')
      rmSync(join(packDir, packName), { recursive: true, force: true })
      throw new Error(`Invalid manifest: ${errors.join(', ')}`)
    }

    // Refresh packs
    const engine = getSoundEngine()
    await engine.refreshPacks()

    return { success: true, packName }
  })

  // Uninstall a pack
  server.handle(RPC_CHANNELS.sound.UNINSTALL_PACK, async (_ctx, packName: string) => {
    const engine = getSoundEngine()
    const pack = engine.getPack(packName)
    if (!pack) throw new Error(`Pack not found: ${packName}`)
    if (pack.source === 'builtin') throw new Error('Cannot uninstall built-in packs')

    const { rmSync } = await import('node:fs')
    rmSync(pack.directory, { recursive: true, force: true })

    await engine.refreshPacks()
    return { success: true }
  })

  // Preview a pack — cycle through sounds sequentially per click.
  // soundIndex is tracked by the renderer (increments on each click, wraps around).
  // Works for both installed packs (local files) and uninstalled registry packs (downloads from GitHub).
  server.handle(RPC_CHANNELS.sound.PREVIEW_PACK, async (_ctx, packName: string, soundIndex = 0) => {
    const engine = getSoundEngine()

    // Try installed pack first — cycle through all sounds
    const installedPack = engine.getPack(packName)
    if (installedPack) {
      const result = pickSoundAtIndex(installedPack, soundIndex)
      if (result) {
        engine.playTest(result.filePath)
        return { success: true, totalSounds: result.total }
      }
      throw new Error('Pack has no sounds to preview')
    }

    // Not installed — fetch registry data and download a preview sound from GitHub
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const response = await fetch('https://peonping.github.io/registry/index.json', {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) throw new Error(`Registry fetch failed: ${response.status}`)
      const index = await response.json()
      const regPack = index.packs?.find((p: { name: string }) => p.name === packName)
      if (!regPack) throw new Error(`Pack not found in registry: ${packName}`)

      // Use preview_sounds from registry entry (already lists filenames)
      const previewSounds: string[] = regPack.preview_sounds || []
      if (previewSounds.length === 0) throw new Error('Pack has no preview sounds available')

      // Cycle through preview_sounds sequentially (wrapping around)
      const wrapped = ((soundIndex % previewSounds.length) + previewSounds.length) % previewSounds.length
      const soundFile = previewSounds[wrapped]
      const sourceRepo = regPack.source_repo
      const sourceRef = regPack.source_ref || 'main'
      const sourcePath = regPack.source_path || '.'

      // Build raw.githubusercontent.com URL to the sound file
      const rawUrl = `https://raw.githubusercontent.com/${sourceRepo}/${sourceRef}/${sourcePath === '.' ? '' : sourcePath + '/'}sounds/${soundFile}`

      // Download to temp file and play
      const soundResp = await fetch(rawUrl)
      if (!soundResp.ok) {
        // Fallback: try without the sounds/ prefix (some packs may put files at root)
        const fallbackUrl = `https://raw.githubusercontent.com/${sourceRepo}/${sourceRef}/${sourcePath === '.' ? '' : sourcePath + '/'}${soundFile}`
        const fallbackResp = await fetch(fallbackUrl)
        if (!fallbackResp.ok) throw new Error(`Failed to download preview sound: ${soundResp.status}`)
        const tmpFile = join(tmpdir(), `sound-preview-${packName}-${Date.now()}.mp3`)
        writeFileSync(tmpFile, Buffer.from(await fallbackResp.arrayBuffer()))
        try { engine.playTest(tmpFile) } finally {
          setTimeout(() => { try { unlinkSync(tmpFile) } catch {} }, 5000)
        }
        return { success: true, totalSounds: previewSounds.length }
      }

      const tmpFile = join(tmpdir(), `sound-preview-${packName}-${Date.now()}.mp3`)
      writeFileSync(tmpFile, Buffer.from(await soundResp.arrayBuffer()))
      try { engine.playTest(tmpFile) } finally {
        setTimeout(() => { try { unlinkSync(tmpFile) } catch {} }, 5000)
      }
      return { success: true, totalSounds: previewSounds.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[sound] Preview failed:', message)
      throw new Error(`Preview unavailable: ${message}`)
    }
  })

  // Play a test sound (arbitrary file)
  server.handle(RPC_CHANNELS.sound.PLAY_TEST, async (_ctx, filePath: string) => {
    const engine = getSoundEngine()
    engine.playTest(filePath)
    return { success: true }
  })

  // Import pack from a local folder
  server.handle(RPC_CHANNELS.sound.IMPORT_FOLDER, async (_ctx, folderPath: string) => {
    const { existsSync, readFileSync, cpSync } = await import('node:fs')
    const { basename } = await import('node:path')

    const manifestPath = join(folderPath, 'openpeon.json')
    if (!existsSync(manifestPath)) {
      throw new Error('No openpeon.json found in folder')
    }

    const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const { valid, errors } = validateManifest(manifestRaw)
    if (!valid) throw new Error(`Invalid manifest: ${errors.join(', ')}`)

    const packName = manifestRaw.name || basename(folderPath)
    const packDir = await getUserPackDirectory()
    const destDir = join(packDir, packName)

    cpSync(folderPath, destDir, { recursive: true, force: true })

    const engine = getSoundEngine()
    await engine.refreshPacks()
    return { success: true, packName }
  })

  // Import packs from peon-ping directory
  server.handle(RPC_CHANNELS.sound.IMPORT_PEON_PING, async () => {
    const engine = getSoundEngine()
    await engine.refreshPacks() // peon-ping packs are auto-discovered
    const peonPacks = engine.getPacks().filter(p => p.source === 'peon-ping')
    return { success: true, count: peonPacks.length, packs: peonPacks.map(p => p.name) }
  })
}