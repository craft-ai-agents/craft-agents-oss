/**
 * The Translate sub-pie's languages. The invocation lists your recent picks, then macOS's preferred
 * languages (main keeps the recent ones in preferences.json); common ones fill the ring. Named in
 * English, as the one-shot prompt says "Translate the text into …".
 */

export interface TranslateLanguage {
  /** A BCP 47 language, with the script for Chinese ("hu", "zh-Hant"). */
  code: string
  /** The English name the prompt uses ("Hungarian", "Traditional Chinese"). */
  name: string
  /** What the slot shows ("HU"). */
  glyph: string
}

/** Fill-ins when you have few languages of your own: the most translated-into languages. */
const COMMON = ['en', 'es', 'fr', 'de', 'zh-Hans', 'ja', 'pt', 'it']

/** A tag down to what a translation needs: the language, plus the script for Chinese. */
export function languageCode(tag: string): string | null {
  try {
    const locale = new Intl.Locale(tag)
    if (locale.language !== 'zh') return locale.language
    const script = locale.maximize().script
    return script ? `zh-${script}` : 'zh'
  } catch {
    return null
  }
}

/** `tags` in order of preference; repeats (en-US, en-GB) count once. */
export function translateLanguages(tags: readonly string[], max: number): TranslateLanguage[] {
  const names = new Intl.DisplayNames(['en'], { type: 'language' })
  const seen = new Set<string>()
  const languages: TranslateLanguage[] = []
  for (const tag of [...tags, ...COMMON]) {
    if (languages.length >= max) break
    const code = languageCode(tag)
    if (!code || seen.has(code)) continue
    seen.add(code)
    const name = names.of(code)
    // An unknown code comes back as itself
    if (!name || name === code) continue
    languages.push({ code, name, glyph: code.split('-')[0].toUpperCase() })
  }
  return languages
}
