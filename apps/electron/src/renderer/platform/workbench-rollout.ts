import { KEYS, getKeyString } from '@/lib/local-storage'

/**
 * PR-2 Workbench rollout contract.
 *
 * The operator capability is deliberately injected by the host boundary. The
 * persisted user preference is only one half of the decision.
 */
export type WorkbenchAvailability = 'unavailable' | 'legacy' | 'enabled'

export interface PreferenceStorage {
  getItem(key: string): string | null
}

function parseStoredBoolean(raw: string | null): boolean | undefined {
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads the explicit Workbench preference.
 *
 * A present new key is authoritative, including when malformed (malformed
 * values fail closed). The legacy key is read only when the new key is absent.
 */
export function readWorkbenchPreference(
  storage?: PreferenceStorage | null,
): boolean {
  const source =
    storage ??
    (typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null)
  if (!source) return false

  try {
    const currentRaw = source.getItem(getKeyString(KEYS.workbenchEnabled))
    if (currentRaw !== null) return parseStoredBoolean(currentRaw) ?? false

    return (
      parseStoredBoolean(source.getItem(getKeyString(KEYS.workbenchLegacyEnabled))) ??
      false
    )
  } catch {
    return false
  }
}

/**
 * Resolves the two-key Workbench rollout contract fail-closed.
 */
export function resolveWorkbenchAvailability(
  operatorCapability: unknown,
  userPreference: unknown,
): WorkbenchAvailability {
  if (operatorCapability !== true) return 'unavailable'
  return userPreference === true ? 'enabled' : 'legacy'
}
