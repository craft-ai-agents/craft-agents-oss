/**
 * PreferencesPage
 *
 * Form-based editor for stored user preferences (~/.craft-agent/preferences.json).
 * Features:
 * - Fixed input fields for known preferences (name, timezone, location, language)
 * - Free-form textarea for notes
 * - Auto-saves on change with debouncing
 */

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { useTranslation } from 'react-i18next'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'preferences',
}

export function getPreferencesLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:preferences.pageTitle'),
    basicInfoTitle: t('settings:preferences.basicInfo.title'),
    basicInfoDescription: t('settings:preferences.basicInfo.description'),
    nameLabel: t('settings:preferences.basicInfo.name.label'),
    nameDescription: t('settings:preferences.basicInfo.name.description'),
    namePlaceholder: t('settings:preferences.basicInfo.name.placeholder'),
    timezoneLabel: t('settings:preferences.basicInfo.timezone.label'),
    timezoneDescription: t('settings:preferences.basicInfo.timezone.description'),
    timezonePlaceholder: t('settings:preferences.basicInfo.timezone.placeholder'),
    languageLabel: t('settings:preferences.basicInfo.language.label'),
    languageDescription: t('settings:preferences.basicInfo.language.description'),
    languagePlaceholder: t('settings:preferences.basicInfo.language.placeholder'),
    locationTitle: t('settings:preferences.location.title'),
    locationDescription: t('settings:preferences.location.description'),
    cityLabel: t('settings:preferences.location.city.label'),
    cityDescription: t('settings:preferences.location.city.description'),
    cityPlaceholder: t('settings:preferences.location.city.placeholder'),
    countryLabel: t('settings:preferences.location.country.label'),
    countryDescription: t('settings:preferences.location.country.description'),
    countryPlaceholder: t('settings:preferences.location.country.placeholder'),
    notesTitle: t('settings:preferences.notes.title'),
    notesDescription: t('settings:preferences.notes.description'),
    notesPlaceholder: t('settings:preferences.notes.placeholder'),
    editFileLabel: t('settings:preferences.actions.editFile'),
  }
}

interface PreferencesFormState {
  name: string
  timezone: string
  language: string
  city: string
  country: string
  notes: string
}

const emptyFormState: PreferencesFormState = {
  name: '',
  timezone: '',
  language: '',
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
      language: prefs.language || '',
      city: prefs.location?.city || '',
      country: prefs.location?.country || '',
      notes: prefs.notes || '',
    }
  } catch {
    return emptyFormState
  }
}

// Serialize form state to JSON
function serializePreferences(state: PreferencesFormState): string {
  const prefs: Record<string, unknown> = {}

  if (state.name) prefs.name = state.name
  if (state.timezone) prefs.timezone = state.timezone
  if (state.language) prefs.language = state.language

  if (state.city || state.country) {
    const location: Record<string, string> = {}
    if (state.city) location.city = state.city
    if (state.country) location.country = state.country
    prefs.location = location
  }

  if (state.notes) prefs.notes = state.notes
  prefs.updatedAt = Date.now()

  return JSON.stringify(prefs, null, 2)
}

export default function PreferencesPage() {
  const { t } = useTranslation(['settings'])
  const labels = getPreferencesLabels(t)
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
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('preferences')} helpFeature="preferences" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
          {/* Basic Info */}
          <SettingsSection
            title={labels.basicInfoTitle}
            description={labels.basicInfoDescription}
          >
            <SettingsCard divided>
              <SettingsInput
                label={labels.nameLabel}
                description={labels.nameDescription}
                value={formState.name}
                onChange={(v) => updateField('name', v)}
                placeholder={labels.namePlaceholder}
                inCard
              />
              <SettingsInput
                label={labels.timezoneLabel}
                description={labels.timezoneDescription}
                value={formState.timezone}
                onChange={(v) => updateField('timezone', v)}
                placeholder={labels.timezonePlaceholder}
                inCard
              />
              <SettingsInput
                label={labels.languageLabel}
                description={labels.languageDescription}
                value={formState.language}
                onChange={(v) => updateField('language', v)}
                placeholder={labels.languagePlaceholder}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Location */}
          <SettingsSection
            title={labels.locationTitle}
            description={labels.locationDescription}
          >
            <SettingsCard divided>
              <SettingsInput
                label={labels.cityLabel}
                description={labels.cityDescription}
                value={formState.city}
                onChange={(v) => updateField('city', v)}
                placeholder={labels.cityPlaceholder}
                inCard
              />
              <SettingsInput
                label={labels.countryLabel}
                description={labels.countryDescription}
                value={formState.country}
                onChange={(v) => updateField('country', v)}
                placeholder={labels.countryPlaceholder}
                inCard
              />
            </SettingsCard>
          </SettingsSection>

          {/* Notes */}
          <SettingsSection
            title={labels.notesTitle}
            description={labels.notesDescription}
            action={
              // EditPopover for AI-assisted notes editing with "Edit File" as secondary action
              preferencesPath ? (
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('preferences-notes', preferencesPath)}
                  secondaryAction={{
                    label: labels.editFileLabel,
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
                placeholder={labels.notesPlaceholder}
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
