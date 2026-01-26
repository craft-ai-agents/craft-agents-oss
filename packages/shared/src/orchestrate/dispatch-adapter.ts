/**
 * Dispatch Adapter
 *
 * Bridges Orchestrate with the dispatch skill for parallel task execution.
 * Converts PRD stories to dispatch-compatible tasks with embedded metadata.
 */

import type { Story, OrchestrateConfig, OrchestrateMeta } from './types.ts'
import { encodeMeta } from './meta-codec.ts'
import { generateStoryPrompt } from './prd-parser.ts'

export interface DispatchTask {
  subject: string
  description: string
  activeForm: string
  blockedBy?: string[]
}

/**
 * Convert stories to dispatch-compatible tasks
 */
export function storiesToDispatchTasks(
  stories: Story[],
  orchestrateId: string
): DispatchTask[] {
  return stories.map((story, index) => {
    const meta: OrchestrateMeta = {
      storyId: story.id,
      orchestrateId,
      lineNumber: story.lineNumber,
    }

    return {
      subject: `${story.id}: ${story.title}`,
      description: encodeMeta(story.content || generateStoryPrompt(story), meta),
      activeForm: `Processing ${story.title}`,
      // First story has no blockers, subsequent can run in parallel up to config.parallelism
      blockedBy: index === 0 ? [] : undefined,
    }
  })
}

/**
 * Generate the dispatch invocation command
 */
export function generateDispatchCommand(
  taskListId: string,
  tasks: DispatchTask[],
  config: OrchestrateConfig
): string {
  const lines = [
    `// Dispatch ${tasks.length} stories with parallelism: ${config.parallelism}`,
    `// Task List: ${taskListId}`,
    '',
    '// Create tasks:',
  ]

  for (const task of tasks) {
    lines.push(`TaskCreate(`)
    lines.push(`  subject: "${task.subject}",`)
    lines.push(`  description: \`${task.description.replace(/`/g, '\\`')}\`,`)
    lines.push(`  activeForm: "${task.activeForm}"`)
    lines.push(`)`)
    lines.push('')
  }

  return lines.join('\n')
}
