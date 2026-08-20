/**
 * A due date is overdue only before the local start of today and while the
 * session is still actionable. Terminal sessions retain their date but never
 * receive an overdue treatment.
 */
export function isDueOverdue(
  dueDate: number | null | undefined,
  sessionStatus: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (dueDate == null || !Number.isFinite(dueDate)) return false
  if (sessionStatus === 'done' || sessionStatus === 'cancelled') return false

  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return dueDate < startOfToday
}
