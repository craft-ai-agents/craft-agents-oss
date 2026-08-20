import { describe, expect, it } from 'bun:test'
import { KEYS, getKeyString } from '@/lib/local-storage'
import {
  readWorkbenchPreference,
  resolveWorkbenchAvailability,
} from '../workbench-rollout'

describe('Workbench two-key rollout contract', () => {
  it('makes an unavailable operator capability win over every user preference', () => {
    for (const operatorCapability of [false, undefined, null, 'true', 1]) {
      for (const userPreference of [false, true, undefined, null, 'true', 1]) {
        expect(resolveWorkbenchAvailability(operatorCapability, userPreference)).toBe('unavailable')
      }
    }
  })

  it('keeps the legacy experience when the operator enables the capability but the user does not opt in', () => {
    for (const userPreference of [false, undefined, null, 'true', 1]) {
      expect(resolveWorkbenchAvailability(true, userPreference)).toBe('legacy')
    }
  })

  it('enables Workbench only when both keys are explicitly true', () => {
    expect(resolveWorkbenchAvailability(true, true)).toBe('enabled')
  })
})

describe('Workbench preference migration', () => {
  const key = getKeyString(KEYS.workbenchEnabled)
  const legacyKey = getKeyString(KEYS.workbenchLegacyEnabled)

  function storage(values: Record<string, string>): { getItem: (name: string) => string | null } {
    return { getItem: (name) => values[name] ?? null }
  }

  it('uses the legacy boolean only when the new key is absent', () => {
    expect(readWorkbenchPreference(storage({ [legacyKey]: 'true' }))).toBe(true)
    expect(readWorkbenchPreference(storage({ [legacyKey]: 'false' }))).toBe(false)
  })

  it('treats a malformed present new key as authoritative and fails closed', () => {
    expect(readWorkbenchPreference(storage({ [key]: '"true"', [legacyKey]: 'true' }))).toBe(false)
    expect(readWorkbenchPreference(storage({ [key]: 'not-json', [legacyKey]: 'true' }))).toBe(false)
  })

  it('fails closed when storage access throws', () => {
    expect(
      readWorkbenchPreference({
        getItem() {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe(false)
  })
})
