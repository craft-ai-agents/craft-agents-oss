import type { LoadedWorkflow } from './types.ts';

export function normalizeWorkflowTriggerInputs(
  workflow: LoadedWorkflow,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const inputDefs = workflow.metadata.trigger.inputs ?? [];
  if (inputDefs.length === 0) return {};

  const out: Record<string, unknown> = {};
  for (const def of inputDefs) {
    let value = raw?.[def.name];
    if (value === undefined) value = def.default;

    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required workflow input: ${def.name}`);
    }
    if (value === undefined || value === null || value === '') continue;

    if (def.type === 'string') {
      if (typeof value !== 'string') throw new Error(`Workflow input "${def.name}" must be a string.`);
      out[def.name] = value;
    } else if (def.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Workflow input "${def.name}" must be a number.`);
      }
      out[def.name] = value;
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Workflow input "${def.name}" must be a boolean.`);
      out[def.name] = value;
    }
  }
  return out;
}
