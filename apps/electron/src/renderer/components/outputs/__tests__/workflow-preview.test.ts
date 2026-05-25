import { describe, expect, test } from 'bun:test'
import { parseWorkflowGraphSpec } from '../workflow-preview'

describe('parseWorkflowGraphSpec', () => {
  test('parses direct workflow graph nodes', () => {
    const result = parseWorkflowGraphSpec(JSON.stringify({
      title: 'Launch flow',
      nodes: [
        { id: 'brief', label: 'Brief', agent: 'strategist', state: 'succeeded' },
        { id: 'draft', label: 'Draft', agent: 'writer', state: 'running' },
      ],
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.title).toBe('Launch flow')
      expect(result.spec.nodes).toEqual([
        { id: 'brief', label: 'Brief', agent: 'strategist', state: 'succeeded' },
        { id: 'draft', label: 'Draft', agent: 'writer', state: 'running' },
      ])
    }
  })

  test('parses workflow run snapshots', () => {
    const result = parseWorkflowGraphSpec(JSON.stringify({
      workflowSlug: 'weekly-content',
      state: 'running',
      workflowSnapshot: {
        metadata: {
          name: 'Weekly Content',
          steps: [
            { id: 'research', agent: 'researcher', description: 'Research' },
            { id: 'write', agent: 'writer', description: 'Write' },
          ],
        },
      },
      steps: [
        { id: 'research', state: 'succeeded', attempts: 1 },
        { id: 'write', state: 'running', attempts: 1 },
      ],
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.title).toBe('Weekly Content')
      expect(result.spec.state).toBe('running')
      expect(result.spec.nodes.map((node) => [node.id, node.label, node.agent, node.state])).toEqual([
        ['research', 'Research', 'researcher', 'succeeded'],
        ['write', 'Write', 'writer', 'running'],
      ])
    }
  })

  test('parses workflow definition metadata', () => {
    const result = parseWorkflowGraphSpec(JSON.stringify({
      metadata: {
        name: 'Bug Hunt',
        steps: [
          { id: 'scan', agent: 'reviewer' },
          { id: 'fix', agent: 'coder' },
        ],
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.title).toBe('Bug Hunt')
      expect(result.spec.nodes.map((node) => node.state)).toEqual(['queued', 'queued'])
    }
  })

  test('rejects unsupported workflow JSON', () => {
    const result = parseWorkflowGraphSpec('{"hello":"world"}')
    expect(result.ok).toBe(false)
  })
})
