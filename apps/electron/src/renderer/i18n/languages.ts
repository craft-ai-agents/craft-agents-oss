export const SUPPORTED_LANGUAGES = ['en', 'zh', 'es', 'fr', 'de', 'pt-BR', 'ja', 'ko'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

export const LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; nativeName: string; englishName: string }> = [
  { value: 'en', nativeName: 'English', englishName: 'English' },
  { value: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)' },
  { value: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { value: 'fr', nativeName: 'Français', englishName: 'French' },
  { value: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { value: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)' },
  { value: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  { value: 'ko', nativeName: '한국어', englishName: 'Korean' },
]

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  'en': 'en',
  'en-us': 'en',
  'en-gb': 'en',
  'zh': 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-sg': 'zh',
  'zh-hk': 'zh',
  'zh-tw': 'zh',
  'zh-hant': 'zh',
  'es': 'es',
  'es-es': 'es',
  'es-mx': 'es',
  'fr': 'fr',
  'fr-fr': 'fr',
  'de': 'de',
  'de-de': 'de',
  'pt': 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-BR',
  'ja': 'ja',
  'ja-jp': 'ja',
  'ko': 'ko',
  'ko-kr': 'ko',
}

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES)

export function normalizeLanguage(input?: string | null): SupportedLanguage | null {
  if (!input) return null
  const normalized = input.replace('_', '-').toLowerCase()
  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized]
  }
  const base = normalized.split('-')[0]
  if (SUPPORTED_LANGUAGE_SET.has(base)) {
    return base as SupportedLanguage
  }
  return null
}

export function resolveUiLanguage(options: {
  uiLanguage?: string | null
  preferenceLanguage?: string | null
  systemLanguage?: string | null
}): SupportedLanguage {
  return (
    normalizeLanguage(options.uiLanguage) ||
    normalizeLanguage(options.preferenceLanguage) ||
    normalizeLanguage(options.systemLanguage) ||
    DEFAULT_LANGUAGE
  )
}
