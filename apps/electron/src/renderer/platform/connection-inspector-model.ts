import { sanitizeConnectionRows } from '../pages/connections-list'

export const CONNECTION_INSPECTOR_FIELD_IDS = [
  'provider',
  'storageMode',
  'credentialRef',
  'scopes',
] as const

export interface ConnectionInspectorFields {
  readonly provider: string
  readonly storageMode: string
  readonly credentialRef: string
  readonly scopes: string
}

export function projectConnectionInspector(row: unknown): ConnectionInspectorFields {
  const [sanitized] = sanitizeConnectionRows([row])
  if (!sanitized) throw new Error('Invalid connection metadata')
  return {
    provider: sanitized.integrationId,
    storageMode: sanitized.storageMode,
    credentialRef: sanitized.credentialRefId,
    scopes: sanitized.scopes.length > 0 ? sanitized.scopes.join(', ') : '—',
  }
}
