/**
 * AutomationMatcher → ExtensionRecord (projection only — no disk writes).
 */

import type { AutomationEvent, AutomationMatcher, AutomationsConfig } from '../../automations/types.ts'
import type { ExtensionPermission, ExtensionRecord, ExtensionStatus } from '../types.ts'
import { parseExtensionManifest } from '../manifest.ts'

export interface AutomationProjection {
  event: AutomationEvent
  matcher: AutomationMatcher
  index: number
  workspaceId: string
}

export interface AutomationRecordOptions {
  enabled?: boolean
}

function automationPermissions(matcher: AutomationMatcher): ExtensionPermission[] {
  const perms = new Set<ExtensionPermission>(['automation.register', 'ui.command'])
  for (const action of matcher.actions ?? []) {
    if (action.type === 'prompt') {
      perms.add('sessions.create')
      perms.add('sessions.update')
    } else if (action.type === 'webhook') {
      perms.add('network.request')
    } else if (action.type === 'knowledge') {
      perms.add('knowledge.read')
      perms.add('knowledge.write')
    } else if (action.type === 'cloud_run.submit') {
      perms.add('sessions.create')
      perms.add('network.request')
    }
  }
  return [...perms]
}

function displayName(event: AutomationEvent, matcher: AutomationMatcher, index: number): string {
  if (matcher.name?.trim()) return matcher.name.trim()
  const first = matcher.actions?.[0]
  if (first && 'type' in first) {
    if (first.type === 'prompt' && 'prompt' in first && typeof first.prompt === 'string') {
      const p = first.prompt.trim()
      if (p) return p.length > 48 ? `${p.slice(0, 45)}…` : p
    }
    if (first.type === 'webhook' && 'url' in first && typeof first.url === 'string') {
      return `Webhook ${first.url}`
    }
  }
  return `${event} #${index + 1}`
}

/** Pure: single automation matcher → ExtensionRecord. */
export function automationToExtensionRecord(
  proj: AutomationProjection,
  options: AutomationRecordOptions = {},
): ExtensionRecord {
  const matcherId = proj.matcher.id ?? String(proj.index)
  const id = `automation:${proj.workspaceId}:${proj.event}:${matcherId}`
  const sourceOn = proj.matcher.enabled !== false
  const flagOn = options.enabled !== false
  const enabled = sourceOn && flagOn
  const status: ExtensionStatus = enabled ? 'enabled' : 'disabled'

  const manifest = parseExtensionManifest({
    id,
    name: displayName(proj.event, proj.matcher, proj.index),
    version: '0.0.0',
    runtime: 'automation-pack',
    permissions: automationPermissions(proj.matcher),
    contributes: {
      automationTriggers: [{ event: proj.event, matcher: proj.matcher.matcher, cron: proj.matcher.cron }],
      automationActions: (proj.matcher.actions ?? []).map((a) => ({ type: a.type })),
    },
  })

  return {
    id,
    manifest,
    category: 'automations',
    providerId: 'installed',
    status,
    worksIn: ['Automations engine', 'Event bus'],
    installTarget: 'workspace',
    description: proj.matcher.cron
      ? `cron: ${proj.matcher.cron}`
      : proj.matcher.matcher
        ? `match: ${proj.matcher.matcher}`
        : `event: ${proj.event}`,
    readOnly: true,
    sourceEnabled: sourceOn,
    tags: [proj.event],
  }
}

/** Flatten AutomationsConfig into projections. */
export function flattenAutomationsConfig(
  config: AutomationsConfig | null | undefined,
  workspaceId: string,
): AutomationProjection[] {
  if (!config?.automations) return []
  const out: AutomationProjection[] = []
  for (const [event, matchers] of Object.entries(config.automations)) {
    if (!Array.isArray(matchers)) continue
    matchers.forEach((matcher, index) => {
      out.push({ event: event as AutomationEvent, matcher, index, workspaceId })
    })
  }
  return out
}

export function automationsToExtensionRecords(
  config: AutomationsConfig | null | undefined,
  workspaceId: string,
  enabledMap: Record<string, boolean> = {},
): ExtensionRecord[] {
  return flattenAutomationsConfig(config, workspaceId).map((proj) => {
    const matcherId = proj.matcher.id ?? String(proj.index)
    const id = `automation:${proj.workspaceId}:${proj.event}:${matcherId}`
    const flag = enabledMap[id]
    return automationToExtensionRecord(proj, { enabled: flag === undefined ? true : flag })
  })
}
