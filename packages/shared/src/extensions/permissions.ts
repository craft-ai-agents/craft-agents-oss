/**
 * Extension permission vocabulary + risk grouping (S-05 §3.6).
 */

import type { ExtensionPermission } from './types.ts'

/** Fixed (non-secrets.use) permission tokens. */
export const EXTENSION_PERMISSIONS = [
  'knowledge.read',
  'knowledge.write',
  'knowledge.delete',
  'sessions.read',
  'sessions.create',
  'sessions.update',
  'browser.open',
  'browser.read',
  'browser.automate',
  'filesystem.read',
  'filesystem.write',
  'network.request',
  'shell.execute',
  'automation.register',
  'ui.panel',
  'ui.command',
] as const satisfies readonly Exclude<ExtensionPermission, `secrets.use:${string}`>[]

const FIXED = new Set<string>(EXTENSION_PERMISSIONS)

const SECRETS_USE_RE = /^secrets\.use:[A-Za-z0-9_.:@/-]+$/

/** High-risk group — UI highlights these on install/diff. */
export const HIGH_RISK_PERMISSIONS = [
  'shell.execute',
  'filesystem.write',
  'browser.automate',
  'network.request',
] as const

export type ExtensionPermissionRisk = 'high' | 'normal'

export function isExtensionPermission(value: unknown): value is ExtensionPermission {
  if (typeof value !== 'string' || value.length === 0) return false
  if (FIXED.has(value)) return true
  return SECRETS_USE_RE.test(value)
}

export function extensionPermissionRisk(perm: ExtensionPermission): ExtensionPermissionRisk {
  if (perm.startsWith('secrets.use:')) return 'high'
  if ((HIGH_RISK_PERMISSIONS as readonly string[]).includes(perm)) return 'high'
  return 'normal'
}

/**
 * Approximate agent alwaysAllow tool names → extension permissions.
 * Fail-soft: unknown tools map to ui.command (surface activation only).
 */
export function permissionsFromAlwaysAllow(alwaysAllow: string[] | undefined): ExtensionPermission[] {
  const out = new Set<ExtensionPermission>(['ui.command'])
  if (!alwaysAllow?.length) return [...out]
  for (const raw of alwaysAllow) {
    const t = raw.toLowerCase()
    if (t === 'bash' || t.includes('shell') || t.includes('bash')) {
      out.add('shell.execute')
      continue
    }
    if (t === 'write' || t === 'edit' || t === 'multiedit' || t === 'notebookedit') {
      out.add('filesystem.write')
      continue
    }
    if (t === 'read' || t === 'glob' || t === 'grep') {
      out.add('filesystem.read')
      continue
    }
    if (t.includes('browser') || t.includes('web_fetch') || t === 'webfetch') {
      out.add('browser.open')
      out.add('browser.read')
      continue
    }
    if (t.includes('knowledge')) {
      out.add('knowledge.read')
      continue
    }
  }
  return [...out]
}
