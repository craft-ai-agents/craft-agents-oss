import matter from 'gray-matter';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { isValidWorkflowOutputSchema } from './output-schema.ts';
import { validateTemplateReferences } from './template.ts';
import {
  WORKFLOW_SLUG_REGEX,
  type WorkflowMetadata,
  type WorkflowParseWarning,
  type WorkflowStep,
  type WorkflowStepFailurePolicy,
  type WorkflowTrigger,
  type WorkflowTriggerInput,
} from './types.ts';

const VALID_INPUT_TYPES: ReadonlyArray<WorkflowTriggerInput['type']> = ['string', 'number', 'boolean'];
const VALID_STEP_FAILURE_POLICIES: ReadonlyArray<WorkflowStepFailurePolicy> = ['stop', 'continue', 'ask'];
const TRIGGER_INPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function warning(
  field: WorkflowParseWarning['field'],
  code: WorkflowParseWarning['code'],
  message: string,
): WorkflowParseWarning {
  return { field, code, message };
}

function coerceTriggerInputs(
  raw: unknown,
  warnings: WorkflowParseWarning[],
): WorkflowTriggerInput[] | undefined | null {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    warnings.push(warning('trigger', 'invalid-trigger-inputs', 'trigger.inputs must be an array.'));
    return undefined;
  }
  const out: WorkflowTriggerInput[] = [];
  const seenNames = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name) continue;
    if (!TRIGGER_INPUT_NAME_REGEX.test(name) || seenNames.has(name)) {
      return null;
    }
    seenNames.add(name);
    const type = typeof e.type === 'string' && (VALID_INPUT_TYPES as ReadonlyArray<string>).includes(e.type)
      ? (e.type as WorkflowTriggerInput['type'])
      : 'string';
    const input: WorkflowTriggerInput = { name, type };
    if (typeof e.required === 'boolean') input.required = e.required;
    if (e.default !== undefined) input.default = e.default;
    if (typeof e.description === 'string' && e.description.trim()) {
      input.description = e.description.trim();
    }
    out.push(input);
  }
  return out.length > 0 ? out : undefined;
}

function coerceTrigger(raw: unknown, warnings: WorkflowParseWarning[]): WorkflowTrigger | null {
  if (raw == null) return { type: 'manual' };
  if (typeof raw !== 'object') {
    warnings.push(warning('trigger', 'invalid-trigger', 'trigger must be an object; defaulting to { type: manual }.'));
    return { type: 'manual' };
  }
  const r = raw as Record<string, unknown>;
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : 'manual';
  if (typeRaw !== 'manual') {
    warnings.push(warning('trigger', 'invalid-trigger', `trigger.type "${typeRaw}" is not supported in Phase 1; defaulting to manual.`));
  }
  const inputs = coerceTriggerInputs(r.inputs, warnings);
  if (inputs === null) return null;
  return inputs ? { type: 'manual', inputs } : { type: 'manual' };
}

interface RawStep {
  id?: unknown;
  agent?: unknown;
  input?: unknown;
  description?: unknown;
  outputSchema?: unknown;
  timeout?: unknown;
  retries?: unknown;
  onFailure?: unknown;
}

export function parseWorkflowFile(
  content: string,
): { metadata: WorkflowMetadata; body: string; warnings: WorkflowParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;

  if (!Array.isArray(data.steps) || data.steps.length === 0) return null;

  const warnings: WorkflowParseWarning[] = [];
  const trigger = coerceTrigger(data.trigger, warnings);
  if (!trigger) return null;
  const triggerInputNames = (trigger.inputs ?? []).map((i) => i.name);

  const steps: WorkflowStep[] = [];
  const seenIds = new Set<string>();
  const previousIds: string[] = [];

  for (const rawStep of data.steps as RawStep[]) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    const id = typeof rawStep.id === 'string' ? rawStep.id.trim() : '';
    const agent = typeof rawStep.agent === 'string' ? rawStep.agent.trim() : '';
    const input = typeof rawStep.input === 'string' ? rawStep.input : '';

    if (!id || !WORKFLOW_SLUG_REGEX.test(id)) return null;
    if (seenIds.has(id)) return null;
    if (!agent || !AGENT_SLUG_REGEX.test(agent)) return null;
    if (!input) return null;

    const refErrors = validateTemplateReferences(input, previousIds, triggerInputNames);
    if (refErrors.length > 0) return null;

    const step: WorkflowStep = { id, agent, input };
    if (typeof rawStep.description === 'string' && rawStep.description.trim()) {
      step.description = rawStep.description.trim();
    } else if (rawStep.description !== undefined && typeof rawStep.description !== 'string') {
      warnings.push(warning('step', 'invalid-step-description', `step "${id}" description must be a string.`));
    }

    if (rawStep.outputSchema !== undefined) {
      if (!isValidWorkflowOutputSchema(rawStep.outputSchema)) {
        warnings.push(warning('step', 'invalid-step-output-schema', `step "${id}" outputSchema must be a JSON Schema object with a type.`));
        return null;
      }
      step.outputSchema = rawStep.outputSchema;
    }

    if (rawStep.timeout !== undefined) {
      if (typeof rawStep.timeout !== 'number' || !Number.isFinite(rawStep.timeout) || rawStep.timeout <= 0) {
        warnings.push(warning('step', 'invalid-step-timeout', `step "${id}" timeout must be a positive number of seconds.`));
        return null;
      }
      step.timeout = rawStep.timeout;
    }

    if (rawStep.retries !== undefined) {
      if (typeof rawStep.retries !== 'number' || !Number.isInteger(rawStep.retries) || rawStep.retries < 0) {
        warnings.push(warning('step', 'invalid-step-retries', `step "${id}" retries must be a non-negative integer.`));
        return null;
      }
      step.retries = rawStep.retries;
    }

    if (rawStep.onFailure !== undefined) {
      if (
        typeof rawStep.onFailure !== 'string' ||
        !(VALID_STEP_FAILURE_POLICIES as ReadonlyArray<string>).includes(rawStep.onFailure)
      ) {
        warnings.push(warning('step', 'invalid-step-on-failure', `step "${id}" onFailure must be one of: stop, continue, ask.`));
        return null;
      }
      step.onFailure = rawStep.onFailure as WorkflowStepFailurePolicy;
    }

    steps.push(step);
    seenIds.add(id);
    previousIds.push(id);
  }

  const avatar = typeof data.avatar === 'string' ? data.avatar.trim() || undefined : undefined;
  if (data.avatar !== undefined && typeof data.avatar !== 'string') {
    warnings.push(warning('avatar', 'invalid-avatar', 'avatar must be a string.'));
  }

  return {
    metadata: {
      name,
      description,
      avatar,
      trigger,
      steps,
    },
    body: parsed.content.trim(),
    warnings,
  };
}

export function serializeWorkflow(metadata: WorkflowMetadata, body: string): string {
  const data: Record<string, unknown> = {
    name: metadata.name,
    description: metadata.description,
  };
  if (metadata.avatar) data.avatar = metadata.avatar;

  const trigger: Record<string, unknown> = { type: metadata.trigger.type };
  if (metadata.trigger.inputs && metadata.trigger.inputs.length > 0) {
    trigger.inputs = metadata.trigger.inputs.map((i) => {
      const out: Record<string, unknown> = { name: i.name, type: i.type };
      if (i.required) out.required = true;
      if (i.default !== undefined) out.default = i.default;
      if (i.description) out.description = i.description;
      return out;
    });
  }
  data.trigger = trigger;

  data.steps = metadata.steps.map((s) => {
    const out: Record<string, unknown> = { id: s.id, agent: s.agent, input: s.input };
    if (s.description) out.description = s.description;
    if (s.outputSchema) out.outputSchema = s.outputSchema;
    if (s.timeout !== undefined) out.timeout = s.timeout;
    if (s.retries !== undefined) out.retries = s.retries;
    if (s.onFailure !== undefined) out.onFailure = s.onFailure;
    return out;
  });

  return matter.stringify(body.trimEnd() + '\n', data);
}
