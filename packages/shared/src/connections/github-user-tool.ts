/**
 * Agent-facing github_user session tool.
 *
 * Calls GitHub /user through InProcessCredentialBroker.perform so the agent
 * context never sees the raw token — only { login }.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CredentialRefId } from '@craft-agent/core/platform';
import {
  applyTrustedHttpHeader,
  type InProcessCredentialBroker,
  type ProviderMaterialization,
  type SecretProvider,
} from '../credentials/index.ts';

export type GithubUserFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export interface GithubUserConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly credentialRefId: string;
}

export interface GithubUserToolKernel {
  getConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<GithubUserConnection | null | undefined>;
}

export interface GithubUserToolHost {
  getKernel: () => GithubUserToolKernel;
  getBroker: () => InProcessCredentialBroker;
  getProvider: () => SecretProvider;
  fetchImpl: GithubUserFetch;
}

export interface GithubUserToolInput {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly consumerId?: string;
}

export interface GithubUserToolResult {
  readonly login: string;
}

let host: GithubUserToolHost | undefined;

export function setGithubUserToolHost(next: GithubUserToolHost | undefined): void {
  host = next;
}

export function getGithubUserToolHost(): GithubUserToolHost | undefined {
  return host;
}

/** Same contract as server-core performGithubUser — kept in shared to avoid a reverse dep. */
export async function performGithubUser(
  materialization: ProviderMaterialization,
  fetchImpl: GithubUserFetch,
): Promise<GithubUserToolResult> {
  const headers = applyTrustedHttpHeader(
    { Accept: 'application/vnd.github+json' },
    materialization,
  );
  const response = await fetchImpl('https://api.github.com/user', { headers });
  const body = await response.json() as { login?: unknown };
  if (typeof body.login !== 'string' || !body.login) throw new Error('operation_failed');
  return { login: body.login };
}

export async function executeGithubUserTool(
  input: GithubUserToolInput,
): Promise<GithubUserToolResult> {
  const current = getGithubUserToolHost();
  if (!current) throw new Error('github_tool_unavailable');

  const workspaceId = input.workspaceId?.trim();
  const connectionId = input.connectionId?.trim();
  if (!workspaceId || !connectionId) throw new Error('invalid_input');

  const consumerId = (input.consumerId?.trim() || 'agent');
  const connection = await current.getKernel().getConnection(workspaceId, connectionId);
  if (!connection) throw new Error('connection_not_found');
  if (connection.integrationId !== 'github') throw new Error('unsupported_integration');

  const credentialRefId = connection.credentialRefId as CredentialRefId;
  // getProvider is part of the host contract for Electron FabricImportHost wiring;
  // materialization happens inside broker.perform → resolveForLease.
  if (!current.getProvider()) throw new Error('github_tool_unavailable');

  const broker = current.getBroker();
  const lease = await broker.acquireLease({
    credentialRef: credentialRefId,
    consumer: {
      kind: 'agent',
      id: consumerId,
      workspaceId,
    },
    purpose: 'github.user',
    action: 'github.api',
    resources: ['github:user'],
    audience: 'local-broker',
    ttl: 5_000,
  });

  return broker.perform(lease.id, (materialization) => (
    performGithubUser(materialization, current.fetchImpl)
  ));
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export const GithubUserToolInputSchema = z.object({
  workspaceId: z.string().describe('Workspace that owns the GitHub connection'),
  connectionId: z.string().describe('WorkGraph connection id for the GitHub credential'),
  consumerId: z.string().optional().describe('Lease consumer id (defaults to "agent")'),
});

export const GITHUB_USER_TOOL_DESCRIPTION =
  `Fetch the authenticated GitHub login for a WorkGraph GitHub connection.

Uses the Connection Fabric broker: the agent receives only { login }. The raw token never enters tool results or agent context.

Requires workspaceId + connectionId. Optional consumerId selects the granted lease consumer (default "agent").`;

/** Claude SDK session tool wrapper — delegates to executeGithubUserTool. */
export function createGithubUserTool() {
  return tool(
    'github_user',
    GITHUB_USER_TOOL_DESCRIPTION,
    {
      workspaceId: z.string().describe('Workspace that owns the GitHub connection'),
      connectionId: z.string().describe('WorkGraph connection id for the GitHub credential'),
      consumerId: z.string().optional().describe('Lease consumer id (defaults to "agent")'),
    },
    async (args) => {
      try {
        const result = await executeGithubUserTool({
          workspaceId: args.workspaceId,
          connectionId: args.connectionId,
          consumerId: args.consumerId,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(`github_user failed: ${message}`);
      }
    },
    { annotations: { readOnlyHint: true } },
  );
}
