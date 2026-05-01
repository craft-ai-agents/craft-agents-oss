/**
 * Workflows — templating resolver
 *
 * Mustache-ish, intentionally tiny. Recognized tokens:
 *
 *   {{trigger.<field>}}
 *   {{steps.<id>.output}}
 *   {{steps.<id>.output.<dot.path>}}
 *   {{run.id}}
 *   {{run.startedAt}}
 *
 * Rules per `docs/workflows/01-spec.md`:
 *   - Unknown references resolve to '' and emit a warning.
 *   - No expressions, no filters, no loops.
 *   - Resolution is pure — no I/O.
 */

export interface TemplateContext {
  trigger?: Record<string, unknown>;
  steps?: Record<string, { output: unknown }>;
  run?: { id: string; startedAt: string };
}

export interface TemplateResolveResult {
  output: string;
  warnings: string[];
}

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function dotWalk(root: unknown, parts: string[]): { ok: true; value: unknown } | { ok: false } {
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return { ok: false };
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return { ok: false };
  }
  return { ok: true, value: cur };
}

function resolveToken(expr: string, ctx: TemplateContext): { ok: true; value: string } | { ok: false; reason: string } {
  const parts = expr.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: `empty token "{{${expr}}}"` };

  const head = parts[0];

  if (head === 'trigger') {
    const field = parts[1];
    if (field === undefined) return { ok: false, reason: `"{{${expr}}}" is missing a field name` };
    if (parts.length !== 2) return { ok: false, reason: `"{{${expr}}}" must be trigger.<field>` };
    if (!ctx.trigger || !(field in ctx.trigger)) {
      return { ok: false, reason: `unknown trigger field "${field}"` };
    }
    return { ok: true, value: stringify(ctx.trigger[field]) };
  }

  if (head === 'run') {
    const field = parts[1];
    if (parts.length !== 2 || field === undefined) {
      return { ok: false, reason: `"{{${expr}}}" is not a recognized run field` };
    }
    if (field !== 'id' && field !== 'startedAt') {
      return { ok: false, reason: `unknown run field "${field}"` };
    }
    if (!ctx.run) return { ok: false, reason: `run context not available` };
    return { ok: true, value: stringify(ctx.run[field]) };
  }

  if (head === 'steps') {
    const stepId = parts[1];
    if (parts.length < 3 || parts[2] !== 'output' || stepId === undefined) {
      return { ok: false, reason: `"{{${expr}}}" must be steps.<id>.output[.path]` };
    }
    const step = ctx.steps?.[stepId];
    if (!step) return { ok: false, reason: `unknown step "${stepId}"` };
    if (parts.length === 3) return { ok: true, value: stringify(step.output) };
    const walked = dotWalk(step.output, parts.slice(3));
    if (!walked.ok) return { ok: false, reason: `unknown path "${parts.slice(3).join('.')}" in step "${stepId}" output` };
    return { ok: true, value: stringify(walked.value) };
  }

  return { ok: false, reason: `unrecognized token root "${head}"` };
}

export function resolveTemplate(template: string, ctx: TemplateContext): TemplateResolveResult {
  const warnings: string[] = [];
  const output = template.replace(TOKEN_RE, (_match, expr: string) => {
    const result = resolveToken(expr, ctx);
    if (result.ok) return result.value;
    warnings.push(result.reason);
    return '';
  });
  return { output, warnings };
}

/**
 * Static check used by the parser — no values needed, only known step IDs +
 * known trigger input names. Returns a list of error messages; empty = clean.
 *
 * The parser uses this to enforce "no forward references": call it with
 * `knownStepIds = previousStepIds` while walking step-by-step, so a step
 * referencing a later step's output trips an error.
 */
export function validateTemplateReferences(
  template: string,
  knownStepIds: string[],
  knownTriggerInputs: string[],
): string[] {
  const errors: string[] = [];
  const stepSet = new Set(knownStepIds);
  const triggerSet = new Set(knownTriggerInputs);
  const matches = template.matchAll(TOKEN_RE);
  for (const m of matches) {
    const rawExpr = m[1] ?? '';
    const expr = rawExpr.trim();
    const parts = expr.split('.').map((p) => p.trim()).filter(Boolean);
    const head = parts[0];
    if (!head) {
      errors.push(`empty token "{{${expr}}}"`);
      continue;
    }
    if (head === 'trigger') {
      const field = parts[1];
      if (!field) {
        errors.push(`"{{${expr}}}" is missing a field name`);
        continue;
      }
      if (parts.length !== 2) {
        errors.push(`"{{${expr}}}" must be trigger.<field>`);
        continue;
      }
      if (!triggerSet.has(field)) {
        errors.push(`trigger has no input named "${field}"`);
      }
    } else if (head === 'steps') {
      const stepId = parts[1];
      if (!stepId || parts.length < 3 || parts[2] !== 'output') {
        errors.push(`"{{${expr}}}" must be steps.<id>.output[.path]`);
        continue;
      }
      if (!stepSet.has(stepId)) {
        errors.push(`reference to unknown or future step "${stepId}"`);
      }
    } else if (head === 'run') {
      const field = parts[1];
      if (parts.length !== 2 || (field !== 'id' && field !== 'startedAt')) {
        errors.push(`"{{${expr}}}" is not a recognized run field`);
      }
    } else {
      errors.push(`unrecognized token root "${head}" in "{{${expr}}}"`);
    }
  }
  return errors;
}
