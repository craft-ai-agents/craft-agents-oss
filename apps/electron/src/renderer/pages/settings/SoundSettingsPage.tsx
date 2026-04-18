/**
 * SoundSettingsPage
 *
 * Settings page for configuring sound notifications.
 * Features:
 * - Global enable/disable and volume control
 * - Sound pack selection with browse/install from OpenPeon registry
 * - Per-event category enable/disable
 * - Per-event custom sound file override
 * - Import from local folder or peon-ping packs
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import {
  SettingsCard,
} from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  CespCategory,
  SoundSettings,
  SoundCategorySettings,
} from '@craft-agent/shared/audio'
import { CESP_ALL_CATEGORIES, DEFAULT_SOUND_SETTINGS } from '@craft-agent/shared/audio'
import { PackBrowserDialog } from '@/components/app-shell/input/PackBrowserDialog'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'sound',
}

// ---------------------------------------------------------------------------
// Category display info
// ---------------------------------------------------------------------------

const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
  'session.start': { label: 'Session Start', description: 'When a new session begins' },
  'task.acknowledge': { label: 'Task Acknowledge', description: 'When the agent starts working' },
  'task.complete': { label: 'Task Complete', description: 'When a task finishes' },
  'task.error': { label: 'Task Error', description: 'When something goes wrong' },
  'input.required': { label: 'Input Required', description: 'When the agent needs user input' },
  'resource.limit': { label: 'Resource Limit', description: 'When approaching context limits' },
  'user.spam': { label: 'User Spam', description: 'Rapid-fire prompt detection' },
  'session.end': { label: 'Session End', description: 'When a session closes' },
  'task.progress': { label: 'Task Progress', description: 'Periodic progress updates' },
}

// ---------------------------------------------------------------------------
// Pack info type (from RPC response)
// ---------------------------------------------------------------------------

interface PackInfo {
  name: string
  displayName: string
  version: string
  soundCount: number
  totalSizeBytes: number
  source: string
  description?: string
  author?: { name: string; github?: string }
  language?: string
  categories: string[]
  trustTier?: 'official' | 'community'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SoundSettingsPage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SOUND_SETTINGS)
  const [packs, setPacks] = useState<PackInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false)

  // Load settings and packs on mount
  useEffect(() => {
    loadSettings()
    loadPacks()
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const result = await window.electronAPI.getSoundSettings()
      if (result) setSettings(result)
    } catch (err) {
      console.error('[sound] Failed to load settings:', err)
    }
  }, [])

  const loadPacks = useCallback(async () => {
    try {
      const result = await window.electronAPI.getSoundPacks()
      if (result) setPacks(result)
      setLoading(false)
    } catch (err) {
      console.error('[sound] Failed to load packs:', err)
      setLoading(false)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Settings update helpers
  // ---------------------------------------------------------------------------

  const updateSettings = useCallback(async (partial: Partial<SoundSettings>) => {
    const newSettings = { ...settings, ...partial }
    setSettings(newSettings)
    await window.electronAPI.setSoundSettings(partial)
  }, [settings])

  const updateCategory = useCallback(async (category: CespCategory, updates: Partial<SoundCategorySettings>) => {
    const newCategories = {
      ...settings.categories,
      [category]: { ...settings.categories[category], ...updates },
    }
    await updateSettings({ categories: newCategories })
  }, [settings, updateSettings])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <PanelHeader
        title={t('settings.sound.title', 'Sound Notifications')}
        actions={<HeaderMenu route={routes.view.settings('sound')} helpFeature="sound-settings" />}
      />

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6 max-w-2xl">
          {/* Master Toggle & Volume */}
          <SettingsCard>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium">Sound Notifications</h3>
                <p className="text-xs text-muted-foreground">Play sounds for agent events</p>
              </div>
              <button
                onClick={() => updateSettings({ enabled: !settings.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.enabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {settings.enabled && (
              <div className="space-y-4">
                {/* Volume Slider */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Volume: {Math.round(settings.volume * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.volume}
                    onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>

                {/* Global Pack Selector */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Default Sound Pack
                  </label>
                  <select
                    value={settings.defaultPack}
                    onChange={(e) => updateSettings({ defaultPack: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {packs.map(pack => (
                      <option key={pack.name} value={pack.name}>
                        {pack.displayName} ({pack.soundCount} sounds) {pack.source === 'builtin' ? '— Built-in' : ''}
                      </option>
                    ))}
                    {packs.length === 0 && (
                      <option value="default">Default (loading...)</option>
                    )}
                  </select>
                </div>

                {/* Cooldown & No-repeat */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={settings.noRepeat}
                      onChange={(e) => updateSettings({ noRepeat: e.target.checked })}
                      className="rounded border-border"
                    />
                    No-repeat
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Cooldown:</span>
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      step="500"
                      value={settings.cooldownMs}
                      onChange={(e) => updateSettings({ cooldownMs: parseInt(e.target.value) || 0 })}
                      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs"
                    />
                    <span className="text-muted-foreground">ms</span>
                  </div>
                </div>
              </div>
            )}
          </SettingsCard>

          {/* Per-Event Categories */}
          {settings.enabled && (
            <SettingsCard>
              <h3 className="text-sm font-medium mb-3">Notification Events</h3>
              <div className="space-y-2">
                {CESP_ALL_CATEGORIES.map(category => {
                  const info = CATEGORY_INFO[category]
                  const catSettings = settings.categories[category] ?? { enabled: false }
                  return (
                    <div key={category} className="flex items-center justify-between py-1.5">
                      <div className="flex-1">
                        <div className="text-sm">{info?.label ?? category}</div>
                        <div className="text-xs text-muted-foreground">{info?.description}</div>
                      </div>
                      <button
                        onClick={() => updateCategory(category, { enabled: !catSettings.enabled })}
                        className={`text-xs px-2 py-1 rounded ${
                          catSettings.enabled
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {catSettings.enabled ? '🔊 On' : '🔇 Off'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </SettingsCard>
          )}

          {/* Installed Packs */}
          {settings.enabled && (
            <SettingsCard>
              <h3 className="text-sm font-medium mb-3">Installed Packs</h3>
              {packs.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground">No packs found</p>
              )}
              <div className="space-y-2">
                {packs.map(pack => (
                  <div key={pack.name} className="flex items-center justify-between p-2 rounded-md border border-border">
                    <div>
                      <div className="text-sm font-medium">
                        {pack.displayName}
                        {pack.source === 'builtin' && (
                          <span className="ml-2 text-xs text-muted-foreground">(built-in)</span>
                        )}
                        {pack.trustTier === 'official' && (
                          <span className="ml-2 text-xs text-green-500">✓ Official</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {pack.soundCount} sounds · {Math.round(pack.totalSizeBytes / 1024)} KB
                        {pack.language && ` · ${pack.language.toUpperCase()}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          window.electronAPI.previewSoundPack(pack.name)
                        }}
                        className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80"
                      >
                        ▶ Preview
                      </button>
                      {pack.source !== 'builtin' && (
                        <button
                          onClick={async () => {
                            await window.electronAPI.uninstallSoundPack(pack.name)
                            loadPacks()
                          }}
                          className="text-xs px-2 py-1 rounded bg-muted hover:bg-destructive/10 text-destructive"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Pack Browser Button */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setBrowseDialogOpen(true)}
                  className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  📦 Browse Packs (300+ available)
                </button>
                <button
                  onClick={async () => {
                    const result = await window.electronAPI.openFolderDialog()
                    if (result) {
                      await window.electronAPI.importSoundFolder(result)
                      loadPacks()
                    }
                  }}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted"
                >
                  📁 Import from Folder
                </button>
                <button
                  onClick={async () => {
                    await window.electronAPI.importPeonPingPacks()
                    loadPacks()
                  }}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted"
                >
                  🔌 Import peon-ping Packs
                </button>
              </div>
            </SettingsCard>
          )}
        </div>
      </ScrollArea>

      {/* Pack Browser Dialog */}
      <PackBrowserDialog
        open={browseDialogOpen}
        onOpenChange={setBrowseDialogOpen}
        onPackInstalled={() => loadPacks()}
      />
    </>
  )
}
