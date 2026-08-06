/**
 * Reference grammar for task.yaml input bindings.
 *
 * Canonical form (per the build plan): `${nodes.<id>.output[.field]}` and
 * `${params.<name>}`. A reference is how one node consumes an upstream node's
 * output or a task parameter.
 *
 * Two consumers share this grammar so it lives in exactly one place:
 *  - validate.ts uses extractRefs() to materialize edges + catch dangling refs.
 *  - the Conductor (server-core) uses interpolateRefs() to build a node's prompt
 *    before dispatch (Step 2). `summarize` compression is applied by the
 *    Conductor to the resolved value, so this module stays pure.
 */

export interface NodeRef {
  kind: 'node';
  /** Upstream node id. */
  nodeId: string;
  /** Optional sub-field of the node's output (a named param from the param/artifact split). */
  field?: string;
  /** The full matched token, e.g. "${nodes.audit.output}". */
  raw: string;
}

export interface ParamRef {
  kind: 'param';
  /** Task param name. */
  name: string;
  raw: string;
}

export type Ref = NodeRef | ParamRef;

/**
 * A node's persisted output.
 *  - `text` is the free-form final answer (the child's last assistant message).
 *  - `params` holds typed values from the param/artifact split (v1 usually empty;
 *    `${nodes.X.output.field}` resolves against it).
 */
export interface NodeOutput {
  text: string;
  params?: Record<string, unknown>;
}

// nodes.<id>.output | nodes.<id>.output.<field> | params.<name>
const REF_SOURCE =
  String.raw`\$\{\s*(?:nodes\.([a-z0-9][a-z0-9-]*)\.output(?:\.([a-zA-Z0-9_-]+))?|params\.([a-zA-Z_][a-zA-Z0-9_]*))\s*\}`;

/** Fresh global regex per call — avoids shared lastIndex state between extract/interpolate. */
function refRegex(): RegExp {
  return new RegExp(REF_SOURCE, 'g');
}

/** Extract every reference found in a string. */
export function extractRefs(text: string): Ref[] {
  if (!text) return [];
  const refs: Ref[] = [];
  for (const m of text.matchAll(refRegex())) {
    const [raw, nodeId, field, paramName] = m;
    if (nodeId) refs.push({ kind: 'node', nodeId, field, raw });
    else if (paramName) refs.push({ kind: 'param', name: paramName, raw });
  }
  return refs;
}

function stringifyValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface InterpolationContext {
  /** nodeId → that node's output. */
  nodeOutputs: Record<string, NodeOutput>;
  /** Task param values (resolved at run start). */
  params?: Record<string, unknown>;
}

export interface InterpolateOptions {
  /** Called when a ref can't be resolved; its return value is substituted. Default: leave the raw token. */
  onMissing?: (ref: Ref) => string;
}

/**
 * Substitute every `${…}` reference in `template` using `ctx`. Unresolvable
 * references are left as their raw token unless `onMissing` is supplied.
 */
export function interpolateRefs(
  template: string,
  ctx: InterpolationContext,
  opts: InterpolateOptions = {},
): string {
  const onMissing = opts.onMissing ?? ((ref: Ref) => ref.raw);
  return template.replace(refRegex(), (raw, nodeId?: string, field?: string, paramName?: string) => {
    if (nodeId) {
      const out = ctx.nodeOutputs[nodeId];
      if (!out) return onMissing({ kind: 'node', nodeId, field, raw });
      if (field) {
        const value = out.params?.[field];
        return value === undefined ? onMissing({ kind: 'node', nodeId, field, raw }) : stringifyValue(value);
      }
      return out.text;
    }
    if (paramName) {
      const value = ctx.params?.[paramName];
      return value === undefined ? onMissing({ kind: 'param', name: paramName, raw }) : stringifyValue(value);
    }
    return raw;
  });
}
