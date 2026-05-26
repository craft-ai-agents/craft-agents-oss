/**
 * PreferencesPage
 *
 * Form-based editor for stored user preferences (~/.craft-agent/preferences.json).
 * Features:
 * - Fixed input fields for known preferences (name, timezone, location, language)
 * - Free-form textarea for notes
 * - Auto-saves on change with debouncing
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelectRow,
  SettingsTextarea,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'preferences',
}

interface PreferencesFormState {
  name: string
  timezone: string
  city: string
  country: string
  notes: string
  memorySidecarMode: 'manual' | 'review'
  passthrough: Record<string, unknown>
}

const emptyFormState: PreferencesFormState = {
  name: '',
  timezone: '',
  city: '',
  country: '',
  notes: '',
  memorySidecarMode: 'review',
  passthrough: {},
}

// Parse JSON to form state
function parsePreferences(json: string): PreferencesFormState {
  try {
    const prefs = JSON.parse(json) as Record<string, unknown>
    const location = isRecord(prefs.location) ? prefs.location : {}
    const memory = isRecord(prefs.memory) ? prefs.memory : {}
    return {
      name: typeof prefs.name === 'string' ? prefs.name : '',
      timezone: typeof prefs.timezone === 'string' ? prefs.timezone : '',
      city: typeof location.city === 'string' ? location.city : '',
      country: typeof location.country === 'string' ? location.country : '',
      notes: typeof prefs.notes === 'string' ? prefs.notes : '',
      memorySidecarMode: memory.sidecarMode === 'manual' ? 'manual' : 'review',
      passthrough: stripKnownPreferences(prefs),
    }
  } catch {
    return emptyFormState
  }
}

// Serialize form state to JSON
function serializePreferences(state: PreferencesFormState): string {
  const prefs: Record<string, unknown> = { ...state.passthrough }

  if (state.name) prefs.name = state.name
  if (state.timezone) prefs.timezone = state.timezone

  if (state.city || state.country) {
    const location: Record<string, string> = {}
    if (state.city) location.city = state.city
    if (state.country) location.country = state.country
    prefs.location = location
  }

  if (state.notes) prefs.notes = state.notes
  const existingMemory = isRecord(state.passthrough.memory) ? state.passthrough.memory : {}
  const memory = { ...existingMemory, sidecarMode: state.memorySidecarMode }
  delete prefs.memory
  if (Object.keys(memory).length > 1 || state.memorySidecarMode !== 'review') {
    prefs.memory = memory
  }
  prefs.updatedAt = Date.now()

  return JSON.stringify(prefs, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stripKnownPreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...prefs }
  delete rest.name
  delete rest.timezone
  delete rest.location
  delete rest.notes
  delete rest.updatedAt
  return rest
}

export default function PreferencesPage() {
  const { t } = useTranslation()
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(true)
  const [preferencesPath, setPreferencesPath] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)

  // Keep formStateRef in sync for use in cleanup
  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  // Load stored user preferences on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        const parsed = parsePreferences(result.content)
        setFormState(parsed)
        setPreferencesPath(result.path)
        lastSavedRef.current = serializePreferences(parsed)
      } catch (err) {
        console.error('Failed to load stored user preferences:', err)
        setFormState(emptyFormState)
      } finally {
        setIsLoading(false)
        // Mark initial load as complete after a short delay
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      }
    }
    load()
  }, [])

  // Auto-save with debouncing
  useEffect(() => {
    // Skip auto-save during initial load
    if (isInitialLoadRef.current || isLoading) return

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 500ms
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const json = serializePreferences(formState)
        const result = await window.electronAPI.writePreferences(json)
        if (result.success) {
          lastSavedRef.current = json
        } else {
          console.error('Failed to save preferences:', result.error)
        }
      } catch (err) {
        console.error('Failed to save preferences:', err)
      }
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formState, isLoading])

  // Force save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      // Clear any pending debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Check if there are unsaved changes and save immediately
      const currentJson = serializePreferences(formStateRef.current)
      if (lastSavedRef.current !== currentJson && !isInitialLoadRef.current) {
        // Fire and forget - we can't await in cleanup
        window.electronAPI.writePreferences(currentJson).catch((err) => {
          console.error('Failed to save preferences on unmount:', err)
        })
      }
    }
  }, [])

  const updateField = useCallback(<K extends keyof PreferencesFormState>(
    field: K,
    value: PreferencesFormState[K]
  ) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.preferences.title")} actions={<HeaderMenu route={routes.view.settings('preferences')} helpFeature="preferences" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-6 pt-24 pb-8 max-w-[760px] mx-auto space-y-6">
          {/* Basic Info */}
          <SettingsSection
            title={t("settings.preferences.basicInfo")}
            description={t("settings.preferences.basicInfoDesc")}
          >
            <SettingsCard divided>
              <SettingsInput
                label={t("settings.preferences.name")}
                description={t("settings.preferences.nameDesc")}
                value={formState.name}
                onChange={(v) => updateField('name', v)}
                placeholder={t("settings.preferences.namePlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.preferences.timezone")}
                description={t("settings.preferences.timezoneDesc")}
                value={formState.timezone}
                onChange={(v) => updateField('timezone', v)}
                placeholder={t("settings.preferences.timezonePlaceholder")}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Location */}
          <SettingsSection
            title={t("settings.preferences.location")}
            description={t("settings.preferences.locationDesc")}
          >
            <SettingsCard divided>
              <SettingsInput
                label={t("settings.preferences.city")}
                description={t("settings.preferences.cityDesc")}
                value={formState.city}
                onChange={(v) => updateField('city', v)}
                placeholder={t("settings.preferences.cityPlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.preferences.country")}
                description={t("settings.preferences.countryDesc")}
                value={formState.country}
                onChange={(v) => updateField('country', v)}
                placeholder={t("settings.preferences.countryPlaceholder")}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Notes */}
          <SettingsSection
            title={t("settings.preferences.notes")}
            description={t("settings.preferences.notesDesc")}
            action={
              // EditPopover for AI-assisted notes editing with "Edit File" as secondary action
              preferencesPath ? (
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('preferences-notes', preferencesPath)}
                  secondaryAction={{
                    label: t("common.editFile"),
                    filePath: preferencesPath!,
                  }}
                />
              ) : null
            }
          >
            <SettingsCard divided={false}>
              <SettingsTextarea
                value={formState.notes}
                onChange={(v) => updateField('notes', v)}
                placeholder={t("settings.preferences.notesPlaceholder")}
                rows={5}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            title="Memory"
            description="Control how RunnerOS proposes durable memories."
          >
            <SettingsCard divided>
              <SettingsSelectRow
                label="Memory sidecar"
                description="Review queues suggestions for approval. Manual disables background review."
                value={formState.memorySidecarMode}
                onValueChange={(value) => updateField('memorySidecarMode', value === 'manual' ? 'manual' : 'review')}
                options={[
                  { value: 'review', label: 'Review' },
                  { value: 'manual', label: 'Manual' },
                ]}
                inCard
              />
            </SettingsCard>
          </SettingsSection>
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
