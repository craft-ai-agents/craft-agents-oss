import type { Namespace } from './index'

// Type pour les clés de traduction avec autocomplete
export type TranslationKey<N extends Namespace = 'common'> = string

// Type pour le hook useTranslation personnalisé
export interface UseI18nReturn {
  t: (key: string, options?: Record<string, unknown>) => string
  language: string
  changeLanguage: (lng: string) => Promise<void>
  languages: string[]
}

// Extension du module i18next pour le typage fort (optionnel)
declare module 'i18next' {
  interface CustomTypeOptions {
    returnNull: false
  }
}
