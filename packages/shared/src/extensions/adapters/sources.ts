/**
 * LoadedSource → ExtensionRecord (projection only — no disk writes).
 */

import type { LoadedSource } from '../../sources/types.ts'
import type { ExtensionPermission, ExtensionRecord, ExtensionStatus } from '../types.ts'
import { parseExtensionManifest } from '../manifest.ts'

function sourcePermissions(source: LoadedSource): ExtensionPermission[] {
  const perms = new Set<ExtensionPermission>(['network.request', 'ui.command'])
  if (source.config.type === 'local') {
    perms.add('filesystem.read')
    perms.delete('network.request')
  }
  if (source.config.type === 'mcp') {
    perms.add('ui.panel')
  }
  // Credential presence → secrets.use bookkeeping (scoped id, not secret value).
  const credKey = `${source.config.type}::${source.workspaceId}::${source.config.slug}`
  if (source.config.isAuthenticated || source.config.connectionStatus === 'connected') {
    perms.add(`secrets.use:${credKey}`)
  }
  return [...perms]
}

export interface SourceRecordOptions {
  enabled?: boolean
}

/** Pure: LoadedSource → ExtensionRecord. */
export function sourceToExtensionRecord(
  source: LoadedSource,
  options: SourceRecordOptions = {},
): ExtensionRecord {
  const slug = source.config.slug
  const id = `source:${source.workspaceId}:${slug}`
  const sourceOn = source.config.enabled !== false
  const flagOn = options.enabled !== false
  const enabled = sourceOn && flagOn
  const status: ExtensionStatus = enabled ? 'enabled' : 'disabled'

  const worksIn =
    source.config.type === 'mcp'
      ? ['Agent tools', 'Sources panel', 'Mentions']
      : source.config.type === 'api'
        ? ['Agent tools', 'Sources panel']
        : ['Filesystem context', 'Sources panel']

  const manifest = parseExtensionManifest({
    id,
    name: source.config.name || slug,
    version: '0.0.0',
    runtime: 'mcp-source',
    permissions: sourcePermissions(source),
    contributes: {
      agentActions: [{ id: slug, provider: source.config.provider, type: source.config.type }],
    },
  })

  return {
    id,
    manifest,
    category: source.config.provider === 'siyuan' || slug.includes('knowledge') ? 'knowledge' : 'sources',
    providerId: 'installed',
    status,
    worksIn,
    installTarget: 'workspace',
    description: source.config.tagline ?? source.guide?.scope,
    readOnly: true,
    sourceEnabled: sourceOn,
    accountLabel: source.config.provider,
    tags: [source.config.type, source.config.provider].filter(Boolean),
  }
}

export function sourcesToExtensionRecords(
  sources: LoadedSource[],
  enabledMap: Record<string, boolean> = {},
): ExtensionRecord[] {
  return sources
    .filter((s) => !s.isBuiltin)
    .map((s) => {
      const id = `source:${s.workspaceId}:${s.config.slug}`
      const flag = enabledMap[id]
      return sourceToExtensionRecord(s, { enabled: flag === undefined ? true : flag })
    })
}
