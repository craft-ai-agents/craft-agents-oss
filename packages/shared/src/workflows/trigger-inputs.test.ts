import { describe, expect, test } from 'bun:test';
import { normalizeWorkflowTriggerInputs } from './trigger-inputs.ts';
import type { LoadedWorkflow } from './types.ts';

function workflow(inputs: LoadedWorkflow['metadata']['trigger']['inputs']): LoadedWorkflow {
  return {
    slug: 'demo',
    path: '/tmp/demo/WORKFLOW.md',
    source: 'global',
    body: '',
    metadata: {
      name: 'Demo',
      description: 'Demo workflow',
      trigger: { type: 'manual', inputs },
      steps: [{ id: 'one', agent: 'agent', input: 'Do it' }],
    },
  };
}

describe('normalizeWorkflowTriggerInputs', () => {
  test('applies defaults and keeps declared fields only', () => {
    expect(normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
      { name: 'limit', type: 'number', default: 3 },
    ]), { topic: 'markets', extra: 'ignored' })).toEqual({
      topic: 'markets',
      limit: 3,
    });
  });

  test('rejects missing required inputs', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
    ]), {})).toThrow('Missing required workflow input: topic');
  });

  test('rejects invalid input types', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'limit', type: 'number' },
    ]), { limit: '5' })).toThrow('Workflow input "limit" must be a number.');
  });
});
