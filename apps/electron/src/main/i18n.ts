/**
 * i18next configuration for the Electron main process
 *
 * Unlike the renderer process which uses react-i18next, the main process
 * uses a standalone i18next instance that loads translations from the filesystem.
 */

import i18n from 'i18next'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { mainLog } from './logger'

// Determine language from system locale (fallback to English)
const getSystemLanguage = (): string => {
  const locale = app.getLocale() // e.g., 'en-US', 'fr-FR'
  const lang = locale.split('-')[0] // Extract 'en' or 'fr'

  // Only support languages we have translations for
  const supportedLanguages = ['en', 'fr']
  return supportedLanguages.includes(lang) ? lang : 'en'
}

// Load translation file synchronously
const loadTranslation = (lng: string, ns: string): any => {
  try {
    // In production (packaged app), translations are in app.asar
    // In development, they're in the public folder
    const basePath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'public', 'locales')
      : join(__dirname, '..', '..', 'public', 'locales')

    const filePath = join(basePath, lng, `${ns}.json`)
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (err) {
    mainLog.warn(`[i18n] Failed to load translation: ${lng}/${ns}`, err)
    return {}
  }
}

// Initialize i18next for main process
const systemLang = getSystemLanguage()

i18n.init({
  lng: systemLang,
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',

  // Load translations synchronously from filesystem
  resources: {
    en: {
      common: loadTranslation('en', 'common'),
    },
    fr: {
      common: loadTranslation('fr', 'common'),
    },
  },

  interpolation: {
    escapeValue: false, // Not needed for Electron menus
  },
})

mainLog.info(`[i18n] Main process initialized with language: ${systemLang}`)

export default i18n
