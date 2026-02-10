import { app } from 'electron'
import { readFile } from 'fs/promises'
import { loadStoredConfig } from '@craft-agent/shared/config'
import { buildLocaleCandidatePaths } from './i18n-resource-paths'

export type MainTranslationParams = Record<string, string | number>
export type MainTranslationFn = (key: string, params?: MainTranslationParams) => string

type LocaleResources = Record<string, unknown>

const namespaceCache = new Map<string, LocaleResources>()

function resolveLocale(input?: string | null): 'en' | 'zh-CN' {
  if (!input) return 'en'
  const normalized = input.replace('_', '-').trim().toLowerCase()
  if (normalized.startsWith('zh')) return 'zh-CN'
  return 'en'
}

function resolveNestedValue(data: LocaleResources, keyPath: string): string | null {
  const segments = keyPath.split('.')
  let current: unknown = data
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : null
}

function interpolate(template: string, params?: MainTranslationParams): string {
  if (!params) return template
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    const value = params[key]
    return value === undefined ? '' : String(value)
  })
}

async function loadNamespace(locale: string, namespace: string): Promise<LocaleResources> {
  const cacheKey = `${locale}:${namespace}`
  const cached = namespaceCache.get(cacheKey)
  if (cached) return cached

  const candidatePaths = buildLocaleCandidatePaths({
    isPackaged: app.isPackaged,
    cwd: process.cwd(),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    locale,
    namespace,
  })

  for (const filePath of candidatePaths) {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as LocaleResources
      namespaceCache.set(cacheKey, parsed)
      return parsed
    } catch {
      // try next candidate path
    }
  }

  const fallback: LocaleResources = {}
  namespaceCache.set(cacheKey, fallback)
  return fallback
}

export async function getMainI18n(namespaces: string[] = ['menu', 'dialogs']) {
  const config = loadStoredConfig()
  const language = resolveLocale(config?.language ?? app.getLocale())
  const resources: Record<string, LocaleResources> = {}

  await Promise.all(
    namespaces.map(async (namespace) => {
      resources[namespace] = await loadNamespace(language, namespace)
    })
  )

  const t: MainTranslationFn = (key: string, params?: MainTranslationParams) => {
    const [namespace, rawKey] = key.includes(':') ? key.split(':') : [namespaces[0] ?? 'menu', key]
    const namespaceData = resources[namespace]
    if (!namespaceData) return key
    const value = resolveNestedValue(namespaceData, rawKey)
    if (!value) return key
    return interpolate(value, params)
  }

  return { language, t }
}
