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
}

const emptyFormState: PreferencesFormState = {
  name: '',
  timezone: '',
  city: '',
  country: '',
  notes: '',
}

// Parse JSON to form state
function parsePreferences(json: string): PreferencesFormState {
  try {
    const prefs = JSON.parse(json)
    return {
      name: prefs.name || '',
      timezone: prefs.timezone || '',
      city: prefs.location?.city || '',
      country: prefs.location?.country || '',
      notes: prefs.notes || '',
    }
  } catch {
    return emptyFormState
  }
}

// Stable signature of form state (excludes updatedAt) for dirty-checking.
function formSignature(state: PreferencesFormState): string {
  return JSON.stringify({
    name: state.name,
    timezone: state.timezone,
    city: state.city,
    country: state.country,
    notes: state.notes,
  })
}

// Merge form state into existing on-disk prefs so untouched fields survive.
function mergeFormIntoPrefs(
  existing: Record<string, unknown>,
  state: PreferencesFormState,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing }

  if (state.name) next.name = state.name
  else delete next.name

  if (state.timezone) next.timezone = state.timezone
  else delete next.timezone

  if (state.city || state.country) {
    const existingLocation =
      (existing.location as Record<string, unknown> | undefined) ?? {}
    const location: Record<string, unknown> = { ...existingLocation }
    if (state.city) location.city = state.city
    else delete location.city
    if (state.country) location.country = state.country
    else delete location.country
    if (Object.keys(location).length > 0) next.location = location
    else delete next.location
  } else {
    delete next.location
  }

  if (state.notes) next.notes = state.notes
  else delete next.notes

  next.updatedAt = Date.now()
  return next
}

async function persistFormState(state: PreferencesFormState): Promise<string | null> {
  try {
    const { content } = await window.electronAPI.readPreferences()
    let existing: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object') existing = parsed
    } catch {
      // ignore — start from empty rather than propagating corruption
    }
    const merged = mergeFormIntoPrefs(existing, state)
    const json = JSON.stringify(merged, null, 2)
    const result = await window.electronAPI.writePreferences(json)
    if (!result.success) {
      console.error('Failed to save preferences:', result.error)
      return null
    }
    return json
  } catch (err) {
    console.error('Failed to save preferences:', err)
    return null
  }
}

export default function PreferencesPage() {
  const { t } = useTranslation()
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(true)
  const [preferencesPath, setPreferencesPath] = useState<string | null>(null)
  const [isEditPopoverOpen, setIsEditPopoverOpen] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)

  // Keep formStateRef in sync for use in cleanup
  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  // Reload preferences from disk if they changed externally (e.g. agent edits).
  const reloadFromDisk = useCallback(async () => {
    try {
      const result = await window.electronAPI.readPreferences()
      const parsed = parsePreferences(result.content)
      const incomingSignature = formSignature(parsed)
      if (lastSavedRef.current === incomingSignature) return
      // Skip if the user has local edits pending a save — don't clobber them.
      if (saveTimeoutRef.current) return
      setFormState(parsed)
      lastSavedRef.current = incomingSignature
    } catch (err) {
      console.error('Failed to reload stored user preferences:', err)
    }
  }, [])

  // Load stored user preferences on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        const parsed = parsePreferences(result.content)
        setFormState(parsed)
        setPreferencesPath(result.path)
        lastSavedRef.current = formSignature(parsed)
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

  // Refresh from disk on focus/visibility change (catches external edits).
  useEffect(() => {
    if (isLoading) return
    const handleFocus = () => { void reloadFromDisk() }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void reloadFromDisk()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isLoading, reloadFromDisk])

  // Refresh after the EditPopover closes (agent likely just edited the file).
  useEffect(() => {
    if (isEditPopoverOpen) return
    if (isLoading || isInitialLoadRef.current) return
    void reloadFromDisk()
  }, [isEditPopoverOpen, isLoading, reloadFromDisk])

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
      saveTimeoutRef.current = null
      const signature = formSignature(formState)
      if (lastSavedRef.current === signature) return
      const written = await persistFormState(formState)
      if (written !== null) {
        lastSavedRef.current = signature
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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      if (isInitialLoadRef.current) return

      const signature = formSignature(formStateRef.current)
      if (lastSavedRef.current === signature) return

      persistFormState(formStateRef.current).catch((err) => {
        console.error('Failed to save preferences on unmount:', err)
      })
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
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
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
                  open={isEditPopoverOpen}
                  onOpenChange={setIsEditPopoverOpen}
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
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
