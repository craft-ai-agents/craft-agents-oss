import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ko from './locales/ko.json'

export const SUPPORTED_LANGUAGES = ['en', 'ko'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ko: { translation: ko },
    },
    lng: 'en', // Default language, will be overridden by I18nContext
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false,
    },
    // Note: Language detection and persistence is handled by I18nContext
    // to ensure consistency with the app's localStorage pattern (JSON-serialized values)
  })

export default i18n
