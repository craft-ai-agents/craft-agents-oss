import i18n from 'i18next'

export interface BuildPlanApprovalMessageOptions {
  /** Optional accepted plan path (kept for call-site compatibility; message remains path-agnostic). */
  planPath?: string
  draftInput?: string
}

function normalizeDraftInput(input?: string): string {
  return (input ?? '').trim()
}

export function buildPlanApprovalMessage(options: BuildPlanApprovalMessageOptions = {}): string {
  const draftInput = normalizeDraftInput(options.draftInput)

  const sections: string[] = [i18n.t('plan.approved')]

  if (draftInput.length > 0) {
    sections.push(['---', `**${i18n.t('plan.additionalUserContext')}**`, draftInput].join('\n\n'))
  }

  return sections.join('\n\n')
}
