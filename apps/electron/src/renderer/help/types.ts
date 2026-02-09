import type { DocFeature } from '@g4os/shared/docs/doc-links'

export interface HelpSection {
  heading: string
  paragraphs?: string[]
  items?: string[]
  code?: string
}

export interface HelpPage {
  title: string
  summary: string
  sections: HelpSection[]
}

export interface TabbedHelpPage {
  title: string
  tabs: { id: string; label: string; page: HelpPage }[]
}

export type HelpContent = HelpPage | TabbedHelpPage

export function isTabbedHelpPage(content: HelpContent): content is TabbedHelpPage {
  return 'tabs' in content
}

/** DocFeatures that have inline help content */
export type InlineHelpFeature = 'sources' | 'sources-api' | 'sources-mcp' | 'sources-local' | 'skills'

/** Check if a DocFeature has inline help content */
export function hasInlineHelp(feature: DocFeature): feature is InlineHelpFeature {
  return ['sources', 'sources-api', 'sources-mcp', 'sources-local', 'skills'].includes(feature)
}
