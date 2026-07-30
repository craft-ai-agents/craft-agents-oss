export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'automation' | 'permission' | 'theme'

/**
 * The agent-facing CLI command name.
 *
 * Single source of truth. The permissions allowlist in
 * `apps/electron/resources/permissions/default.json`, the feature-flag gate in
 * `agent/permissions-config.ts`, the Bash guard bypass in
 * `agent/core/pre-tool-use.ts`, and the system-prompt guidance all derive from
 * this constant — a hardcoded copy anywhere else will silently drift, which is
 * exactly how the ARCHstudio rebrand left `default.json` on `archstudio` while
 * every other site still emitted `craft-agent`.
 */
export const CLI_COMMAND = 'archstudio'

/**
 * Prefix shared by every generated read-only Bash pattern. Consumers that need
 * to recognise "is this one of our CLI patterns?" must compare against this
 * rather than against a hardcoded string.
 */
export const CLI_BASH_PATTERN_PREFIX = `^${CLI_COMMAND}\\s`

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: `${CLI_COMMAND} label --help`,
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      `${CLI_COMMAND} label list`,
      `${CLI_COMMAND} label create --name "Bug" --color "accent"`,
      `${CLI_COMMAND} label update bug --json '{"name":"Bug Report"}'`,
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: `${CLI_COMMAND} source --help`,
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      `${CLI_COMMAND} source list`,
      `${CLI_COMMAND} source get <slug>`,
      `${CLI_COMMAND} source update <slug> --json "{...}"`,
      `${CLI_COMMAND} source validate <slug>`,
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: `${CLI_COMMAND} skill --help`,
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      `${CLI_COMMAND} skill list`,
      `${CLI_COMMAND} skill get <slug>`,
      `${CLI_COMMAND} skill update <slug> --json "{...}"`,
      `${CLI_COMMAND} skill validate <slug>`,
    ],
  },
  automation: {
    namespace: 'automation',
    helpCommand: `${CLI_COMMAND} automation --help`,
    workspacePathScopes: ['automations.json', 'automations-history.jsonl'],
    readActions: ['list', 'get', 'validate', 'history', 'last-executed', 'test', 'lint'],
    quickExamples: [
      `${CLI_COMMAND} automation list`,
      `${CLI_COMMAND} automation create --event UserPromptSubmit --prompt "Summarize this prompt"`,
      `${CLI_COMMAND} automation update <id> --json "{"enabled":false}"`,
      `${CLI_COMMAND} automation history <id> --limit 20`,
      `${CLI_COMMAND} automation validate`,
    ],
    bashGuardPaths: ['automations.json', 'automations-history.jsonl'],
  },
  permission: {
    namespace: 'permission',
    helpCommand: `${CLI_COMMAND} permission --help`,
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      `${CLI_COMMAND} permission list`,
      `${CLI_COMMAND} permission get --source linear`,
      `${CLI_COMMAND} permission add-mcp-pattern "list" --comment "All list ops" --source linear`,
      `${CLI_COMMAND} permission validate`,
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: `${CLI_COMMAND} theme --help`,
    workspacePathScopes: ['config.json', 'theme.json', 'themes/*.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      `${CLI_COMMAND} theme get`,
      `${CLI_COMMAND} theme list-presets`,
      `${CLI_COMMAND} theme set-color-theme nord`,
      `${CLI_COMMAND} theme set-workspace-color-theme default`,
      `${CLI_COMMAND} theme set-override --json "{"accent":"#3b82f6"}"`,
    ],
    bashGuardPaths: ['config.json', 'theme.json', 'themes/*.json'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by the CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const CRAFT_AGENTS_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const CRAFT_AGENTS_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for CLI-owned paths.
 */
export const CRAFT_AGENTS_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const CRAFT_AGENTS_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only CLI bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getCraftAgentReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `${CLI_BASH_PATTERN_PREFIX}+${namespace}\\s+(${actions})\\b`,
      comment: `${CLI_COMMAND} ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: `^${CLI_COMMAND}\\s*$`, comment: `${CLI_COMMAND} bare invocation (prints help)` },
    { pattern: `${CLI_BASH_PATTERN_PREFIX}+(${namespaceAlternation})\\s*$`, comment: `${CLI_COMMAND} entity help` },
    { pattern: `${CLI_BASH_PATTERN_PREFIX}+(${namespaceAlternation})\\s+--help\\b`, comment: `${CLI_COMMAND} entity help flags` },
    { pattern: `${CLI_BASH_PATTERN_PREFIX}+--(help|version|discover)\\b`, comment: `${CLI_COMMAND} global flags` },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
