/**
 * Guarded permission mode: the risk check via the decision model (feature toggle `guardedMode`).
 *
 * In Guarded mode the agent describes each non-read-only tool call (see
 * `@craft-agent/shared` `core/guarded-mode.ts`); three yes/no questions ask
 * whether it is hard to undo, reaches outside the project, or reaches other
 * people or services. Any "yes" at or above the threshold turns the call into
 * an ordinary permission prompt. Tighten-only: the model can add a prompt,
 * never skip one, and no answer (`null`) also means a prompt: the shared side
 * asks with "could not be checked". Execute mode never gets here.
 */

import type { GuardedModeCheck, GuardedModeCall, GuardedModeRisk, GuardedModeVerdict } from '@craft-agent/shared/agent'
import { isDecisionFeatureActive, type DecisionRequest, type DecisionResult } from '@craft-agent/shared/decisions'
import { FOREGROUND_MAX_DEADLINE_MS, openDecisionPoint, recordDecisionOutcome, type DecisionPointDeps } from './decision-point'

/** "Yes" probability that escalates a call. High, because every escalation costs a prompt the user chose to mostly avoid. */
export const GUARDED_MODE_RISK_THRESHOLD = 0.8
/** The command, or the tool arguments as JSON, are cut to this many characters before they are sent. */
export const GUARDED_MODE_MAX_ARGUMENTS_CHARS = 4_000

const clip = (text: string) => (text.length > GUARDED_MODE_MAX_ARGUMENTS_CHARS ? `${text.slice(0, GUARDED_MODE_MAX_ARGUMENTS_CHARS)}…` : text)

const RISKS: readonly GuardedModeRisk[] = ['irreversible', 'outside_workspace', 'external']

export function buildGuardedModeRequest(call: GuardedModeCall): DecisionRequest {
  const args = call.arguments ? JSON.stringify(call.arguments) : undefined
  return {
    state: {
      tool: call.toolName,
      ...(call.promptType === 'bash' ? { command: clip(call.command) } : {}),
      ...(args ? { arguments: clip(args) } : {}),
      ...(call.workingDirectory ? { project_directory: call.workingDirectory } : {}),
    },
    questions: {
      irreversible: {
        type: 'noul',
        instructions: 'Would this action permanently delete, overwrite or destroy data, or otherwise be hard to undo?',
      },
      outside_workspace: {
        type: 'noul',
        instructions: 'Does this action change files, settings or processes outside the project directory, such as the home folder, system locations or other repositories?',
      },
      external: {
        type: 'noul',
        instructions: 'Does this action send data or messages to other people or services, publish something, or change a remote system (push, deploy, email, post, pay)?',
      },
    },
  }
}

/** Risks at or above the threshold; `null` when there is no result. */
export function readGuardedModeVerdict(result: DecisionResult | null): GuardedModeVerdict | null {
  if (!result) return null
  const risks = RISKS.filter(risk => {
    const answer = result.answers[risk]
    return answer?.type === 'noul' && answer.noul >= GUARDED_MODE_RISK_THRESHOLD
  })
  return { risks }
}

export interface GuardedModeCheckDeps extends DecisionPointDeps {
  sessionId: string
  /** Checked on every call: only a session with someone to answer the prompt is guarded. */
  isInteractive: () => boolean
}

export function buildGuardedModeCheck(deps: GuardedModeCheckDeps): GuardedModeCheck {
  return {
    // Synchronous: with the toggle off (the default) the tool path does no work at all.
    // (Only Guarded-mode sessions ask; `needsGuardedModeCheck` checks the mode first.)
    isActive: () => isDecisionFeatureActive('guardedMode') && deps.isInteractive(),
    check: async (call, signal) => {
      // The tool call waits on the answer: cap it like the other foreground points.
      const decide = await openDecisionPoint({ ...deps, feature: 'guardedMode', record: 'guarded_mode', maxDeadlineMs: FOREGROUND_MAX_DEADLINE_MS })
      if (!decide) return null
      const result = await decide(buildGuardedModeRequest(call), { tool: call.toolName, kind: call.promptType }, signal)
      const verdict = readGuardedModeVerdict(result)
      recordDecisionOutcome(result, verdict && verdict.risks.length > 0
        ? { action: 'prompt', changed: true, detail: { risks: verdict.risks } }
        : { action: 'allow', changed: false })
      return verdict
    },
  }
}
