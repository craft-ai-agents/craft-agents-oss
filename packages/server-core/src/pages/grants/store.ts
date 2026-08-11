/**
 * Grant store — the authorization record for page queries (ADR 0001, WS7).
 *
 * `page.json` carries the agent's REQUEST; this file carries the user's
 * DECISION. They are deliberately separate, and this one lives outside every
 * agent-writable directory: if the agent could edit the decision, hand-editing
 * a manifest would grant itself access, and the "hand-edited page.json grants
 * nothing" property would be a claim rather than a fact.
 *
 * Mutations are serialized for the same reason PageCatalogService serializes
 * them — concurrent read-modify-write on one JSON file loses entries.
 */

import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isTrustedReadOnlyTool } from './allowlist.ts'
import { validateParamSchema, validateParams, type ParamSchema } from './param-schema.ts'

const GRANTS_FILE = 'page-grants.json'
const VERSION = 1

export interface Grant {
  grantId: string
  pageId: string
  sourceSlug: string
  toolName: string
  /** Baked at approval time. Never overridable by the page. */
  fixedArgs: Record<string, unknown>
  paramSchema: ParamSchema
  approvedAt: number
}

export interface ApproveInput {
  pageId: string
  sourceSlug: string
  toolName: string
  fixedArgs: Record<string, unknown>
  paramSchema: ParamSchema
}

interface GrantsFile {
  version: number
  grants: Grant[]
}

export type ResolveResult =
  | { ok: true; grant: Grant; args: Record<string, unknown> }
  | { ok: false; reason: string }

/** Injectable so the execution-time allowlist check is testable. */
export interface AllowlistCheck {
  isTrusted: (sourceSlug: string, toolName: string) => boolean
}
const DEFAULT_ALLOWLIST: AllowlistCheck = { isTrusted: isTrustedReadOnlyTool }

export class GrantStore {
  private readonly path: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly workspaceRootPath: string) {
    this.path = join(workspaceRootPath, GRANTS_FILE)
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async read(): Promise<GrantsFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf-8')) as GrantsFile
      if (!parsed || !Array.isArray(parsed.grants)) throw new Error('shape')
      return parsed
    } catch {
      // Fail CLOSED: an unreadable grant file means no page is authorised for
      // anything, which is the safe direction for an authorization record.
      return { version: VERSION, grants: [] }
    }
  }

  private async write(file: GrantsFile): Promise<void> {
    await mkdir(this.workspaceRootPath, { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8')
    await rename(tmp, this.path)
  }

  /**
   * Record a user's approval. Throws rather than storing anything it cannot
   * fully validate — an invalid grant is worse than no grant.
   */
  async approve(input: ApproveInput): Promise<string> {
    if (!isTrustedReadOnlyTool(input.sourceSlug, input.toolName)) {
      throw new Error(
        `"${input.sourceSlug}.${input.toolName}" is not on the trusted read-only allowlist`,
      )
    }

    const schemaCheck = validateParamSchema(input.paramSchema)
    if (!schemaCheck.ok) throw new Error(`invalid parameter schema: ${schemaCheck.reason}`)

    // A runtime parameter sharing a name with a fixed argument would make merge
    // order decide whose value wins. Rejecting the overlap removes the question
    // rather than trusting the merge to stay correct forever.
    const collisions = Object.keys(input.paramSchema)
      .filter(name => Object.prototype.hasOwnProperty.call(input.fixedArgs, name))
    if (collisions.length > 0) {
      throw new Error(`parameters collide with fixed arguments: ${collisions.join(', ')}`)
    }

    return this.serialize(async () => {
      const file = await this.read()
      const grant: Grant = { grantId: randomUUID(), approvedAt: Date.now(), ...input }
      await this.write({ version: VERSION, grants: [...file.grants, grant] })
      return grant.grantId
    })
  }

  async get(grantId: string): Promise<Grant | null> {
    return (await this.read()).grants.find(g => g.grantId === grantId) ?? null
  }

  async listForPage(pageId: string): Promise<Grant[]> {
    return (await this.read()).grants.filter(g => g.pageId === pageId)
  }

  async pageHasGrants(pageId: string): Promise<boolean> {
    return (await this.listForPage(pageId)).length > 0
  }

  /**
   * Turn a page's request into the arguments that will actually be sent.
   *
   * Re-checks the allowlist: a tool may have been removed from it since the
   * grant was approved, and an old grant must not outlive that decision.
   */
  async resolveArgs(
    grantId: string,
    params: Record<string, unknown>,
    allowlist: AllowlistCheck = DEFAULT_ALLOWLIST,
  ): Promise<ResolveResult> {
    const grant = await this.get(grantId)
    if (!grant) return { ok: false, reason: 'unknown grant' }

    if (!allowlist.isTrusted(grant.sourceSlug, grant.toolName)) {
      return { ok: false, reason: 'tool is no longer on the trusted read-only allowlist' }
    }

    const paramCheck = validateParams(grant.paramSchema, params)
    if (!paramCheck.ok) return { ok: false, reason: paramCheck.reason }

    // fixedArgs last. Belt-and-braces only: approve() rejects grants whose
    // parameters collide with fixed arguments, so these objects always have
    // disjoint keys and the ordering is unobservable. The collision check is
    // the actual guarantee — verified by mutation testing, which showed
    // reversing this spread fails no test while removing the collision check
    // fails immediately. Kept so the safe ordering survives if that check is
    // ever relaxed.
    return { ok: true, grant, args: { ...params, ...grant.fixedArgs } }
  }

  async revoke(grantId: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.read()
      await this.write({ version: VERSION, grants: file.grants.filter(g => g.grantId !== grantId) })
    })
  }

  async revokeForPage(pageId: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.read()
      await this.write({ version: VERSION, grants: file.grants.filter(g => g.pageId !== pageId) })
    })
  }

  /** Called when a source is removed or re-authenticated. */
  async revokeForSource(sourceSlug: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.read()
      await this.write({ version: VERSION, grants: file.grants.filter(g => g.sourceSlug !== sourceSlug) })
    })
  }

  /**
   * Stable hash of a page's approved query SET.
   *
   * Consent is re-requested when this changes — not when the page's appearance
   * changes. Restyling a dashboard must not nag the user about permissions
   * they already granted.
   */
  async querySetHash(pageId: string): Promise<string> {
    const grants = await this.listForPage(pageId)
    const canonical = grants
      .map(g => `${g.sourceSlug}.${g.toolName}(${JSON.stringify(g.fixedArgs)}|${JSON.stringify(g.paramSchema)})`)
      .sort()
      .join('\n')
    return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
  }
}
