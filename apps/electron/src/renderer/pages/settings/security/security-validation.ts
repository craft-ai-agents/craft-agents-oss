export const RISK_ACCEPTANCE_MIN_CODE_POINTS = 10
export const RISK_ACCEPTANCE_MAX_CODE_POINTS = 500
export const RISK_ACCEPTANCE_MIN_CALENDAR_DAYS = 1
export const RISK_ACCEPTANCE_MAX_CALENDAR_DAYS = 365

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface RiskAcceptanceValidationInput {
  readonly rationale: string
  readonly expiresOn: string
}

export interface RiskAcceptanceValidation {
  readonly valid: boolean
  readonly rationale: string
  readonly rationaleCodePoints: number
  readonly calendarDays: number | null
  readonly expiresAt: number | null
}

interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_INPUT_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function asDateInput(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Calendar dates make the chosen expiry clear even across daylight-saving changes. */
export function getRiskAcceptanceDateLimits(now = new Date()): { readonly min: string; readonly max: string } {
  const min = new Date(now)
  min.setDate(min.getDate() + RISK_ACCEPTANCE_MIN_CALENDAR_DAYS)
  const max = new Date(now)
  max.setDate(max.getDate() + RISK_ACCEPTANCE_MAX_CALENDAR_DAYS)
  return { min: asDateInput(min), max: asDateInput(max) }
}

/**
 * Validates the UI form before a risk-acceptance confirmation can be submitted.
 * The server repeats these bounds, but this helper keeps the disabled state and
 * expiry preview unambiguous for the local operator.
 */
export function validateRiskAcceptance(
  input: RiskAcceptanceValidationInput,
  now = new Date(),
): RiskAcceptanceValidation {
  const rationale = input.rationale.trim()
  const rationaleCodePoints = Array.from(rationale).length
  const selectedDate = parseCalendarDate(input.expiresOn)
  if (!selectedDate) {
    return {
      valid: false,
      rationale,
      rationaleCodePoints,
      calendarDays: null,
      expiresAt: null,
    }
  }

  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const selectedUtc = Date.UTC(selectedDate.year, selectedDate.month - 1, selectedDate.day)
  const calendarDays = Math.round((selectedUtc - todayUtc) / DAY_MS)
  const isRationaleValid =
    rationaleCodePoints >= RISK_ACCEPTANCE_MIN_CODE_POINTS &&
    rationaleCodePoints <= RISK_ACCEPTANCE_MAX_CODE_POINTS
  const isExpiryValid =
    calendarDays >= RISK_ACCEPTANCE_MIN_CALENDAR_DAYS &&
    calendarDays <= RISK_ACCEPTANCE_MAX_CALENDAR_DAYS
  if (!isRationaleValid || !isExpiryValid) {
    return {
      valid: false,
      rationale,
      rationaleCodePoints,
      calendarDays,
      expiresAt: null,
    }
  }

  const selectedDayEnd = new Date(
    selectedDate.year,
    selectedDate.month - 1,
    selectedDate.day,
    23,
    59,
    59,
    999,
  ).getTime()
  const earliestAllowed = now.getTime() + DAY_MS
  const latestAllowed = now.getTime() + RISK_ACCEPTANCE_MAX_CALENDAR_DAYS * DAY_MS
  const expiresAt = Math.min(latestAllowed, Math.max(earliestAllowed, selectedDayEnd))

  return {
    valid: true,
    rationale,
    rationaleCodePoints,
    calendarDays,
    expiresAt,
  }
}
