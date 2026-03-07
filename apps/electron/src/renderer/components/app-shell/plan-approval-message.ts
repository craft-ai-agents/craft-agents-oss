export interface BuildPlanApprovalMessageOptions {
  planPath?: string
  draftInput?: string
}

const PLAN_APPROVAL_LINE = 'Plan approved, please execute.'

function normalizeDraftInput(input?: string): string {
  return (input ?? '').trim()
}

export function buildPlanApprovalMessage(options: BuildPlanApprovalMessageOptions = {}): string {
  const draftInput = normalizeDraftInput(options.draftInput)

  const sections: string[] = [PLAN_APPROVAL_LINE]

  if (options.planPath?.trim()) {
    sections.push(`Use this approved plan file as the source of truth: ${options.planPath.trim()}`)
  }

  if (draftInput.length > 0) {
    sections.push(['---', '**Additional user context**', draftInput].join('\n\n'))
  }

  return sections.join('\n\n')
}
