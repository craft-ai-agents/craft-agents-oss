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
  SettingsCardContent,
  SettingsCardFooter,
  SettingsSection,
  SettingsToggle,
  SettingsRow,
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
  const previewIndexRef = React.useRef<Map<string, number>>(new Map())

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
        <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">

            {/* ── Master Toggle ─────────────────────────────── */}
            <SettingsSection title={t('settings.sound.title', 'Sound Notifications')} description={t('settings.sound.description', 'Play sounds for agent events')}>
              <SettingsCard>
                <SettingsToggle
                  label={t('settings.sound.enabled', 'Enabled')}
                  description={t('settings.sound.enabledDesc', 'Play notification sounds when events occur')}
                  checked={settings.enabled}
                  onCheckedChange={(checked) => updateSettings({ enabled: checked })}
                />
              </SettingsCard>
            </SettingsSection>

            {settings.enabled && (
              <>
                {/* ── Volume & Pack ────────────────────────── */}
                <SettingsSection title={t('settings.sound.defaults', 'Defaults')} description={t('settings.sound.defaultsDesc', 'Global volume and default sound pack')}>
                  <SettingsCard>
                    {/* Volume */}
                    <SettingsCardContent>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
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
                    </SettingsCardContent>

                    {/* Default Pack */}
                    <SettingsRow
                      label={t('settings.sound.defaultPack', 'Default Sound Pack')}
                    >
                      <select
                        value={settings.defaultPack}
                        onChange={(e) => updateSettings({ defaultPack: e.target.value })}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm max-w-[200px]"
                      >
                        {packs.map(pack => (
                          <option key={pack.name} value={pack.name}>
                            {pack.displayName} ({pack.soundCount})
                            {pack.source === 'builtin' ? ' — Built-in' : ''}
                          </option>
                        ))}
                        {packs.length === 0 && (
                          <option value="default">Default (loading…)</option>
                        )}
                      </select>
                    </SettingsRow>

                    {/* No-repeat & Cooldown */}
                    <SettingsRow
                      label={t('settings.sound.noRepeat', 'No-repeat')}
                      description={t('settings.sound.noRepeatDesc', 'Avoid playing the same sound in quick succession')}
                    >
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={settings.noRepeat}
                            onChange={(e) => updateSettings({ noRepeat: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span className="text-xs text-muted-foreground">Enable</span>
                        </label>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">Cooldown:</span>
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            step="500"
                            value={settings.cooldownMs}
                            onChange={(e) => updateSettings({ cooldownMs: parseInt(e.target.value) || 0 })}
                            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs"
                          />
                          <span className="text-muted-foreground">ms</span>
                        </div>
                      </div>
                    </SettingsRow>
                  </SettingsCard>
                </SettingsSection>

                {/* ── Notification Events ────────────────────── */}
                <SettingsSection title={t('settings.sound.events', 'Notification Events')} description={t('settings.sound.eventsDesc', 'Choose which events produce sounds')}>
                  <SettingsCard>
                    {CESP_ALL_CATEGORIES.map((category, index) => {
                      const info = CATEGORY_INFO[category]
                      const catSettings = settings.categories[category] ?? { enabled: false }
                      return (
                        <SettingsToggle
                          key={category}
                          label={info?.label ?? category}
                          description={info?.description}
                          checked={catSettings.enabled}
                          onCheckedChange={(checked) => updateCategory(category, { enabled: checked })}
                        />
                      )
                    })}
                  </SettingsCard>
                </SettingsSection>

                {/* ── Installed Packs ──────────────────────────── */}
                <SettingsSection title={t('settings.sound.packs', 'Installed Packs')} description={t('settings.sound.packsDesc', 'Manage sound packs and install new ones')}>
                  <SettingsCard>
                    {packs.length === 0 && !loading && (
                      <SettingsCardContent>
                        <p className="text-sm text-muted-foreground">No packs found</p>
                      </SettingsCardContent>
                    )}
                    {packs.map(pack => (
                      <SettingsRow
                        key={pack.name}
                        label={
                          <span>
                            {pack.displayName}
                            {pack.source === 'builtin' && (
                              <span className="ml-2 text-xs text-muted-foreground">(built-in)</span>
                            )}
                            {pack.trustTier === 'official' && (
                              <span className="ml-2 text-xs text-green-500">✓ Official</span>
                            )}
                          </span>
                        }
                        description={`${pack.soundCount} sounds · ${Math.round(pack.totalSizeBytes / 1024)} KB${pack.language ? ` · ${pack.language.toUpperCase()}` : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              (() => { const idx = previewIndexRef.current.get(pack.name) ?? 0; window.electronAPI.previewSoundPack(pack.name, idx).then(r => { if (r.totalSounds) previewIndexRef.current.set(pack.name, (idx + 1) % r.totalSounds) }) })()
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
                      </SettingsRow>
                    ))}
                    <SettingsCardFooter>
                      <button
                        onClick={() => setBrowseDialogOpen(true)}
                        className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        📦 Browse Packs
                      </button>
                      <button
                        onClick={async () => {
                          const result = await window.electronAPI.openFolderDialog()
                          if (result) {
                            await window.electronAPI.importSoundFolder(result)
                            loadPacks()
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted"
                      >
                        📁 Import Folder
                      </button>
                      <button
                        onClick={async () => {
                          await window.electronAPI.importPeonPingPacks()
                          loadPacks()
                        }}
                        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted"
                      >
                        🔌 Import peon-ping
                      </button>
                    </SettingsCardFooter>
                  </SettingsCard>
                </SettingsSection>
              </>
            )}
          </div>
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