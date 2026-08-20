/**
 * Fail-closed ExtensionManifest parser (S-05 §3.4).
 *
 * Unknown runtime / permission / contribute key → whole manifest rejected.
 * Mirrors marketplace catalog fail-closed style (hand validation + zod).
 */

import { z } from 'zod'
import {
  EXTENSION_CONTRIBUTE_KEYS,
  EXTENSION_RUNTIMES,
  type ExtensionContributeKey,
  type ExtensionManifest,
  type ExtensionPermission,
  type ExtensionRuntime,
} from './types.ts'
import { isExtensionPermission } from './permissions.ts'

const ID_RE = /^[a-z0-9][a-z0-9._:@/-]*$/i

export class ExtensionManifestValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid extension manifest: ${issues.join('; ')}`)
    this.name = 'ExtensionManifestValidationError'
    this.issues = issues
  }
}

const runtimeSchema = z.enum(EXTENSION_RUNTIMES as unknown as [ExtensionRuntime, ...ExtensionRuntime[]])

const permissionSchema = z.string().refine(isExtensionPermission, {
  message: 'unknown extension permission',
})

const contributeKeySet = new Set<string>(EXTENSION_CONTRIBUTE_KEYS)

const contributesSchema = z
  .record(z.string(), z.unknown())
  .superRefine((val, ctx) => {
    for (const key of Object.keys(val)) {
      if (!contributeKeySet.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown contributes key: ${key}`,
          path: [key],
        })
      }
    }
  })
  .optional()

export const ExtensionManifestSchema = z.object({
  id: z.string().min(1).regex(ID_RE, 'invalid extension id'),
  name: z.string().min(1),
  version: z.string().min(1),
  runtime: runtimeSchema,
  activationEvents: z.array(z.string()).optional(),
  permissions: z.array(permissionSchema),
  contributes: contributesSchema,
  engines: z.object({ craft: z.string().optional() }).optional(),
  dependencies: z.array(z.string()).optional(),
})

export type ParsedExtensionManifest = z.infer<typeof ExtensionManifestSchema>

function collectZodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.length ? i.path.join('.') : '(root)'
    return `${path}: ${i.message}`
  })
}

/**
 * Parse + validate an extension manifest. Throws ExtensionManifestValidationError
 * on any schema violation — callers MUST reject the whole package (fail-closed).
 */
export function parseExtensionManifest(raw: unknown): ExtensionManifest {
  const result = ExtensionManifestSchema.safeParse(raw)
  if (!result.success) {
    throw new ExtensionManifestValidationError(collectZodIssues(result.error))
  }
  const data = result.data
  // Normalize contributes to known keys only (strip undefined arrays).
  let contributes: ExtensionManifest['contributes']
  if (data.contributes) {
    contributes = {}
    for (const key of EXTENSION_CONTRIBUTE_KEYS) {
      const v = data.contributes[key]
      if (v !== undefined) {
        contributes[key as ExtensionContributeKey] = Array.isArray(v) ? v : [v]
      }
    }
    if (Object.keys(contributes).length === 0) contributes = undefined
  }
  return {
    id: data.id,
    name: data.name,
    version: data.version,
    runtime: data.runtime,
    activationEvents: data.activationEvents,
    permissions: data.permissions as ExtensionPermission[],
    contributes,
    engines: data.engines,
    dependencies: data.dependencies,
  }
}

/** Non-throwing variant. */
export function tryParseExtensionManifest(
  raw: unknown,
): { ok: true; manifest: ExtensionManifest } | { ok: false; issues: string[] } {
  try {
    return { ok: true, manifest: parseExtensionManifest(raw) }
  } catch (e) {
    if (e instanceof ExtensionManifestValidationError) {
      return { ok: false, issues: e.issues }
    }
    return { ok: false, issues: [e instanceof Error ? e.message : String(e)] }
  }
}
