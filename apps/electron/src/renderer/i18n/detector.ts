import { CustomDetector } from 'i18next-browser-languagedetector'

// Détecteur de langue personnalisé pour Electron
// Lit d'abord depuis localStorage, puis utilise la langue du système
const LanguageDetector: CustomDetector = {
  name: 'craftAgentLanguageDetector',

  lookup() {
    // 1. Vérifier localStorage d'abord (préférence utilisateur explicite)
    const storedLang = localStorage.getItem('craft-agent-language')
    if (storedLang) {
      return storedLang
    }

    // 2. Utiliser la langue du navigateur/système
    const navigatorLang = navigator.language || (navigator as any).userLanguage

    // Extraire le code de langue principal (ex: "fr-FR" -> "fr")
    if (navigatorLang) {
      return navigatorLang.split('-')[0]
    }

    // 3. Fallback vers anglais
    return 'en'
  },

  cacheUserLanguage(lng: string) {
    localStorage.setItem('craft-agent-language', lng)
  },
}

export default LanguageDetector
