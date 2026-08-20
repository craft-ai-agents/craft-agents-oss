import { describe, expect, it } from 'bun:test'
import { runConfirmedSecurityAction } from '../security/security-actions'
import {
  RISK_ACCEPTANCE_MAX_CODE_POINTS,
  RISK_ACCEPTANCE_MIN_CODE_POINTS,
  validateRiskAcceptance,
} from '../security/security-validation'

const now = new Date(2026, 0, 15, 12, 0, 0, 0)

function dateAfter(days: number): string {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

describe('security risk acceptance validation', () => {
  it('counts Unicode code points, including astral characters, at both rationale bounds', () => {
    const min = '😀'.repeat(RISK_ACCEPTANCE_MIN_CODE_POINTS)
    const max = '😀'.repeat(RISK_ACCEPTANCE_MAX_CODE_POINTS)

    expect(validateRiskAcceptance({ rationale: min, expiresOn: dateAfter(1) }, now).valid).toBe(true)
    expect(validateRiskAcceptance({ rationale: max, expiresOn: dateAfter(365) }, now).valid).toBe(true)
    expect(validateRiskAcceptance({ rationale: '😀'.repeat(RISK_ACCEPTANCE_MIN_CODE_POINTS - 1), expiresOn: dateAfter(1) }, now).valid).toBe(false)
    expect(validateRiskAcceptance({ rationale: '😀'.repeat(RISK_ACCEPTANCE_MAX_CODE_POINTS + 1), expiresOn: dateAfter(1) }, now).valid).toBe(false)
  })

  it('accepts only an explicit calendar-day expiry from 1 through 365 days', () => {
    expect(validateRiskAcceptance({ rationale: 'достаточное обоснование', expiresOn: dateAfter(1) }, now)).toMatchObject({ valid: true })
    expect(validateRiskAcceptance({ rationale: 'достаточное обоснование', expiresOn: dateAfter(365) }, now)).toMatchObject({ valid: true })
    expect(validateRiskAcceptance({ rationale: 'достаточное обоснование', expiresOn: dateAfter(0) }, now).valid).toBe(false)
    expect(validateRiskAcceptance({ rationale: 'достаточное обоснование', expiresOn: dateAfter(366) }, now).valid).toBe(false)
    expect(validateRiskAcceptance({ rationale: 'достаточное обоснование', expiresOn: '2026-02-31' }, now).valid).toBe(false)
  })

  it('does not call a mutating operation when confirmation is cancelled', async () => {
    let calls = 0

    await expect(runConfirmedSecurityAction(null, async () => {
      calls += 1
    })).resolves.toBeUndefined()
    expect(calls).toBe(0)
  })
})
