import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsEn from './resources/en/settings.json'
import settingsZh from './resources/zh/settings.json'
import settingsEs from './resources/es/settings.json'
import settingsFr from './resources/fr/settings.json'
import settingsDe from './resources/de/settings.json'
import settingsPtBr from './resources/pt-BR/settings.json'
import settingsJa from './resources/ja/settings.json'
import settingsKo from './resources/ko/settings.json'
import sidebarEn from './resources/en/sidebar.json'
import sidebarZh from './resources/zh/sidebar.json'
import sidebarEs from './resources/es/sidebar.json'
import sidebarFr from './resources/fr/sidebar.json'
import sidebarDe from './resources/de/sidebar.json'
import sidebarPtBr from './resources/pt-BR/sidebar.json'
import sidebarJa from './resources/ja/sidebar.json'
import sidebarKo from './resources/ko/sidebar.json'
import chatEn from './resources/en/chat.json'
import chatZh from './resources/zh/chat.json'
import chatEs from './resources/es/chat.json'
import chatFr from './resources/fr/chat.json'
import chatDe from './resources/de/chat.json'
import chatPtBr from './resources/pt-BR/chat.json'
import chatJa from './resources/ja/chat.json'
import chatKo from './resources/ko/chat.json'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './languages'

const resources = {
  en: { settings: settingsEn, sidebar: sidebarEn, chat: chatEn },
  zh: { settings: settingsZh, sidebar: sidebarZh, chat: chatZh },
  es: { settings: settingsEs, sidebar: sidebarEs, chat: chatEs },
  fr: { settings: settingsFr, sidebar: sidebarFr, chat: chatFr },
  de: { settings: settingsDe, sidebar: sidebarDe, chat: chatDe },
  'pt-BR': { settings: settingsPtBr, sidebar: sidebarPtBr, chat: chatPtBr },
  ja: { settings: settingsJa, sidebar: sidebarJa, chat: chatJa },
  ko: { settings: settingsKo, sidebar: sidebarKo, chat: chatKo },
}

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES,
      defaultNS: 'settings',
      ns: ['settings', 'sidebar', 'chat'],
      interpolation: {
        escapeValue: false,
      },
      returnEmptyString: false,
    })
}

export { i18n }
