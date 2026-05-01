import { describe, expect, test } from 'bun:test'
import type { AgentDefinitionDTO } from '../../shared/types'
import { extractConciergeAgentLaunchSuggestion } from './concierge-actions'

function makeAgent(slug: string, name = slug): AgentDefinitionDTO {
  return {
    slug,
    metadata: {
      name,
      description: `${name} description`,
    },
    systemPrompt: '',
    path: `/agents/${slug}`,
    source: 'global',
  }
}

describe('extractConciergeAgentLaunchSuggestion', () => {
  const agents = [makeAgent('researcher', 'Researcher'), makeAgent('planner', 'Planner')]

  test('extracts a referenced agent and fenced prompt', () => {
    const suggestion = extractConciergeAgentLaunchSuggestion(
      'Use @researcher.\n\nPrompt:\n```text\nSummarize the launch risks.\n```',
      agents,
    )

    expect(suggestion?.agent.slug).toBe('researcher')
    expect(suggestion?.prompt).toBe('Summarize the launch risks.')
  })

  test('extracts a quoted prompt', () => {
    const suggestion = extractConciergeAgentLaunchSuggestion(
      'Recommendation: run @planner with prompt: "Build a rollout checklist."',
      agents,
    )

    expect(suggestion?.agent.slug).toBe('planner')
    expect(suggestion?.prompt).toBe('Build a rollout checklist.')
  })

  test('extracts an inline prompt', () => {
    const suggestion = extractConciergeAgentLaunchSuggestion(
      'Recommendation: @researcher\nPrompt: Compare the two vendor proposals.',
      agents,
    )

    expect(suggestion?.agent.slug).toBe('researcher')
    expect(suggestion?.prompt).toBe('Compare the two vendor proposals.')
  })

  test('ignores ambiguous agent mentions', () => {
    const suggestion = extractConciergeAgentLaunchSuggestion(
      'Either @researcher or @planner could help.\n\nPrompt: Compare options.',
      agents,
    )

    expect(suggestion).toBeNull()
  })
})
