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

    // Persist to disk via shared storage utility
    const session = await deps.sessionManager.getSession(sessionId)
    if (session?.workspaceId) {
      const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/workspaces')
      const workspace = getWorkspaceByNameOrId(session.workspaceId)
      if (workspace?.rootPath) {
        const { updateSessionMetadata } = await import('@craft-agent/shared/sessions/storage')
        await updateSessionMetadata(workspace.rootPath, sessionId, { soundPack: packName })
      }
    }

    return { success: true }
  })

  // Browse OpenPeon registry
  server.handle(RPC_CHANNELS.sound.GET_REGISTRY, async () => {
    try {
      const response = await fetch('https://peonping.github.io/registry/index.json')
      if (!response.ok) throw new Error(`Registry fetch failed: ${response.status}`)
      return await response.json()
    } catch (err) {
      console.error('[sound] Registry fetch error:', err)
      return { error: 'Failed to fetch registry', packs: [] }
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
    const { join } = await import('node:path')
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
    const { join } = await import('node:path')
    rmSync(pack.directory, { recursive: true, force: true })

    await engine.refreshPacks()
    return { success: true }
  })

  // Preview a pack (play a sample sound)
  server.handle(RPC_CHANNELS.sound.PREVIEW_PACK, async (_ctx, packName: string) => {
    const engine = getSoundEngine()
    const pack = engine.getPack(packName)
    if (!pack) throw new Error(`Pack not found: ${packName}`)

    // Find first sound from any category
    for (const [, catDef] of Object.entries(pack.manifest.categories)) {
      if (catDef.sounds.length > 0) {
        const { join } = await import('node:path')
        const filePath = join(pack.directory, catDef.sounds[0].file)
        engine.playTest(filePath)
        return { success: true }
      }
    }
    throw new Error('Pack has no sounds to preview')
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
    const { join, basename } = await import('node:path')

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
