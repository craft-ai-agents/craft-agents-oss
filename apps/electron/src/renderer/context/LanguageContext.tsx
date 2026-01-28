import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '@/i18n'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  resolveUiLanguage,
  type SupportedLanguage,
} from '@/i18n/languages'

type LanguageOption = (typeof LANGUAGE_OPTIONS)[number]

interface LanguageContextType {
  uiLanguage: SupportedLanguage
  setUiLanguage: (language: SupportedLanguage) => Promise<void>
  languageOptions: LanguageOption[]
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

async function getPreferenceLanguage(): Promise<string | null> {
  if (!window.electronAPI?.readPreferences) return null
  try {
    const result = await window.electronAPI.readPreferences()
    const prefs = JSON.parse(result.content)
    if (typeof prefs?.language === 'string') {
      return prefs.language
    }
  } catch {
    // Ignore preference parsing errors
  }
  return null
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [uiLanguage, setUiLanguageState] = useState<SupportedLanguage>(DEFAULT_LANGUAGE)
  const isExternalUpdate = useRef(false)

  const languageOptions = useMemo(() => LANGUAGE_OPTIONS, [])

  const applyLanguage = useCallback(async (language: SupportedLanguage, persist: boolean) => {
    let nextLanguage = language
    setUiLanguageState(language)
    try {
      await i18n.changeLanguage(language)
    } catch {
      nextLanguage = DEFAULT_LANGUAGE
      await i18n.changeLanguage(DEFAULT_LANGUAGE)
      setUiLanguageState(DEFAULT_LANGUAGE)
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextLanguage
    }
    if (persist && window.electronAPI?.setUiLanguage) {
      await window.electronAPI.setUiLanguage(nextLanguage)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      const storedUiLanguage = window.electronAPI?.getUiLanguage
        ? await window.electronAPI.getUiLanguage()
        : null
      const preferenceLanguage = await getPreferenceLanguage()
      const systemLanguage = typeof navigator !== 'undefined' ? navigator.language : null
      const resolved = resolveUiLanguage({
        uiLanguage: storedUiLanguage,
        preferenceLanguage,
        systemLanguage,
      })
      await applyLanguage(resolved, false)
    }
    load()
  }, [applyLanguage])

  useEffect(() => {
    if (!window.electronAPI?.onUiLanguageChange) return

    const cleanup = window.electronAPI.onUiLanguageChange((language) => {
      const resolved = resolveUiLanguage({ uiLanguage: language })
      isExternalUpdate.current = true
      void applyLanguage(resolved, false).finally(() => {
        setTimeout(() => {
          isExternalUpdate.current = false
        }, 0)
      })
    })

    return cleanup
  }, [applyLanguage])

  const setUiLanguage = useCallback(
    async (language: SupportedLanguage) => {
      await applyLanguage(language, true)
      if (!isExternalUpdate.current && window.electronAPI?.broadcastUiLanguage) {
        await window.electronAPI.broadcastUiLanguage(language)
      }
    },
    [applyLanguage]
  )

  return (
    <LanguageContext.Provider value={{ uiLanguage, setUiLanguage, languageOptions }}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
