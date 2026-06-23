import type { PermissionMode } from '../agent/mode-types.ts';
import type { JsonSchema } from '../workflows/types.ts';

export type AgentMessageStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface MessageAgentInput {
  agentSlug: string;
  task: string;
  context?: string;
  expectedOutput?: string;
  outputSchema?: JsonSchema;
  sourceSlugs?: string[];
  skillSlugs?: string[];
  permissionMode?: PermissionMode;
  timeoutSeconds?: number;
  maxTurns?: number;
  priority?: 'low' | 'normal' | 'high';
  background?: boolean;
}

export interface MessageAgentResult {
  ok: boolean;
  status: AgentMessageStatus;
  receiptId?: string;
  childSessionId?: string;
  agentSlug: string;
  output?: unknown;
  summary?: string;
  toolUseCount: number;
  toolNames: string[];
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface AgentMessageReceipt {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  parentSessionId?: string;
  parentRunId?: string;
  parentStepId?: string;
  childSessionId?: string;
  callerAgentSlug?: string;
  targetAgentSlug: string;
  task: string;
  status: AgentMessageStatus;
  policy: {
    permissionMode: PermissionMode;
    timeoutSeconds: number;
    maxTurns: number;
    maxDepth: number;
    depth: number;
    background?: boolean;
  };
  constraints: {
    sourceSlugs: string[];
    skillSlugs: string[];
    outputSchema?: JsonSchema;
  };
  result?: {
    output?: unknown;
    summary?: string;
    toolUseCount: number;
    toolNames: string[];
  };
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AgentMessageValidationOptions {
  parentPermissionMode?: PermissionMode;
  depth?: number;
  maxDepth?: number;
}

export interface NormalizedMessageAgentInput extends MessageAgentInput {
  agentSlug: string;
  task: string;
  sourceSlugs: string[];
  skillSlugs: string[];
  permissionMode: PermissionMode;
  timeoutSeconds: number;
  maxTurns: number;
  priority: 'low' | 'normal' | 'high';
  background: boolean;
}
