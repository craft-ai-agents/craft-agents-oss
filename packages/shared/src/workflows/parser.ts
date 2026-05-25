import matter from 'gray-matter';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { isValidWorkflowOutputSchema } from './output-schema.ts';
import { validateTemplateReferences } from './template.ts';
import {
  WORKFLOW_SLUG_REGEX,
  type WorkflowMetadata,
  type WorkflowOutputContract,
  type WorkflowParseWarning,
  type WorkflowStep,
  type WorkflowStepCompletionContract,
  type WorkflowStepFailurePolicy,
  type WorkflowTrigger,
  type WorkflowTriggerInput,
} from './types.ts';

// Mirrors the canonical OutputKind enum from `@craft-agent/shared/outputs/types`.
// Kept local because the canonical OUTPUT_KINDS set is not exported from the
// outputs package and adding a new export there is out of scope.
const VALID_OUTPUT_KINDS = new Set<string>([
  'report',
  'document',
  'image',
  'video',
  'audio',
  'dataset',
  'code',
  'model',
  'receipt',
  'external-action',
  'collection',
  'other',
]);

const VALID_INPUT_TYPES: ReadonlyArray<WorkflowTriggerInput['type']> = ['string', 'number', 'boolean'];
const VALID_STEP_FAILURE_POLICIES: ReadonlyArray<WorkflowStepFailurePolicy> = ['stop', 'continue', 'ask'];
const VALID_OUTPUT_MODES: ReadonlyArray<NonNullable<WorkflowOutputContract['mode']>> = ['final-step', 'explicit-tool', 'none'];
const VALID_OUTPUT_PRIMARY_FROM: ReadonlyArray<NonNullable<NonNullable<WorkflowOutputContract['primary']>['from']>> = ['step-output', 'file', 'external-link'];
const TRIGGER_INPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSUPPORTED_EXECUTION_FIELDS = new Set(['when', 'humanCheckpoint', 'parallelGroup']);

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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name) {
      return null;
    }
    if (!TRIGGER_INPUT_NAME_REGEX.test(name) || seenNames.has(name)) {
      return null;
    }
    seenNames.add(name);
    const typeRaw = e.type ?? 'string';
    if (typeof typeRaw !== 'string' || !(VALID_INPUT_TYPES as ReadonlyArray<string>).includes(typeRaw)) {
      return null;
    }
    const type = typeRaw as WorkflowTriggerInput['type'];
    const input: WorkflowTriggerInput = { name, type };
    if (typeof e.required === 'boolean') input.required = e.required;
    if (e.default !== undefined) {
      if (!defaultMatchesTriggerInputType(type, e.default)) return null;
      input.default = e.default;
    }
    if (typeof e.description === 'string' && e.description.trim()) {
      input.description = e.description.trim();
    }
    out.push(input);
  }
  return out.length > 0 ? out : undefined;
}

function defaultMatchesTriggerInputType(type: WorkflowTriggerInput['type'], value: unknown): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}

function coerceTrigger(raw: unknown, warnings: WorkflowParseWarning[]): WorkflowTrigger | null {
  if (raw == null) return { type: 'manual' };
  if (typeof raw !== 'object') {
    warnings.push(warning('trigger', 'invalid-trigger', 'trigger must be an object; defaulting to { type: manual }.'));
    return { type: 'manual' };
  }
  const r = raw as Record<string, unknown>;
  if (r.type !== undefined && typeof r.type !== 'string') {
    warnings.push(warning('trigger', 'invalid-trigger', 'trigger.type must be "manual".'));
    return null;
  }
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : 'manual';
  if (typeRaw !== 'manual') {
    // Forward-looking trigger types (e.g. "schedule") are warned + downgraded
    // to manual rather than rejected, so users editing draft workflows that
    // anticipate future trigger types still get a parseable file.
    warnings.push(warning(
      'trigger',
      'invalid-trigger',
      `trigger.type "${typeRaw}" is not supported yet; defaulting to manual.`,
    ));
  }
  const inputs = coerceTriggerInputs(r.inputs, warnings);
  if (inputs === null) return null;
  return inputs ? { type: 'manual', inputs } : { type: 'manual' };
}

function coerceOutputs(raw: unknown, warnings: WorkflowParseWarning[]): WorkflowOutputContract | undefined | null {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(warning('outputs', 'invalid-outputs', 'outputs must be an object.'));
    return null;
  }
  const r = raw as Record<string, unknown>;
  const out: WorkflowOutputContract = {};
  if (r.mode !== undefined) {
    if (typeof r.mode !== 'string' || !(VALID_OUTPUT_MODES as ReadonlyArray<string>).includes(r.mode)) {
      warnings.push(warning('outputs', 'invalid-outputs', 'outputs.mode must be final-step, explicit-tool, or none.'));
      return null;
    }
    out.mode = r.mode as WorkflowOutputContract['mode'];
  }
  if (r.kind !== undefined) {
    if (typeof r.kind !== 'string' || !r.kind.trim()) {
      warnings.push(warning('outputs', 'invalid-outputs', 'outputs.kind must be a string.'));
      return null;
    }
    const kind = r.kind.trim();
    if (!VALID_OUTPUT_KINDS.has(kind)) {
      warnings.push(warning(
        'outputs',
        'invalid-outputs',
        `outputs.kind "${kind}" is not a supported OutputKind.`,
      ));
      return null;
    }
    out.kind = kind as WorkflowOutputContract['kind'];
  }
  if (typeof r.title === 'string' && r.title.trim()) out.title = r.title.trim();
  if (typeof r.summary === 'string' && r.summary.trim()) out.summary = r.summary.trim();
  if (r.primary !== undefined) {
    if (!r.primary || typeof r.primary !== 'object' || Array.isArray(r.primary)) {
      warnings.push(warning('outputs', 'invalid-outputs', 'outputs.primary must be an object.'));
      return null;
    }
    const p = r.primary as Record<string, unknown>;
    const primary: NonNullable<WorkflowOutputContract['primary']> = {};
    if (p.from !== undefined) {
      if (typeof p.from !== 'string' || !(VALID_OUTPUT_PRIMARY_FROM as ReadonlyArray<string>).includes(p.from)) {
        warnings.push(warning('outputs', 'invalid-outputs', 'outputs.primary.from must be step-output, file, or external-link.'));
        return null;
      }
      primary.from = p.from as NonNullable<WorkflowOutputContract['primary']>['from'];
    }
    if (typeof p.step === 'string' && p.step.trim()) primary.step = p.step.trim();
    if (typeof p.path === 'string' && p.path.trim()) primary.path = p.path.trim();
    out.primary = primary;
  }
  return out;
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
  completion?: unknown;
}

function coerceCompletionContract(
  raw: unknown,
  stepId: string,
  warnings: WorkflowParseWarning[],
): WorkflowStepCompletionContract | null {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(warning('step', 'invalid-step-completion', `step "${stepId}" completion must be an object.`));
    return null;
  }
  const r = raw as Record<string, unknown>;
  const out: WorkflowStepCompletionContract = {};
  const allowedKeys = new Set(['requireNonEmptyOutput', 'minOutputChars', 'requireToolUse']);

  for (const key of Object.keys(r)) {
    if (!allowedKeys.has(key)) {
      warnings.push(warning('step', 'invalid-step-completion', `step "${stepId}" completion has unknown field "${key}".`));
      return null;
    }
  }

  if (r.requireNonEmptyOutput !== undefined) {
    if (typeof r.requireNonEmptyOutput !== 'boolean') {
      warnings.push(warning('step', 'invalid-step-completion', `step "${stepId}" completion.requireNonEmptyOutput must be a boolean.`));
      return null;
    }
    out.requireNonEmptyOutput = r.requireNonEmptyOutput;
  }
  if (r.minOutputChars !== undefined) {
    if (typeof r.minOutputChars !== 'number' || !Number.isInteger(r.minOutputChars) || r.minOutputChars < 0) {
      warnings.push(warning('step', 'invalid-step-completion', `step "${stepId}" completion.minOutputChars must be a non-negative integer.`));
      return null;
    }
    out.minOutputChars = r.minOutputChars;
  }
  if (r.requireToolUse !== undefined) {
    if (typeof r.requireToolUse !== 'boolean') {
      warnings.push(warning('step', 'invalid-step-completion', `step "${stepId}" completion.requireToolUse must be a boolean.`));
      return null;
    }
    out.requireToolUse = r.requireToolUse;
  }

  return out;
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
  if (hasUnsupportedExecutionField(data)) return null;

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;

  if (!Array.isArray(data.steps) || data.steps.length === 0) return null;

  const warnings: WorkflowParseWarning[] = [];
  const trigger = coerceTrigger(data.trigger, warnings);
  if (!trigger) return null;
  const outputs = coerceOutputs(data.outputs, warnings);
  if (outputs === null) return null;
  const triggerInputNames = (trigger.inputs ?? []).map((i) => i.name);

  const steps: WorkflowStep[] = [];
  const seenIds = new Set<string>();
  const previousIds: string[] = [];

  for (const rawStep of data.steps as RawStep[]) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    if (hasUnsupportedExecutionField(rawStep as Record<string, unknown>)) return null;
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

    const completion = coerceCompletionContract(rawStep.completion, id, warnings);
    if (completion === null) return null;
    if (Object.keys(completion).length > 0) step.completion = completion;

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
      outputs,
      steps,
    },
    body: parsed.content.trim(),
    warnings,
  };
}

export function serializeWorkflow(metadata: WorkflowMetadata, body: string): string {
  validateSerializableWorkflowMetadata(metadata);
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
  if (metadata.outputs) data.outputs = metadata.outputs;

  data.steps = metadata.steps.map((s) => {
    const out: Record<string, unknown> = { id: s.id, agent: s.agent, input: s.input };
    if (s.description) out.description = s.description;
    if (s.outputSchema) out.outputSchema = s.outputSchema;
    if (s.timeout !== undefined) out.timeout = s.timeout;
    if (s.retries !== undefined) out.retries = s.retries;
    if (s.onFailure !== undefined) out.onFailure = s.onFailure;
    if (s.completion !== undefined) out.completion = s.completion;
    return out;
  });

  return matter.stringify(body.trimEnd() + '\n', data);
}

function hasUnsupportedExecutionField(data: Record<string, unknown>): boolean {
  return Object.keys(data).some((key) => UNSUPPORTED_EXECUTION_FIELDS.has(key));
}

function validateSerializableWorkflowMetadata(metadata: WorkflowMetadata): void {
  if (hasUnsupportedExecutionField(metadata as unknown as Record<string, unknown>)) {
    throw new Error('Unsupported workflow execution fields are not implemented.');
  }
  if (metadata.trigger.type !== 'manual') {
    throw new Error(`Unsupported workflow trigger type: ${metadata.trigger.type}`);
  }
  for (const input of metadata.trigger.inputs ?? []) {
    if (input.default !== undefined && !defaultMatchesTriggerInputType(input.type, input.default)) {
      throw new Error(`Default value for workflow input "${input.name}" must be a ${input.type}.`);
    }
  }
  for (const step of metadata.steps) {
    if (hasUnsupportedExecutionField(step as unknown as Record<string, unknown>)) {
      throw new Error(`Unsupported execution field on workflow step "${step.id}".`);
    }
  }
}
