/**
 * Preferences form for stored user preferences (~/.craft-agent/preferences.json).
 *
 * Embedded on ContextSettingsPage (merged Context ↔ Preferences).
 * Features:
 * - Fixed input fields for known preferences (name, timezone, location, language)
 * - Free-form textarea for notes
 * - Auto-saves on change with debouncing
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsTextarea,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { Spinner } from '@craft-agent/ui'

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

function formSignature(state: PreferencesFormState): string {
  return JSON.stringify({
    name: state.name,
    timezone: state.timezone,
    city: state.city,
    country: state.country,
    notes: state.notes,
  })
}

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

/**
 * Embeddable preferences form body (no page chrome).
 * Used by ContextSettingsPage as the leading section.
 */
export function PreferencesForm() {
  const { t } = useTranslation()
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(true)
  const [preferencesPath, setPreferencesPath] = useState<string | null>(null)
  const [isEditPopoverOpen, setIsEditPopoverOpen] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)

  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  const reloadFromDisk = useCallback(async () => {
    try {
      const result = await window.electronAPI.readPreferences()
      const parsed = parsePreferences(result.content)
      const incomingSignature = formSignature(parsed)
      if (lastSavedRef.current === incomingSignature) return
      if (saveTimeoutRef.current) return
      setFormState(parsed)
      lastSavedRef.current = incomingSignature
    } catch (err) {
      console.error('Failed to reload stored user preferences:', err)
    }
  }, [])

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
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    if (isLoading) return
    const handleFocus = () => {
      void reloadFromDisk()
    }
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

  useEffect(() => {
    if (isEditPopoverOpen) return
    if (isLoading || isInitialLoadRef.current) return
    void reloadFromDisk()
  }, [isEditPopoverOpen, isLoading, reloadFromDisk])

  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

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

  const updateField = useCallback(
    <K extends keyof PreferencesFormState>(field: K, value: PreferencesFormState[K]) => {
      setFormState((prev) => ({ ...prev, [field]: value }))
    },
    [],
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner className="w-4 h-4 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('settings.preferences.basicInfo')}
        description={t('settings.preferences.basicInfoDesc')}
      >
        <SettingsCard divided>
          <SettingsInput
            label={t('settings.preferences.name')}
            description={t('settings.preferences.nameDesc')}
            value={formState.name}
            onChange={(v) => updateField('name', v)}
            placeholder={t('settings.preferences.namePlaceholder')}
            inCard
          />
          <SettingsInput
            label={t('settings.preferences.timezone')}
            description={t('settings.preferences.timezoneDesc')}
            value={formState.timezone}
            onChange={(v) => updateField('timezone', v)}
            placeholder={t('settings.preferences.timezonePlaceholder')}
            inCard
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.preferences.location')}
        description={t('settings.preferences.locationDesc')}
      >
        <SettingsCard divided>
          <SettingsInput
            label={t('settings.preferences.city')}
            description={t('settings.preferences.cityDesc')}
            value={formState.city}
            onChange={(v) => updateField('city', v)}
            placeholder={t('settings.preferences.cityPlaceholder')}
            inCard
          />
          <SettingsInput
            label={t('settings.preferences.country')}
            description={t('settings.preferences.countryDesc')}
            value={formState.country}
            onChange={(v) => updateField('country', v)}
            placeholder={t('settings.preferences.countryPlaceholder')}
            inCard
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settings.preferences.notes')}
        description={t('settings.preferences.notesDesc')}
        action={
          preferencesPath ? (
            <EditPopover
              trigger={<EditButton />}
              {...getEditConfig('preferences-notes', preferencesPath)}
              open={isEditPopoverOpen}
              onOpenChange={setIsEditPopoverOpen}
              secondaryAction={{
                label: t('common.editFile'),
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
            placeholder={t('settings.preferences.notesPlaceholder')}
            rows={5}
            inCard
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
