import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as storage from '@/lib/local-storage'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n'

interface I18nContextType {
  language: SupportedLanguage
  setLanguage: (lang: SupportedLanguage) => void
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

interface I18nProviderProps {
  children: ReactNode
  defaultLanguage?: SupportedLanguage
}

function loadStoredLanguage(): SupportedLanguage | null {
  if (typeof window === 'undefined') return null
  const stored = storage.get<string>(storage.KEYS.language, '')
  if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
    return stored as SupportedLanguage
  }
  return null
}

function saveLanguage(lang: SupportedLanguage): void {
  storage.set(storage.KEYS.language, lang)
}

export function I18nProvider({
  children,
  defaultLanguage = 'en'
}: I18nProviderProps) {
  const { i18n } = useTranslation()
  const stored = loadStoredLanguage()

  const [language, setLanguageState] = useState<SupportedLanguage>(stored ?? defaultLanguage)

  // Track if we're receiving an external update to prevent echo broadcasts
  const isExternalUpdate = useRef(false)

  // Sync i18next with initial language
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cross-window sync listener via IPC
  useEffect(() => {
    if (!window.electronAPI?.onLanguageChange) return

    const cleanup = window.electronAPI.onLanguageChange((newLang) => {
      if (SUPPORTED_LANGUAGES.includes(newLang as SupportedLanguage)) {
        isExternalUpdate.current = true
        setLanguageState(newLang as SupportedLanguage)
        saveLanguage(newLang as SupportedLanguage)
        i18n.changeLanguage(newLang)
        setTimeout(() => {
          isExternalUpdate.current = false
        }, 0)
      }
    })

    return cleanup
  }, [i18n])

  const setLanguage = useCallback((newLang: SupportedLanguage) => {
    setLanguageState(newLang)
    saveLanguage(newLang)
    i18n.changeLanguage(newLang)
    // Broadcast to other windows via IPC
    if (!isExternalUpdate.current && window.electronAPI?.broadcastLanguage) {
      window.electronAPI.broadcastLanguage(newLang)
    }
  }, [i18n])

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext)
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
