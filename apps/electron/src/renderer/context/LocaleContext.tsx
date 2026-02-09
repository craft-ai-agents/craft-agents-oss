import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Locale } from 'date-fns'
import { getDateFnsLocale, translate, type TranslationKey } from '@/i18n'
import type { UiLocale } from '@/i18n/types'

interface LocaleContextValue {
  locale: UiLocale
  localeCode: UiLocale
  dateFnsLocale: Locale
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  setLocale: (locale: UiLocale) => Promise<void>
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined)

interface LocaleProviderProps {
  children: React.ReactNode
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<UiLocale>('en-US')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadLocale = async () => {
      try {
        const value = await window.electronAPI.getUiLocale()
        if (mounted) {
          setLocaleState(value)
        }
      } catch (error) {
        console.error('Failed to load UI locale:', error)
      } finally {
        if (mounted) {
          setIsReady(true)
        }
      }
    }

    loadLocale()

    const cleanup = window.electronAPI.onUiLocaleChange((value) => {
      setLocaleState(value)
    })

    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  const setLocale = useCallback(async (next: UiLocale) => {
    setLocaleState(next)
    try {
      await window.electronAPI.setUiLocale(next)
    } catch (error) {
      console.error('Failed to set UI locale:', error)
    }
  }, [])

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    return translate(locale, key, params)
  }, [locale])

  const dateFnsLocale = useMemo(() => getDateFnsLocale(locale), [locale])

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    localeCode: locale,
    dateFnsLocale,
    t,
    setLocale,
  }), [locale, dateFnsLocale, t, setLocale])

  if (!isReady) return null

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider')
  }
  return ctx
}

