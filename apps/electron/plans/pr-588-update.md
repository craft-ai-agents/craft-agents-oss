## Summary

Adds native audio notification support to Craft Agents with the OpenPeon Sound Pack (CESP v1.0) specification. Zero external dependencies — uses Electron BrowserWindow + HTMLAudioElement for cross-platform playback.

> **Update (v2):** This is a cleaned-up rewrite of the original PR, rebased onto v0.8.12. Key improvements since the initial submission:
> - **Per-session sound packs now work end-to-end** — lifecycle hooks pass `sessionId` to `SoundEngine.play()` so each session resolves its own pack
> - **Settings persist across restarts** — saved to `preferences.json` via the standard preferences system
> - **Sound pack selection propagates in real-time** — `sound_pack_changed` event from main process updates the renderer session atom, so each badge reflects only its own session's pack
> - **Popover fix** — replaced nested Radix `asChild` composition (PopoverTrigger → Tooltip) with a simple `<span>` wrapper (matching the working workspace selector pattern)
> - **Audio playback** — moved from UtilityProcess (broken on Windows) to BrowserWindow with `nodeIntegration` + HTMLAudioElement for reliable cross-platform sound

## Changes

### Core Audio Infrastructure
- **SoundEngine** — Singleton managing pack loading, cooldowns, spam detection, per-session pack overrides, and BrowserWindow audio player lifecycle
- **PackLoader** — 3-tier pack discovery: built-in → user-installed → peon-ping
- **TarExtractor** — Minimal tar.gz parser using Node.js zlib (no native deps)
- **SoundEventHandler** — Subscribes to WorkspaceEventBus for event-driven sound playback

### Settings UI
- **SoundSettingsPage** — Full settings page with volume slider, per-event toggles, pack management, cooldown config
- **SoundPackBadge** — Per-session pack selector in the input toolbar with optimistic UI updates and rollback on error

### Per-Session Sound Packs
Each session can override the global default sound pack. When multiple sessions are running, different sound packs allow users to hear which session made progress without looking at the screen.

- `soundPack` field in `SessionMetadata` / `StoredSession` — persisted to disk
- `updateSessionSoundPack()` — persists and emits `sound_pack_changed` event
- Lifecycle hooks (`onSessionStarted`, `onSessionCompleted`) pass `sessionId` to `SoundEngine.play()`
- `getActivePack(sessionId)` — resolves session → session pack, falls back to global default → first available

### Settings Persistence
- Sound settings saved to `~/.craft-agent/preferences.json` (survives app restarts and upgrades)
- `SoundEngine.init()` loads persisted settings on startup
- `SoundEngine.updateSettings()` persists via `updatePreferences()`
- Added `sound` field to `UserPreferencesSchema` (Zod validator) and `ConfigWatcher.UserPreferences` interface

### WS-RPC Wiring
- 11 new RPC channels in `sound` namespace
- 11 handler functions in `handlers/sound.ts`
- Full channel-map + ElectronAPI type definitions (both main and secondary windows)

### Session Persistence
- `soundPack` field added to DTO and `StoredSession`
- `updateSessionSoundPack` persists to JSONL and emits `sound_pack_changed` event
- Per-session packs loaded into SoundEngine on app startup

### Pack Format (CESP v1.0)
- `openpeon.json` manifest with categories, sounds array
- 9 event categories: `session.start`, `task.acknowledge`, `task.complete`, `task.error`, `input.required`, `resource.limit`, `user.spam`, `session.end`, `task.progress`
- Ships built-in default pack with 7 synthesized MP3 tones (~14 KB total)

## Testing

- `bun test` — 73 pass, 0 fail (types, validation, cooldowns, spam detection, session pack resolution)
- `tsc --noEmit` — clean
- Built and tested Windows installer (242 MB)

## Files Changed (44)

**New files (20):** Audio infrastructure, settings page, UI components, default sound pack, tests
**Modified files (24):** Protocol channels, DTO, session types/storage, preference persistence, validators, watcher, event processor, handler registration, settings registry, channel map, ElectronAPI types, input components, icons

## How It Works

1. **Startup**: `initSoundEngine()` discovers packs, loads persisted settings from `preferences.json`, initializes a hidden BrowserWindow with HTMLAudioElement
2. **Session sound packs**: When a session starts processing, `onSessionStarted(sessionId)` fires → `engine.play('session.start', sessionId)` → `getActivePack(sessionId)` checks session-specific pack first, then global default
3. **User selects pack**: `SoundPackBadge` → `setSoundPack(sessionId, packName)` RPC → `engine.setSessionPack()` (in-memory) + `sessionManager.updateSessionSoundPack()` (persist + emit `sound_pack_changed` event)
4. **Renderer updates**: `sound_pack_changed` event → `handleSoundPackChanged` → updates session atom's `soundPack` field → badge re-renders with correct pack name
5. **Settings persist**: `SoundEngine.updateSettings()` → `updatePreferences({ sound: settings })` → `preferences.json`

## Screenshots

Settings page and per-session badge will be added after UI testing on clean build.