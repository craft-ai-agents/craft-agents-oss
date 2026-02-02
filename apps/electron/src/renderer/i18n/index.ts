import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from './detector'

// Namespaces disponibles
export const namespaces = [
  'common',
  'chat',
  'settings',
  'onboarding',
  'shortcuts',
  'auth',
  'errors',
] as const

export type Namespace = (typeof namespaces)[number]

// Configuration i18next
i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Langue par défaut
    fallbackLng: 'en',

    // Langues supportées
    supportedLngs: ['en', 'fr'],

    // Namespaces
    ns: namespaces,
    defaultNS: 'common',

    // Détection et mise en cache
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'craft-agent-language',
    },

    // Configuration du backend HTTP
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    // Interpolation
    interpolation: {
      escapeValue: false, // React échappe déjà
    },

    // Réaction aux changements de langue
    react: {
      useSuspense: true,
    },

    // Debug en développement uniquement
    debug: process.env.NODE_ENV === 'development',
  })

export { useI18n } from './useI18n'
export default i18n
