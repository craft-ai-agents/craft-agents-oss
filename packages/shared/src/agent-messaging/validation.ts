import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import type { PermissionMode } from '../agent/mode-types.ts';
import type {
  AgentMessageValidationOptions,
  MessageAgentInput,
  NormalizedMessageAgentInput,
} from './types.ts';

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1800;
const DEFAULT_MAX_TURNS = 1;
const MAX_TURNS = 1;
const DEFAULT_MAX_DEPTH = 2;
const MAX_TASK_CHARS = 8000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_EXPECTED_OUTPUT_CHARS = 4000;

const PERMISSION_RANK: Record<PermissionMode, number> = {
  safe: 0,
  ask: 1,
  'allow-all': 2,
};

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueCleanStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function isPermissionEscalation(
  requested: PermissionMode,
  parent: PermissionMode,
): boolean {
  return PERMISSION_RANK[requested] > PERMISSION_RANK[parent];
}

export function normalizeMessageAgentInput(
  input: MessageAgentInput,
  options?: AgentMessageValidationOptions,
): NormalizedMessageAgentInput {
  const agentSlug = cleanString(input.agentSlug);
  if (!agentSlug || !AGENT_SLUG_REGEX.test(agentSlug)) {
    throw new Error('agentSlug must be a valid agent slug.');
  }

  const task = cleanString(input.task);
  if (!task) throw new Error('task is required.');
  if (task.length > MAX_TASK_CHARS) throw new Error(`task must be ${MAX_TASK_CHARS} characters or fewer.`);

  const context = cleanString(input.context);
  if (context && context.length > MAX_CONTEXT_CHARS) {
    throw new Error(`context must be ${MAX_CONTEXT_CHARS} characters or fewer.`);
  }

  const expectedOutput = cleanString(input.expectedOutput);
  if (expectedOutput && expectedOutput.length > MAX_EXPECTED_OUTPUT_CHARS) {
    throw new Error(`expectedOutput must be ${MAX_EXPECTED_OUTPUT_CHARS} characters or fewer.`);
  }

  const parentPermissionMode = options?.parentPermissionMode ?? 'ask';
  const requestedPermissionMode = input.permissionMode ?? parentPermissionMode;
  if (isPermissionEscalation(requestedPermissionMode, parentPermissionMode)) {
    throw new Error(`message_agent cannot escalate permissionMode from ${parentPermissionMode} to ${requestedPermissionMode}.`);
  }

  const depth = options?.depth ?? 0;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (depth >= maxDepth) {
    throw new Error(`message_agent maximum delegation depth reached (${maxDepth}).`);
  }

  return {
    agentSlug,
    task,
    context,
    expectedOutput,
    outputSchema: input.outputSchema,
    sourceSlugs: uniqueCleanStrings(input.sourceSlugs),
    skillSlugs: uniqueCleanStrings(input.skillSlugs),
    permissionMode: requestedPermissionMode,
    timeoutSeconds: clampInt(input.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, 1, MAX_TIMEOUT_SECONDS),
    maxTurns: clampInt(input.maxTurns, DEFAULT_MAX_TURNS, 1, MAX_TURNS),
    priority: input.priority ?? 'normal',
    background: input.background === true,
  };
}

export { DEFAULT_MAX_DEPTH };
