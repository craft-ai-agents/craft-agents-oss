/**
 * Capability broker (S-05).
 *
 * Main holds CredentialManager. Workers never receive raw secrets.
 * Main mints temporary scoped capability tokens; workers redeem them via
 * parentPort RPC so main can resolve secrets and perform egress.
 *
 * Preferred secrets.use form is credentialIdToAccount output, e.g.
 *   secrets.use:source_bearer::ws::src
 * Sources-adapter shorthand (mcp::ws::slug / api::ws::slug) is accepted
 * via heuristic remap to source_bearer / source_apikey.
 */

import { randomBytes } from 'node:crypto'
import {
  accountToCredentialId,
  type CredentialId,
  type StoredCredential,
} from '@craft-agent/shared/credentials'

export const DEFAULT_CAPABILITY_TTL_MS = 15 * 60 * 1000

export const SECRETS_USE_PREFIX = 'secrets.use:'
export const NETWORK_REQUEST_PERMISSION = 'network.request'

export interface ScopedCapability {
  token: string
  extensionId: string
  /** e.g. secrets.use:source_bearer::ws::src OR network.request */
  permission: string
  /** for secrets.use:* — the account key after the prefix */
  credentialAccount?: string
  expiresAt: number
  singleUse?: boolean
}

export type GetCredentialFn = (
  id: CredentialId,
) => Promise<StoredCredential | null>

export interface MintCapabilityInput {
  extensionId: string
  permission: string
  grantedPermissions: readonly string[]
  ttlMs?: number
  singleUse?: boolean
}

export interface ProxyFetchInput {
  token: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  getCredential: GetCredentialFn
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>
  /** optional allowlist of URL prefixes */
  allowedUrlPrefixes?: string[]
}

export interface ProxyFetchResult {
  status: number
  body: string
  headers: Record<string, string>
}

/**
 * Parse secrets.use: suffix into a credential account key accepted by
 * accountToCredentialId. Tries the raw suffix first (preferred form =
 * credentialIdToAccount output), then mcp/api → source_bearer/source_apikey.
 */
export function parseSecretsUseAccount(permission: string): string | null {
  if (!permission.startsWith(SECRETS_USE_PREFIX)) return null
  const suffix = permission.slice(SECRETS_USE_PREFIX.length).trim()
  if (!suffix) return null

  if (accountToCredentialId(suffix)) return suffix

  // Heuristic: sources adapter emits mcp::ws::slug / api::ws::slug
  const parts = suffix.split('::')
  if (parts.length === 3) {
    const [kind, workspaceId, sourceId] = parts
    if (workspaceId && sourceId) {
      if (kind === 'mcp') {
        const account = `source_bearer::${workspaceId}::${sourceId}`
        if (accountToCredentialId(account)) return account
      }
      if (kind === 'api') {
        const account = `source_apikey::${workspaceId}::${sourceId}`
        if (accountToCredentialId(account)) return account
      }
    }
  }

  return null
}

export class CapabilityBroker {
  private readonly caps = new Map<string, ScopedCapability>()
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  mint(input: MintCapabilityInput): ScopedCapability {
    const extensionId = input.extensionId?.trim()
    if (!extensionId) throw new Error('extensionId is required')

    const permission = input.permission?.trim()
    if (!permission) throw new Error('permission is required')

    const granted = input.grantedPermissions ?? []
    if (!granted.includes(permission)) {
      throw new Error(`Permission not granted: ${permission}`)
    }

    let credentialAccount: string | undefined
    if (permission.startsWith(SECRETS_USE_PREFIX)) {
      const account = parseSecretsUseAccount(permission)
      if (!account) {
        throw new Error(
          `Invalid secrets.use form: ${permission} (preferred: secrets.use:<credentialIdToAccount>)`,
        )
      }
      credentialAccount = account
    }

    const ttlMs =
      typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
        ? input.ttlMs
        : DEFAULT_CAPABILITY_TTL_MS

    const cap: ScopedCapability = {
      token: randomBytes(32).toString('base64url'),
      extensionId,
      permission,
      credentialAccount,
      expiresAt: this.now() + ttlMs,
    }
    if (input.singleUse === true) cap.singleUse = true
    this.caps.set(cap.token, cap)
    return cap
  }

  /** Peek live capability; expired → null and deleted. Never logs token. */
  peek(token: string): ScopedCapability | null {
    if (!token) return null
    const cap = this.caps.get(token)
    if (!cap) return null
    if (this.now() >= cap.expiresAt) {
      this.caps.delete(token)
      return null
    }
    return cap
  }

  revoke(token: string): void {
    if (!token) return
    this.caps.delete(token)
  }

  revokeExtension(extensionId: string): void {
    if (!extensionId) return
    for (const [token, cap] of this.caps) {
      if (cap.extensionId === extensionId) this.caps.delete(token)
    }
  }

  /**
   * Resolve secret value for a capability (main-only).
   * Does not return the secret to the worker — caller must keep it in main.
   */
  async resolveSecret(
    token: string,
    getCredential: GetCredentialFn,
  ): Promise<string> {
    const cap = this.peek(token)
    if (!cap) throw new Error('Invalid or expired capability token')
    if (!cap.credentialAccount) {
      throw new Error(`Capability is not secrets.use: ${cap.permission}`)
    }
    const id = accountToCredentialId(cap.credentialAccount)
    if (!id) throw new Error('Invalid credential account on capability')

    const stored = await getCredential(id)
    if (!stored || typeof stored.value !== 'string' || stored.value.length === 0) {
      throw new Error('Credential not found')
    }

    if (cap.singleUse) this.caps.delete(token)
    return stored.value
  }

  /**
   * Authenticated fetch: redeem secrets.use or network.request capability.
   * Attaches Authorization: Bearer <secret> when capability is secrets.use.
   */
  async proxyFetch(input: ProxyFetchInput): Promise<ProxyFetchResult> {
    const cap = this.peek(input.token)
    if (!cap) throw new Error('Invalid or expired capability token')

    const isSecrets = Boolean(cap.credentialAccount)
    const isNetwork = cap.permission === NETWORK_REQUEST_PERMISSION
    if (!isSecrets && !isNetwork) {
      throw new Error(`Capability cannot proxy fetch: ${cap.permission}`)
    }

    const url = input.url
    if (typeof url !== 'string' || !url) {
      throw new Error('url is required')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid url')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http(s) URLs are allowed')
    }

    if (input.allowedUrlPrefixes && input.allowedUrlPrefixes.length > 0) {
      const ok = input.allowedUrlPrefixes.some((p) => url.startsWith(p))
      if (!ok) throw new Error('URL not in allowlist')
    }

    const headers: Record<string, string> = { ...(input.headers ?? {}) }
    // Never let the worker override Authorization when we attach a secret.
    if (isSecrets) {
      if (!cap.credentialAccount) {
        throw new Error(`Capability is not secrets.use: ${cap.permission}`)
      }
      const id = accountToCredentialId(cap.credentialAccount)
      if (!id) throw new Error('Invalid credential account on capability')
      const stored = await input.getCredential(id)
      if (!stored || typeof stored.value !== 'string' || stored.value.length === 0) {
        throw new Error('Credential not found')
      }
      headers.Authorization = `Bearer ${stored.value}`
    }

    const fetchImpl = input.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is not available')
    }

    const method = (input.method ?? 'GET').toUpperCase()
    const init: RequestInit = {
      method,
      headers,
    }
    if (
      input.body !== undefined &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      init.body = input.body
    }

    const res = await fetchImpl(url, init)
    const body = await res.text()
    const outHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      outHeaders[key] = value
    })

    if (cap.singleUse) this.caps.delete(input.token)

    return {
      status: res.status,
      body,
      headers: outHeaders,
    }
  }

  /** Test / diagnostics: live token count (never exposes tokens). */
  size(): number {
    const now = this.now()
    for (const [token, cap] of this.caps) {
      if (now >= cap.expiresAt) this.caps.delete(token)
    }
    return this.caps.size
  }

  clear(): void {
    this.caps.clear()
  }
}

let singleton: CapabilityBroker | null = null

export function getCapabilityBroker(): CapabilityBroker {
  if (!singleton) singleton = new CapabilityBroker()
  return singleton
}

/** Test helper — drop singleton. */
export function resetCapabilityBroker(): void {
  if (singleton) singleton.clear()
  singleton = null
}

/** Test helper — install a preconfigured broker as singleton. */
export function setCapabilityBrokerForTests(broker: CapabilityBroker | null): void {
  singleton = broker
}
