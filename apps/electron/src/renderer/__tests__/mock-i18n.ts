import { mock } from 'bun:test'
import enMessages from '../../../../../packages/shared/src/i18n/locales/en.json'

const interpolate = (message: string, options?: Record<string, unknown>) => {
  if (!options) return message
  return message.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(options[key] ?? ''))
}

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const message = (enMessages as Record<string, string>)[key] ?? key
      return interpolate(message, options)
    },
    i18n: {
      language: 'en',
      changeLanguage: async () => undefined,
    },
  }),
  Trans: ({ i18nKey }: { i18nKey?: string }) => i18nKey ?? null,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))
