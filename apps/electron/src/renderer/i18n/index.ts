import type { Locale } from 'date-fns'
import { enUS as dateEnUS, ptBR as datePtBR } from 'date-fns/locale'
import type { TranslationEntry, UiLocale } from './types'
import { enUS, type TranslationKey } from './locales/en-US'
import { ptBR } from './locales/pt-BR'

const dictionaries: Record<UiLocale, Record<TranslationKey, TranslationEntry>> = {
  'en-US': enUS,
  'pt-BR': ptBR,
}

function entryValue(entry: TranslationEntry): string {
  return typeof entry === 'string' ? entry : entry.value
}

export function getDateFnsLocale(locale: UiLocale): Locale {
  return locale === 'pt-BR' ? datePtBR : dateEnUS
}

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const current = dictionaries[locale][key]
  const fallback = dictionaries['en-US'][key]
  const raw = current ?? fallback

  if (!raw) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] Missing translation for key: ${key}`)
    }
    return key
  }

  const base = entryValue(raw)
  if (!params) return base

  return base.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    const value = params[name]
    return value !== undefined ? String(value) : ''
  })
}

export function getTranslationNote(locale: UiLocale, key: TranslationKey): string | undefined {
  const entry = dictionaries[locale][key]
  if (!entry || typeof entry === 'string') return undefined
  return entry.note
}

export type { TranslationKey }

