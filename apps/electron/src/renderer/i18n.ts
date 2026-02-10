import i18next, { type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'

export type RendererI18nInitOptions = {
  getAppLanguage?: () => Promise<string | null>
  localeGlob?: Record<string, () => Promise<{ default: Record<string, string> }>>
  namespaces?: string[]
}

export type RendererI18nChangeOptions = {
  localeGlob?: Record<string, () => Promise<{ default: Record<string, string> }>>
  namespaces?: string[]
}

let rendererI18n: i18n | null = null

function resolveLocale(input?: string | null): 'en' | 'zh-CN' {
  if (!input) return 'en'
  const normalized = input.replace('_', '-').trim().toLowerCase()
  if (normalized.startsWith('zh')) return 'zh-CN'
  return 'en'
}

function getLocaleGlob() {
  return import.meta.glob('../../../../packages/shared/locales/**/\*.json') as Record<
    string,
    () => Promise<{ default: Record<string, string> }>
  >
}

async function loadNamespace(
  localeGlob: Record<string, () => Promise<{ default: Record<string, string> }>>,
  locale: string,
  namespace: string,
) {
  const key = Object.keys(localeGlob).find((candidate) =>
    candidate.endsWith(`/locales/${locale}/${namespace}.json`)
  )
  if (!key) return null
  const loader = localeGlob[key]
  if (!loader) return null
  const module = await loader()
  return module.default
}

async function loadResources(
  localeGlob: Record<string, () => Promise<{ default: Record<string, string> }>>,
  locale: string,
  namespaces: string[],
) {
  const resources: Record<string, Record<string, string>> = {}
  await Promise.all(
    namespaces.map(async (ns) => {
      const data = await loadNamespace(localeGlob, locale, ns)
      if (data) {
        resources[ns] = data
      }
    })
  )
  return resources
}

export async function initRendererI18n(options: RendererI18nInitOptions = {}): Promise<i18n> {
  const localeGlob = options.localeGlob ?? getLocaleGlob()
  const getAppLanguage = options.getAppLanguage ?? (async () => window.electronAPI?.getAppLanguage?.() ?? null)
  const namespaces = options.namespaces ?? ['common']

  const stored = await getAppLanguage()
  const language = resolveLocale(stored)

  const resources = {
    [language]: await loadResources(localeGlob, language, namespaces),
  }

  if (!i18next.isInitialized) {
    await i18next
      .use(initReactI18next)
      .init({
        lng: language,
        fallbackLng: 'en',
        resources,
        ns: Object.keys(resources[language] ?? {}),
        defaultNS: 'common',
        interpolation: { escapeValue: false },
      })
  } else {
    Object.entries(resources[language] ?? {}).forEach(([ns, data]) => {
      i18next.addResourceBundle(language, ns, data, true, true)
    })
    await i18next.changeLanguage(language)
  }

  rendererI18n = i18next
  return i18next
}

export async function changeRendererLanguage(language: string, options: RendererI18nChangeOptions = {}): Promise<void> {
  if (!rendererI18n) return
  const localeGlob = options.localeGlob ?? getLocaleGlob()
  const namespaces = options.namespaces ?? ['common', 'settings', 'chat']
  const resolved = resolveLocale(language)

  if (!rendererI18n.hasResourceBundle(resolved, 'common')) {
    const resources = await loadResources(localeGlob, resolved, namespaces)
    Object.entries(resources).forEach(([ns, data]) => {
      rendererI18n?.addResourceBundle(resolved, ns, data, true, true)
    })
  }

  await rendererI18n.changeLanguage(resolved)
}

export function getRendererI18n(): i18n | null {
  return rendererI18n
}
