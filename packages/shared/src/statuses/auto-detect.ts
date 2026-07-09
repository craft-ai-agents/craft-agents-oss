/**
 * Task-type detection for session status auto-classification.
 *
 * Procurement sessions are classified by *task type* (找料/替代料/型号比对/供应商/单据),
 * which IS the session's status (no generic todo/done lifecycle). This detects the
 * type from a user message — driven by the distinctive phrases of the task-launcher
 * messages (apps/webui .../input/task-forms.ts `toMessage`), and also catches
 * hand-typed messages using the same wording.
 *
 * Order is first-match-wins, and NOT mutually exclusive: the 找替代料 launcher
 * message ("...和能否替代的结论...") contains both `替代料` and `能否替代`, so
 * `alternative` must be checked before `compare` or it misclassifies as 型号比对.
 * The broad `找料` phrase is checked last so the more specific task phrases
 * (替代料 / 能不能替代 / 供应商候选 / 生成请款单) win when present.
 */

const TASK_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'alternative', re: /替代料/ },
  { id: 'compare', re: /能不能替代|能否替代/ },
  { id: 'supplier', re: /供应商候选|补.{0,6}供应商/ },
  { id: 'doc', re: /生成请款单|生成单据|生成.{0,6}发票|开请款/ },
  { id: 'find', re: /帮我找一下|找料/ },
]

/** Status ids that auto-detection may assign (the procurement task types). */
export const TASK_STATUS_IDS = TASK_PATTERNS.map((p) => p.id)

/**
 * Detect the procurement task type from a user message.
 * @returns matching status id, or null if no task type matches.
 */
export function detectTaskStatus(message: string): string | null {
  for (const { id, re } of TASK_PATTERNS) {
    if (re.test(message)) return id
  }
  return null
}
