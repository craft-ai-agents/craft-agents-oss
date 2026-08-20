const FORBIDDEN = new Set(['value', 'payload', 'secret', 'token', 'refreshToken'])

export interface ConnectionListRow {
  readonly id: string
  readonly workspaceId: string
  readonly integrationId: string
  readonly credentialRefId: string
  readonly storageMode: string
  readonly scopes: readonly string[]
}

export interface ConnectionAuditRow {
  readonly connectionId: string
  readonly eventType: string
  readonly occurredAt: number
  readonly actorId: string | null
  readonly outcome: string
  readonly payloadDigest: string
  readonly action?: string
}

export function sanitizeConnectionAuditRows(rows: readonly unknown[]): ConnectionAuditRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid connection audit metadata')
    const rec = row as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (FORBIDDEN.has(key)) throw new Error(`Invalid connection metadata field: ${key}`)
    }
    if (typeof rec.connectionId !== 'string' || typeof rec.eventType !== 'string') {
      throw new Error('Invalid connection audit metadata')
    }
    if (typeof rec.occurredAt !== 'number' || typeof rec.outcome !== 'string' || typeof rec.payloadDigest !== 'string') {
      throw new Error('Invalid connection audit metadata')
    }
    if (rec.actorId != null && typeof rec.actorId !== 'string') {
      throw new Error('Invalid connection audit metadata')
    }
    if (rec.action != null && typeof rec.action !== 'string') {
      throw new Error('Invalid connection audit metadata')
    }
    return {
      connectionId: rec.connectionId,
      eventType: rec.eventType,
      occurredAt: rec.occurredAt,
      actorId: rec.actorId ?? null,
      outcome: rec.outcome,
      payloadDigest: rec.payloadDigest,
      ...(typeof rec.action === 'string' ? { action: rec.action } : {}),
    }
  })
}

export interface ConnectionBindingRow {
  readonly id: string
  readonly connectionId: string
  readonly consumerId: string
  readonly purpose: string
  readonly actions: readonly string[]
  readonly resources: readonly string[]
}

export function sanitizeConnectionBindingRows(rows: readonly unknown[]): ConnectionBindingRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid connection binding metadata')
    const rec = row as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (FORBIDDEN.has(key)) throw new Error(`Invalid connection metadata field: ${key}`)
    }
    if (typeof rec.id !== 'string' || typeof rec.connectionId !== 'string' || typeof rec.consumerId !== 'string') {
      throw new Error('Invalid connection binding metadata')
    }
    if (typeof rec.purpose !== 'string') throw new Error('Invalid connection binding metadata')
    const actions = Array.isArray(rec.actions) ? rec.actions.filter((item) => typeof item === 'string') : []
    const resources = Array.isArray(rec.resources) ? rec.resources.filter((item) => typeof item === 'string') : []
    return {
      id: rec.id,
      connectionId: rec.connectionId,
      consumerId: rec.consumerId,
      purpose: rec.purpose,
      actions,
      resources,
    }
  })
}

export function sanitizeConnectionRows(rows: readonly unknown[]): ConnectionListRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid connection metadata')
    const rec = row as Record<string, unknown>
    for (const key of Object.keys(rec)) {
      if (FORBIDDEN.has(key)) throw new Error(`Invalid connection metadata field: ${key}`)
    }
    if (typeof rec.id !== 'string' || typeof rec.integrationId !== 'string') {
      throw new Error('Invalid connection metadata')
    }
    if (typeof rec.credentialRefId !== 'string' || typeof rec.storageMode !== 'string') {
      throw new Error('Invalid connection metadata')
    }
    if (typeof rec.workspaceId !== 'string') {
      throw new Error('Invalid connection metadata')
    }
    const scopes = Array.isArray(rec.scopes) ? rec.scopes.filter((scope) => typeof scope === 'string') : []
    return {
      id: rec.id,
      workspaceId: rec.workspaceId,
      integrationId: rec.integrationId,
      credentialRefId: rec.credentialRefId,
      storageMode: rec.storageMode,
      scopes,
    }
  })
}
