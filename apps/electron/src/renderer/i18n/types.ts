export const SUPPORTED_UI_LOCALES = ['pt-BR', 'en-US'] as const

export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number]

export interface TranslationMessage {
  value: string
  note?: string
}

export type TranslationEntry = string | TranslationMessage

export type TranslationDictionary = Record<string, TranslationEntry>

