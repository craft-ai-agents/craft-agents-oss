/**
 * Synthetic turns for `scripts/decisions-eval.ts --feature adaptive_thinking`: the message,
 * optionally the end of the previous reply and attachment names, and the acceptable answers.
 * Shaped after real misses (a bare "Here" with an attachment rated low, a one-event calendar
 * change rated medium). No user data.
 */

import type { TurnToRate } from '../adaptive-thinking'

export interface AdaptiveThinkingCase {
  name: string
  turn: TurnToRate
  /** Acceptable rubric levels for `demand` (0 trivial … 3 hard). */
  demand: number[]
  /** Expected `consequential` answer (p ≥ 0.5), when the case tests it. */
  consequential?: boolean
  /** Expected `corrects_previous` answer (p ≥ 0.6), when the case tests it. */
  correction?: boolean
}

export const ADAPTIVE_THINKING_CASES: AdaptiveThinkingCase[] = [
  // Trivial
  { name: 'thanks', turn: { message: 'thanks!' }, demand: [0] },
  { name: 'greeting', turn: { message: 'hi there' }, demand: [0] },
  { name: 'status-after-deploy', turn: { message: 'Status ?', previousReply: 'I started the staging deploy; it usually takes about 10 minutes. I will report back when it finishes.' }, demand: [0, 1] },
  { name: 'timezone', turn: { message: 'What time is it in Tokyo right now?' }, demand: [0] },
  { name: 'percent', turn: { message: "What's 15% of 240?" }, demand: [0, 1] },

  // Routine
  { name: 'rename-variable', turn: { message: 'Rename the variable `cnt` to `count` in utils.ts' }, demand: [1] },
  { name: 'summarize-thread', turn: { message: 'Summarize this thread in 3 bullets' }, demand: [1] },
  { name: 'gitignore', turn: { message: 'Add a .gitignore entry for .DS_Store' }, demand: [0, 1] },
  { name: 'issue-status', turn: { message: 'Look up the Linear issue ENG-123 and tell me its status' }, demand: [1] },
  { name: 'readme-typo', turn: { message: 'Fix the typo in the README heading' }, demand: [0, 1] },

  // Substantial
  { name: 'slack-script', turn: { message: "Write a script that pulls yesterday's Slack messages from #ops and groups them by alert type" }, demand: [2] },
  { name: 'here-with-attachment', turn: { message: 'Here', previousReply: "Send me the analysis doc when it's ready and I'll review the settlement logic against the spec.", attachments: ['Assist Props Settle Blind.md (text, 14 KB)'] }, demand: [2, 3] },
  { name: 'refactor-retry', turn: { message: 'Refactor the payment retry logic into a separate module with tests' }, demand: [2, 3] },
  { name: 'compare-proposals', turn: { message: 'Compare these two pricing proposals and recommend one', attachments: ['pricing-a.pdf (pdf, 820 KB)', 'pricing-b.pdf (pdf, 760 KB)'] }, demand: [2, 3] },
  { name: 'fix-failing-tests', turn: { message: 'Can you go through the failing tests and fix them?' }, demand: [2, 3] },

  // Hard
  { name: 'failover-design', turn: { message: 'Design the architecture for a multi-region failover of the order matching engine, with the trade-offs of each option' }, demand: [3] },
  { name: 'safari-debug', turn: { message: 'Why does the websocket reconnect loop only happen on Safari after the laptop wakes from sleep? Debug it.' }, demand: [3] },
  { name: 'race-condition', turn: { message: 'There is a race condition between settlement and withdrawal processing. Find it and propose a fix.' }, demand: [3] },
  { name: 'architect-plan', turn: { message: 'Spend some time to properly architect the solution and create a plan' }, demand: [2, 3] },

  // Short follow-ups that continue demanding work
  { name: 'yes-do-it', turn: { message: 'yes, do it', previousReply: 'I can migrate all 40 call sites to the new API and update the tests. Should I proceed?' }, demand: [2, 3] },
  { name: 'the-second-one', turn: { message: 'the second one', previousReply: 'Two options: 1) patch the cache key, 2) rewrite the cache layer with invalidation events. Which do you prefer?' }, demand: [2, 3] },
  { name: 'ok-after-offer', turn: { message: 'ok', previousReply: 'Want me to also update the docs for the new flag?' }, demand: [1, 2] },

  // Consequential (hard to undo, reaches other people or systems)
  { name: 'calendar-one-event', turn: { message: 'update the end date ONLY on this event to Oct 9' }, demand: [1, 2], consequential: true },
  { name: 'push-and-pr', turn: { message: 'Push the branch and open the PR' }, demand: [1, 2], consequential: true },
  { name: 'post-to-channel', turn: { message: 'Send the summary to #general' }, demand: [1], consequential: true },
  { name: 'drop-database', turn: { message: 'Delete the old staging database' }, demand: [1, 2, 3], consequential: true },
  { name: 'read-config', turn: { message: 'Read the config file and explain the retry setting' }, demand: [1], consequential: false },
  { name: 'local-test-edit', turn: { message: 'Add a test case for the empty input to the local test file' }, demand: [1], consequential: false },

  // Corrections
  { name: 'wrong-granularity', turn: { message: "No, that's not what I asked. I wanted the weekly numbers, not daily.", previousReply: 'Here are the daily active users for September, one row per day.' }, demand: [1, 2, 3], correction: true },
  { name: 'wrong-deadline', turn: { message: "That's wrong, the deadline is Friday not Monday", previousReply: 'Got it: the launch deadline is Monday, I added it to the plan.' }, demand: [0, 1, 2], correction: true },
  { name: 'accepted-next', turn: { message: 'Great, thanks! Now do the same for October.', previousReply: 'Here are the September numbers by week.' }, demand: [1, 2], correction: false },
]
