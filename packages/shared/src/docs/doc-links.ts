/**
 * Documentation links and summaries for contextual help throughout the UI.
 * Summaries provide quick context; "Learn more" opens the full docs.
 *
 * For i18n support, use getLocalizedDocInfo() with a translation function.
 */

const DOC_BASE_URL = 'https://agents.craft.do/docs'

export type DocFeature =
  | 'sources'
  | 'sources-api'
  | 'sources-mcp'
  | 'sources-local'
  | 'skills'
  | 'statuses'
  | 'permissions'
  | 'labels'
  | 'workspaces'
  | 'themes'
  | 'app-settings'
  | 'preferences'

export interface DocInfo {
  /** Path relative to DOC_BASE_URL */
  path: string
  /** Display title for the help popover */
  title: string
  /** 1-2 sentence summary for quick context */
  summary: string
}

/** Internal doc config with translation keys */
interface DocConfig {
  path: string
  titleKey: string
  summaryKey: string
}

const DOC_CONFIGS: Record<DocFeature, DocConfig> = {
  sources: {
    path: '/sources/overview',
    titleKey: 'docs.sources.title',
    summaryKey: 'docs.sources.summary',
  },
  'sources-api': {
    path: '/sources/apis/overview',
    titleKey: 'docs.sourcesApi.title',
    summaryKey: 'docs.sourcesApi.summary',
  },
  'sources-mcp': {
    path: '/sources/mcp-servers/overview',
    titleKey: 'docs.sourcesMcp.title',
    summaryKey: 'docs.sourcesMcp.summary',
  },
  'sources-local': {
    path: '/sources/local-filesystems',
    titleKey: 'docs.sourcesLocal.title',
    summaryKey: 'docs.sourcesLocal.summary',
  },
  skills: {
    path: '/skills/overview',
    titleKey: 'docs.skills.title',
    summaryKey: 'docs.skills.summary',
  },
  statuses: {
    path: '/statuses/overview',
    titleKey: 'docs.statuses.title',
    summaryKey: 'docs.statuses.summary',
  },
  permissions: {
    path: '/core-concepts/permissions',
    titleKey: 'docs.permissions.title',
    summaryKey: 'docs.permissions.summary',
  },
  labels: {
    path: '/labels/overview',
    titleKey: 'docs.labels.title',
    summaryKey: 'docs.labels.summary',
  },
  workspaces: {
    path: '/go-further/workspaces',
    titleKey: 'docs.workspaces.title',
    summaryKey: 'docs.workspaces.summary',
  },
  themes: {
    path: '/go-further/themes',
    titleKey: 'docs.themes.title',
    summaryKey: 'docs.themes.summary',
  },
  'app-settings': {
    path: '/reference/config/config-file',
    titleKey: 'docs.appSettings.title',
    summaryKey: 'docs.appSettings.summary',
  },
  preferences: {
    path: '/reference/config/preferences',
    titleKey: 'docs.preferences.title',
    summaryKey: 'docs.preferences.summary',
  },
}

/** Default English strings (fallback when no translation function provided) */
const DEFAULT_STRINGS: Record<string, string> = {
  'docs.sources.title': 'Sources',
  'docs.sources.summary': 'Connect external data like MCP servers, REST APIs, and local filesystems. Sources give your agent tools to access services like GitHub, Linear, or your Obsidian vault.',
  'docs.sourcesApi.title': 'APIs',
  'docs.sourcesApi.summary': 'Connect to any REST API with flexible authentication. Make HTTP requests to external services directly from your conversations.',
  'docs.sourcesMcp.title': 'MCP Servers',
  'docs.sourcesMcp.summary': 'Connect to Model Context Protocol servers for rich tool integrations. MCP servers provide structured access to services like GitHub, Linear, and Notion.',
  'docs.sourcesLocal.title': 'Local Folders',
  'docs.sourcesLocal.summary': 'Give your agent access to local directories like Obsidian vaults, code repositories, or data folders on your machine.',
  'docs.skills.title': 'Skills',
  'docs.skills.summary': 'Reusable instruction sets that teach your agent specialized behaviors. Create a SKILL.md file and invoke it with @mention in your messages.',
  'docs.statuses.title': 'Statuses',
  'docs.statuses.summary': 'Organize conversations into workflow states like Todo, In Progress, and Done. Open statuses appear in your inbox; closed ones move to the archive.',
  'docs.permissions.title': 'Permissions',
  'docs.permissions.summary': 'Control how much autonomy your agent has. Explore mode is read-only, Ask to Edit prompts before changes, and Execute mode runs without prompts.',
  'docs.labels.title': 'Labels',
  'docs.labels.summary': 'Tag sessions with colored labels for organization and filtering. Labels support hierarchical nesting, typed values, and auto-apply rules that extract data from messages using regex patterns.',
  'docs.workspaces.title': 'Workspaces',
  'docs.workspaces.summary': 'Separate configurations for different contexts like personal projects or work. Each workspace has its own sources, skills, statuses, and session history.',
  'docs.themes.title': 'Themes',
  'docs.themes.summary': 'Customize the visual appearance with a 6-color system. Override specific colors in theme.json or install preset themes for complete visual styles.',
  'docs.appSettings.title': 'App Settings',
  'docs.appSettings.summary': 'Configure global app settings like your default model, authentication method, and workspace list. Settings are stored in ~/.craft-agent/config.json.',
  'docs.preferences.title': 'Preferences',
  'docs.preferences.summary': 'Personal preferences like your name, timezone, and language that help the agent personalize responses. Stored in ~/.craft-agent/preferences.json.',
}

/**
 * Legacy DOCS export for backwards compatibility.
 * Uses default English strings.
 */
export const DOCS: Record<DocFeature, DocInfo> = Object.fromEntries(
  Object.entries(DOC_CONFIGS).map(([feature, config]) => [
    feature,
    {
      path: config.path,
      title: DEFAULT_STRINGS[config.titleKey],
      summary: DEFAULT_STRINGS[config.summaryKey],
    },
  ])
) as Record<DocFeature, DocInfo>

/**
 * Get the full documentation URL for a feature
 */
export function getDocUrl(feature: DocFeature): string {
  return `${DOC_BASE_URL}${DOC_CONFIGS[feature].path}`
}

/**
 * Get the doc info (title, summary, path) for a feature.
 * Uses default English strings.
 * @deprecated Use getLocalizedDocInfo() for i18n support
 */
export function getDocInfo(feature: DocFeature): DocInfo {
  return DOCS[feature]
}

/** Translation function type */
export type TranslateFunction = (key: string) => string

/**
 * Get localized doc info using a translation function.
 * @param feature - The documentation feature
 * @param t - Translation function (e.g., from react-i18next useTranslation())
 * @returns DocInfo with localized title and summary
 */
export function getLocalizedDocInfo(feature: DocFeature, t: TranslateFunction): DocInfo {
  const config = DOC_CONFIGS[feature]
  return {
    path: config.path,
    title: t(config.titleKey),
    summary: t(config.summaryKey),
  }
}

/**
 * Get all doc translation keys for a feature.
 * Useful for ensuring translations are defined.
 */
export function getDocTranslationKeys(feature: DocFeature): { titleKey: string; summaryKey: string } {
  const config = DOC_CONFIGS[feature]
  return {
    titleKey: config.titleKey,
    summaryKey: config.summaryKey,
  }
}
