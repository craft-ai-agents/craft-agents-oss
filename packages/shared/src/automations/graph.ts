/**
 * Graph authoring projection for automations.json.
 *
 * The graph is metadata over the canonical runtime configuration. It is always
 * compiled back to current matchers/actions before persistence; no graph
 * executor exists or is introduced here.
 */

import { buildDefaultSchedulerPromptSeed } from './default-seed-template.ts';
import {
  AutomationGraphSchema,
  AutomationsConfigSchema,
  CloudRunSubmitActionSchema,
  KnowledgeAutomationActionSchema,
  PromptActionSchema,
  SaveAutomationGraphPayloadSchema,
  WebhookActionSchema,
} from './schemas.ts';
import {
  AGENT_EVENTS,
  APP_EVENTS,
  AUTOMATION_GRAPH_VERSION,
  type AutomationAction,
  type AutomationEvent,
  type AutomationGraph,
  type AutomationGraphEdge,
  type AutomationGraphMatcherData,
  type AutomationGraphNode,
  type AutomationGraphPromptNode,
  type AutomationGraphTriggerNode,
  type AutomationGraphWebhookNode,
  type AutomationMatcher,
  type AutomationsConfig,
} from './types.ts';
import type { z } from 'zod';


type ParsedAutomationsConfig = z.output<typeof AutomationsConfigSchema>;
export interface SaveAutomationGraphPayload {
  workspaceId: string;
  graph: AutomationGraph;
  /** Revision returned by getAutomationGraphProjection; rejects stale writes. */
  baseRevision: string;
}

export interface CompiledAutomationGraph {
  graph: AutomationGraph;
  automations: AutomationsConfig['automations'];
}

export interface AutomationGraphProjection {
  graph: AutomationGraph;
  /** Stable, browser-safe optimistic-concurrency token for this config document. */
  revision: string;
  /** True only when no config document exists and the pure seed projection is shown. */
  isDefault: boolean;
}

export type PersistedAutomationsConfig = AutomationsConfig & Record<string, unknown>;

export interface SavedAutomationGraph {
  config: PersistedAutomationsConfig;
  graph: AutomationGraph;
  revision: string;
  automationCount: number;
}

export class AutomationGraphError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = [message]) {
    const details = [...new Set(issues)].filter((issue) => issue !== message);
    super(details.length > 0 ? `${message}: ${details.join('; ')}` : message);
    this.name = 'AutomationGraphError';
    this.issues = issues;
  }
}

type ActionNode = AutomationGraphPromptNode | AutomationGraphWebhookNode;

function graphSchemaError(label: string, issues: readonly { path: PropertyKey[]; message: string }[]): never {
  const details = issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  throw new AutomationGraphError(label, details);
}

function parseGraph(input: unknown): AutomationGraph {
  const result = AutomationGraphSchema.safeParse(input);
  if (!result.success) graphSchemaError('Invalid automation graph', result.error.issues);
  return result.data;
}

function parseSavePayload(input: unknown): SaveAutomationGraphPayload {
  const result = SaveAutomationGraphPayloadSchema.safeParse(input);
  if (!result.success) graphSchemaError('Invalid automation graph save request', result.error.issues);
  return result.data;
}

function getActionType(action: unknown): string | undefined {
  if (!action || typeof action !== 'object' || Array.isArray(action) || !('type' in action)) return undefined;
  return typeof action.type === 'string' ? action.type : undefined;
}

function narrowRuntimeAction(
  action: unknown,
  event: AutomationEvent,
  matcherIndex: number,
  actionIndex: number,
): AutomationAction {
  const type = getActionType(action);
  const path = `automations.${event}[${matcherIndex}].actions[${actionIndex}]`;

  if (type === 'prompt') {
    const parsed = PromptActionSchema.safeParse(action);
    if (parsed.success) return parsed.data;
  } else if (type === 'webhook') {
    const parsed = WebhookActionSchema.safeParse(action);
    if (parsed.success) return parsed.data;
  } else if (type === 'knowledge') {
    const parsed = KnowledgeAutomationActionSchema.safeParse(action);
    if (parsed.success) return parsed.data;
  } else if (type === 'cloud_run.submit') {
    const parsed = CloudRunSubmitActionSchema.safeParse(action);
    if (parsed.success) return parsed.data;
  }

  const actionName = type ?? 'unknown';
  throw new AutomationGraphError(
    `Automation ${event}[${matcherIndex}] cannot be projected because action "${actionName}" is not graph-mappable`,
    [`${path}: unsupported or invalid action ${actionName}`],
  );
}

function narrowRuntimeConfig(config: ParsedAutomationsConfig): AutomationsConfig {
  const automations: AutomationsConfig['automations'] = {};

  for (const event of [...APP_EVENTS, ...AGENT_EVENTS]) {
    const matchers = config.automations[event];
    if (!matchers) continue;

    automations[event] = matchers.map((matcher, matcherIndex): AutomationMatcher => {
      const actions = matcher.actions.map((action, actionIndex) =>
        narrowRuntimeAction(action, event, matcherIndex, actionIndex),
      );
      const { actions: _actions, ...data } = matcher;
      return { ...data, actions };
    });
  }

  const runtime: AutomationsConfig = { automations };
  if (config.version !== undefined) runtime.version = config.version;
  if (config.craftSeedVersion !== undefined) runtime.craftSeedVersion = config.craftSeedVersion;
  if (config.automationGraph !== undefined) runtime.automationGraph = config.automationGraph;
  return runtime;
}

function parseRuntimeConfig(input: unknown): AutomationsConfig {
  const result = AutomationsConfigSchema.safeParse(input);
  if (!result.success) graphSchemaError('Invalid automations configuration', result.error.issues);
  return narrowRuntimeConfig(result.data);
}

function asConfigObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AutomationGraphError('Automations configuration must be a JSON object');
  }
  return input as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      return 'undefined';
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
        .join(',')}}`;
    }
    default:
      return JSON.stringify(String(value));
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A deterministic optimistic-concurrency revision. It is not a security token:
 * server-side authorization remains the RPC transport's responsibility.
 */
export function automationGraphRevision(config: unknown): string {
  return `automation-graph-v1-${fnv1a(stableJson(config))}`;
}

function isFlowNode(node: AutomationGraphNode): node is Exclude<AutomationGraphNode, { kind: 'annotation' | 'group' | 'decision' }> {
  return node.kind === 'trigger' || node.kind === 'matcher' || node.kind === 'prompt' || node.kind === 'webhook';
}

function isActionNode(node: AutomationGraphNode): node is ActionNode {
  return node.kind === 'prompt' || node.kind === 'webhook';
}

function asAction(node: ActionNode): AutomationAction {
  if (node.kind === 'prompt') return { type: 'prompt', ...node.data };
  return { type: 'webhook', ...node.data };
}


function projectionNodeId(kind: string, event: string, matcherIndex: number, actionIndex?: number): string {
  const eventPart = event.replace(/[^a-zA-Z0-9_-]/g, '_');
  return actionIndex === undefined
    ? `${kind}:${eventPart}:${matcherIndex}`
    : `${kind}:${eventPart}:${matcherIndex}:${actionIndex}`;
}

function matcherData(matcher: AutomationMatcher): AutomationGraphMatcherData {
  const { actions: _actions, ...data } = matcher;
  return data;
}

function graphFromRuntimeConfig(config: AutomationsConfig): AutomationGraph {
  const nodes: AutomationGraphNode[] = [];
  const edges: AutomationGraphEdge[] = [];
  let row = 0;

  for (const [event, matchers] of Object.entries(config.automations)) {
    if (!matchers) continue;

    for (let matcherIndex = 0; matcherIndex < matchers.length; matcherIndex += 1) {
      const matcher = matchers[matcherIndex];
      if (!matcher) continue;

      for (const action of matcher.actions) {
        if (action.type !== 'prompt' && action.type !== 'webhook') {
          throw new AutomationGraphError(
            `Automation ${event}[${matcherIndex}] cannot be projected because action "${action.type}" is not graph-mappable`,
          [`automations.${event}[${matcherIndex}].actions: unsupported action ${action.type}`],
          );
        }
      }

      const triggerId = projectionNodeId('trigger', event, matcherIndex);
      const matcherId = projectionNodeId('matcher', event, matcherIndex);
      const y = row * 160;
      row += 1;

      nodes.push({
        id: triggerId,
        kind: 'trigger',
        label: event.length <= 512 ? event : undefined,
        position: { x: 0, y },
        data: { event: event as AutomationEvent },
      });
      nodes.push({
        id: matcherId,
        kind: 'matcher',
        label: matcher.name && matcher.name.length <= 512 ? matcher.name : undefined,
        position: { x: 260, y },
        data: matcherData(matcher),
      });
      edges.push({
        id: `edge:${triggerId}:${matcherId}`,
        source: triggerId,
        target: matcherId,
        kind: 'flow',
      });

      let previousId = matcherId;
      matcher.actions.forEach((action, actionIndex) => {
        const actionId = projectionNodeId(action.type, event, matcherIndex, actionIndex);
        const position = { x: 520 + actionIndex * 260, y };
        if (action.type === 'prompt') {
          const { type: _type, ...data } = action;
          nodes.push({ id: actionId, kind: 'prompt', position, data });
        } else if (action.type === 'webhook') {
          const { type: _type, ...data } = action;
          nodes.push({ id: actionId, kind: 'webhook', position, data });
        } else {
          throw new AutomationGraphError(`Internal graph projection error for unsupported action ${action.type}`);
        }
        edges.push({
          id: `edge:${previousId}:${actionId}`,
          source: previousId,
          target: actionId,
          kind: 'flow',
        });
        previousId = actionId;
      });
    }
  }

  return {
    version: AUTOMATION_GRAPH_VERSION,
    nodes,
    edges,
  };
}

/**
 * Creates a pure default projection from the existing seeded morning scheduler
 * flow. It never touches the workspace or calls ensureDefaultAutomations.
 */
export function createDefaultAutomationGraph(): AutomationGraph {
  const seed = buildDefaultSchedulerPromptSeed();
  const { event, ...matcher } = seed;
  return graphFromRuntimeConfig({ automations: { [event]: [matcher] } });
}

function ensureUniqueIds(graph: AutomationGraph): Map<string, AutomationGraphNode> {
  const nodesById = new Map<string, AutomationGraphNode>();
  const issues: string[] = [];
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) issues.push(`Duplicate node ID: ${node.id}`);
    else nodesById.set(node.id, node);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) issues.push(`Duplicate edge ID: ${edge.id}`);
    else edgeIds.add(edge.id);

    if (!nodesById.has(edge.source)) issues.push(`Dangling edge ${edge.id}: source ${edge.source} does not exist`);
    if (!nodesById.has(edge.target)) issues.push(`Dangling edge ${edge.id}: target ${edge.target} does not exist`);
  }

  for (const node of graph.nodes) {
    if (node.kind !== 'group') continue;
    for (const memberId of node.data.memberIds ?? []) {
      if (!nodesById.has(memberId)) issues.push(`Group ${node.id} references missing node ${memberId}`);
    }
  }

  if (issues.length > 0) throw new AutomationGraphError('Invalid automation graph references', issues);
  return nodesById;
}

function detectCycles(
  nodes: Iterable<AutomationGraphNode>,
  outgoing: ReadonlyMap<string, readonly AutomationGraphEdge[]>,
): string[] {
  const states = new Map<string, 'visiting' | 'visited'>();
  const issues: string[] = [];

  const visit = (nodeId: string): void => {
    const state = states.get(nodeId);
    if (state === 'visiting') {
      issues.push(`Cyclic executable path includes ${nodeId}`);
      return;
    }
    if (state === 'visited') return;

    states.set(nodeId, 'visiting');
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.target);
    states.set(nodeId, 'visited');
  };

  for (const node of nodes) {
    if (isFlowNode(node)) visit(node.id);
  }
  return issues;
}

function compileGraph(graph: AutomationGraph): CompiledAutomationGraph {
  const nodesById = ensureUniqueIds(graph);
  const incoming = new Map<string, AutomationGraphEdge[]>();
  const outgoing = new Map<string, AutomationGraphEdge[]>();
  const issues: string[] = [];

  for (const edge of graph.edges) {
    if (edge.kind !== 'flow') continue;
    const source = nodesById.get(edge.source)!;
    const target = nodesById.get(edge.target)!;

    if (!isFlowNode(source) || !isFlowNode(target)) {
      issues.push(`Unmapped executable path ${edge.id}: flow edges cannot include ${!isFlowNode(source) ? source.kind : target.kind} metadata nodes`);
      continue;
    }

    const sourceOutgoing = outgoing.get(source.id) ?? [];
    sourceOutgoing.push(edge);
    outgoing.set(source.id, sourceOutgoing);

    const targetIncoming = incoming.get(target.id) ?? [];
    targetIncoming.push(edge);
    incoming.set(target.id, targetIncoming);
  }

  for (const node of graph.nodes) {
    if (!isFlowNode(node)) continue;
    const inputs = incoming.get(node.id) ?? [];
    const outputs = outgoing.get(node.id) ?? [];

    if (node.kind === 'trigger') {
      if (inputs.length !== 0) issues.push(`Trigger ${node.id} cannot have incoming flow edges`);
      if (outputs.length === 0) issues.push(`Trigger ${node.id} has a dangling executable path`);
      for (const edge of outputs) {
        if (nodesById.get(edge.target)?.kind !== 'matcher') {
          issues.push(`Trigger ${node.id} must connect to a matcher node`);
        }
      }
      continue;
    }

    if (node.kind === 'matcher') {
      const matcherInput = inputs.length === 1 ? inputs[0] : undefined;
      const matcherOutput = outputs.length === 1 ? outputs[0] : undefined;
      if (!matcherInput || nodesById.get(matcherInput.source)?.kind !== 'trigger') {
        issues.push(`Matcher ${node.id} must have exactly one trigger input`);
      }
      if (!matcherOutput || !isActionNode(nodesById.get(matcherOutput.target)!)) {
        issues.push(`Matcher ${node.id} must connect to exactly one prompt or webhook action`);
      }
      continue;
    }

    if (inputs.length !== 1) {
      issues.push(`Action ${node.id} must have exactly one executable input`);
    } else {
      const actionInput = inputs[0];
      const sourceKind = actionInput ? nodesById.get(actionInput.source)?.kind : undefined;
      if (sourceKind !== 'matcher' && sourceKind !== 'prompt' && sourceKind !== 'webhook') {
        issues.push(`Action ${node.id} has an unmapped executable input`);
      }
    }
    if (outputs.length > 1) issues.push(`Action ${node.id} cannot branch in the current automation runtime`);
    for (const edge of outputs) {
      if (!isActionNode(nodesById.get(edge.target)!)) {
        issues.push(`Action ${node.id} can only continue to a prompt or webhook action`);
      }
    }
  }

  issues.push(...detectCycles(graph.nodes, outgoing));
  if (issues.length > 0) throw new AutomationGraphError('Automation graph cannot compile', issues);

  const automations: AutomationsConfig['automations'] = {};
  for (const matcherNode of graph.nodes) {
    if (matcherNode.kind !== 'matcher') continue;

    const triggerEdge = incoming.get(matcherNode.id)![0]!;
    const trigger = nodesById.get(triggerEdge.source) as AutomationGraphTriggerNode;
    const actions: AutomationAction[] = [];
    let nextActionId = outgoing.get(matcherNode.id)![0]!.target;

    while (nextActionId) {
      const actionNode = nodesById.get(nextActionId)!;
      if (!isActionNode(actionNode)) {
        throw new AutomationGraphError(`Internal graph compilation error at ${nextActionId}`);
      }
      actions.push(asAction(actionNode));
      const next = outgoing.get(actionNode.id) ?? [];
      nextActionId = next[0]?.target ?? '';
    }

    const matcher: AutomationMatcher = {
      ...matcherNode.data,
      actions,
    };
    const event = trigger.data.event;
    const matchers = automations[event] ?? [];
    matchers.push(matcher);
    automations[event] = matchers;
  }

  const validatedConfig = parseRuntimeConfig({ automations });
  return { graph, automations: validatedConfig.automations };
}

/** Validate and compile an authoring graph into the current runtime format. */
export function compileAutomationGraph(input: unknown): CompiledAutomationGraph {
  return compileGraph(parseGraph(input));
}

/**
 * Derive an authoring graph from canonical configuration. Only prompt/webhook
 * paths are graph-mappable; unsupported current actions are rejected rather
 * than silently dropped during a save.
 */
export function projectAutomationsToGraph(config: unknown | null | undefined): AutomationGraph {
  if (config === null || config === undefined) return createDefaultAutomationGraph();

  const runtimeConfig = parseRuntimeConfig(config);
  if (runtimeConfig.automationGraph) {
    const compiled = compileGraph(runtimeConfig.automationGraph);
    if (stableJson(compiled.automations) === stableJson(runtimeConfig.automations)) {
      return compiled.graph;
    }
  }

  return graphFromRuntimeConfig(runtimeConfig);
}

/** Get a projection plus the revision needed for an atomic, no-clobber save. */
export function getAutomationGraphProjection(config: unknown | null | undefined): AutomationGraphProjection {
  if (config === null || config === undefined) {
    const emptyConfig = { version: 2, automations: {} };
    return {
      graph: createDefaultAutomationGraph(),
      revision: automationGraphRevision(emptyConfig),
      isDefault: true,
    };
  }

  return {
    graph: projectAutomationsToGraph(config),
    revision: automationGraphRevision(config),
    isDefault: false,
  };
}

/**
 * Build the complete next config document for the server mutex. New graph data
 * is schema-validated, runtime actions are compiler-produced and validated,
 * and all pre-existing root fields are retained unchanged.
 */
export function buildAutomationGraphSave(currentConfig: unknown, payloadInput: unknown): SavedAutomationGraph {
  const currentObject = asConfigObject(currentConfig);
  parseRuntimeConfig(currentObject);
  const payload = parseSavePayload(payloadInput);
  const currentRevision = automationGraphRevision(currentObject);

  if (payload.baseRevision !== currentRevision) {
    throw new AutomationGraphError('Automation graph is stale; reload before saving');
  }

  const compiled = compileGraph(payload.graph);
  const nextConfig: Record<string, unknown> = {
    ...currentObject,
    automations: compiled.automations,
    automationGraph: compiled.graph,
  };
  const validatedConfig = parseRuntimeConfig(nextConfig);
  const config: PersistedAutomationsConfig = { ...nextConfig, ...validatedConfig };
  return {
    config,
    graph: compiled.graph,
    revision: automationGraphRevision(config),
    automationCount: Object.values(compiled.automations).reduce((count, matchers) => count + (matchers?.length ?? 0), 0),
  };
}

/** Parse and validate an incoming graph-save RPC payload. */
export function parseSaveAutomationGraphPayload(input: unknown): SaveAutomationGraphPayload {
  return parseSavePayload(input);
}
