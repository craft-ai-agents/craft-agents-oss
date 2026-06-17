import type { CraftEvalOutput, EvalTaskInput } from '../types'

export async function runDryCase(input: EvalTaskInput): Promise<CraftEvalOutput> {
  const finalAnswer = [
    `[dry-run] ${input.name}`,
    input.context ? `上下文: ${input.context.trim()}` : '',
    `用户输入: ${input.message}`,
  ].filter(Boolean).join('\n')

  return {
    finalAnswer,
    sessionId: `dry-${input.id}`,
    userMessageId: null,
    outcome: 'complete',
    toolEvents: [],
    eventTypes: ['complete'],
  }
}

