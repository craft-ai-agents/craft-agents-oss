import type { UiLocale } from '@/i18n/types'
import type { DocFeature } from '@g4os/shared/docs/doc-links'
import type { HelpContent, InlineHelpFeature } from '../types'
import { hasInlineHelp } from '../types'
import { enUS } from './en-US'
import { ptBR } from './pt-BR'

const contentByLocale: Record<string, Record<InlineHelpFeature, HelpContent>> = {
  'en-US': enUS,
  'pt-BR': ptBR,
}

/**
 * Get inline help content for a feature and locale.
 * Returns undefined if the feature doesn't have inline content.
 * Falls back to en-US if the locale doesn't have content.
 */
export function getHelpContent(locale: UiLocale, feature: DocFeature): HelpContent | undefined {
  if (!hasInlineHelp(feature)) return undefined
  const localeContent = contentByLocale[locale] ?? contentByLocale['en-US']
  return localeContent[feature]
}
