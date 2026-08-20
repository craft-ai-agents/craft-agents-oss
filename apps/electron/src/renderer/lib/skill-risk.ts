/**
 * S1/S3 pending-card helpers — pure, lib-free, renderer-only.
 *
 * Risk flags are heuristic client-side hints for the review card ("this
 * candidate wants network access"); the authoritative block lies in the
 * server-side validateSkillContent verdict carried on PendingSkill.violations.
 */

export type SkillRiskFlag = 'network' | 'fs-outside' | 'secrets' | 'sudo'

const NETWORK_RE = /\b(?:curl|wget|fetch)\b|https?:\/\//i
const FS_OUTSIDE_RE = /\brm\b|\$HOME|~\//
const SECRETS_RE = /\b(?:password|passwd|secret|credential|api[_-]?key|token)\b/i
const SUDO_RE = /\bsudo\b/

/**
 * Scan raw SKILL.md content for coarse risk signals. Order is stable
 * (network first) so chip rows render deterministically.
 */
export function detectSkillRiskFlags(content: string): SkillRiskFlag[] {
  const flags: SkillRiskFlag[] = []
  if (NETWORK_RE.test(content)) flags.push('network')
  if (FS_OUTSIDE_RE.test(content)) flags.push('fs-outside')
  if (SECRETS_RE.test(content)) flags.push('secrets')
  if (SUDO_RE.test(content)) flags.push('sudo')
  return flags
}

export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}

/**
 * Line-level diff via LCS DP — small (skill files are a few hundred lines
 * max) and dependency-free, per spec. `remove` comes from the base, `add`
 * from the candidate.
 */
export function lineDiff(base: string, candidate: string): DiffLine[] {
  const a = base.split('\n')
  const b = candidate.split('\n')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'remove', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** i18n keys for SkillRiskFlag values — keys live in pendingSkills.risk*. */
export const RISK_FLAG_I18N_KEY: Record<SkillRiskFlag, string> = {
  'network': 'pendingSkills.riskNetwork',
  'fs-outside': 'pendingSkills.riskFsOutside',
  'secrets': 'pendingSkills.riskSecrets',
  'sudo': 'pendingSkills.riskSudo',
}

/** i18n keys for server violation codes — keys live in pendingSkills.violation.*. */
export const VIOLATION_I18N_KEY: Record<string, string> = {
  'sudo': 'pendingSkills.violation.sudo',
  'rm-rf-root': 'pendingSkills.violation.rmRfRoot',
  'curl-pipe-shell': 'pendingSkills.violation.curlPipeShell',
  'eval': 'pendingSkills.violation.eval',
  'hardcoded-secret': 'pendingSkills.violation.hardcodedSecret',
}
