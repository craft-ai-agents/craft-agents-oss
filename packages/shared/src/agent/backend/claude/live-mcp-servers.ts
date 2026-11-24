/**
 * MCP servers of a live keep-alive query.
 *
 * The persistent query reads `mcpServers` only when it is created, so a later turn sets its own with
 * `Query.setMcpServers` (ClaudeAgent.syncPersistentMcpServers). The SDK compares servers by name and
 * keeps the instance it already has under a name, so a server whose tools changed (a source's tools
 * after a reconnect, the Coding profile's session tools once a source is enabled) has to be removed
 * and added back. To tell which ones changed, the in-process servers built for Claude sessions go
 * through createToolServer, which remembers their tool names. Names only: the CLI keeps the definition
 * of a tool it has listed for the life of its process (verified on 2.1.316: a changed description
 * still reached the model unchanged after the server was removed and added back, on later turns and
 * after /compact), so replacing a server for a changed description or schema would gain nothing.
 *
 * Removing a server fails the calls it is still answering: a background agent's, since the session's
 * own turn has not started yet. createToolServer counts each instance's calls in flight, and a server
 * that is busy stays until a later turn finds it idle (waitForIdleMcpServers).
 *
 * `setMcpServers` returns before the servers it adds have connected (an in-process one takes a few
 * milliseconds, measured on SDK 0.3.316), so the agent waits for them (waitForMcpServers) before it
 * starts the turn: a request sent earlier has none of their tools.
 */

import { createSdkMcpServer, type McpServerConfig, type Query } from '@anthropic-ai/claude-agent-sdk';

export type ToolServer = ReturnType<typeof createSdkMcpServer>;
type ToolServerOptions = Parameters<typeof createSdkMcpServer>[0];
type ToolDefinition = NonNullable<ToolServerOptions['tools']>[number];

/** A server a live query serves: the instance the SDK uses, and what it serves (null: unknown). */
export interface LiveMcpServer {
  config: McpServerConfig;
  signature: string | null;
}

/**
 * The servers a live query serves, by name. A server whose signature is null (it failed to connect)
 * is replaced by the next turn whatever that turn has.
 */
export type LiveMcpServers = Map<string, LiveMcpServer>;

interface ToolServerState {
  signature: string;
  calls: number;
  /** Resolvers of waitForIdleMcpServers, called when `calls` drops to 0. */
  idle: Set<() => void>;
}

const stateByServer = new WeakMap<object, ToolServerState>();

/**
 * createSdkMcpServer, remembering the names of the tools the server serves and counting the calls it
 * is answering.
 */
export function createToolServer(options: ToolServerOptions): ToolServer {
  const state: ToolServerState = {
    signature: (options.tools ?? []).map(tool => tool.name).sort().join('\n'),
    calls: 0,
    idle: new Set(),
  };
  const tools = options.tools?.map((definition): ToolDefinition => ({
    ...definition,
    handler: async (args, extra) => {
      state.calls++;
      try {
        return await definition.handler(args, extra);
      } finally {
        if (--state.calls === 0) for (const resolve of state.idle) resolve();
      }
    },
  }));
  const server = createSdkMcpServer({ ...options, tools });
  stateByServer.set(server, state);
  return server;
}

/**
 * What a server serves: the tool names of one createToolServer built. Any other in-process server
 * compares by its name alone, as the SDK does; a process-based server by its config.
 */
export function mcpServerSignature(config: McpServerConfig): string {
  return config.type === 'sdk' ? stateByServer.get(config)?.signature ?? '' : JSON.stringify(config);
}

/** The servers of a query that was just created with `servers`. */
export function liveMcpServers(servers: Record<string, McpServerConfig>): LiveMcpServers {
  return new Map(Object.entries(servers).map(([name, config]) => [name, { config, signature: mcpServerSignature(config) }]));
}

export interface McpServerChanges {
  /** Servers that stay as they are. */
  unchanged: string[];
  /** Servers whose tools changed, removed before they are added back (all when the current set is unknown). */
  replaced: string[];
  /** Live servers the next set does not have. */
  dropped: string[];
}

/** What setting `next` on a query that serves `current` (null: unknown) takes; null when nothing changed. */
export function mcpServerChanges(current: LiveMcpServers | null, next: Record<string, McpServerConfig>): McpServerChanges | null {
  const names = Object.keys(next);
  const unchanged = names.filter((name) => {
    const signature = current?.get(name)?.signature;
    return signature != null && signature === mcpServerSignature(next[name]!);
  });
  const dropped = current ? [...current.keys()].filter(name => !(name in next)) : [];
  if (current && unchanged.length === names.length && dropped.length === 0) return null;
  return { unchanged, replaced: names.filter(name => !unchanged.includes(name) && (!current || current.has(name))), dropped };
}

/** Calls the live instance of a server is answering. 0 for a server createToolServer did not build. */
function callsInFlight(server: LiveMcpServer | undefined): number {
  return server ? stateByServer.get(server.config)?.calls ?? 0 : 0;
}

/**
 * Wait until the live instances of the named servers answer no call, or until `deadline` (epoch ms).
 * Returns the names still busy.
 */
export async function waitForIdleMcpServers(current: LiveMcpServers, names: string[], deadline: number): Promise<string[]> {
  if (names.length === 0) return [];
  const busy = () => names.filter(name => callsInFlight(current.get(name)) > 0);
  const states = busy().map(name => stateByServer.get(current.get(name)!.config)!);
  const resolvers: Array<[ToolServerState, () => void]> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (states.length > 0) {
      await Promise.race([
        Promise.all(states.map(state => new Promise<void>((resolve) => {
          state.idle.add(resolve);
          resolvers.push([state, resolve]);
        }))),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); }),
      ]);
    }
  } finally {
    clearTimeout(timer);
    for (const [state, resolve] of resolvers) state.idle.delete(resolve);
  }
  // A handler that just returned hands its result to the CLI a few microtasks later: let it go out
  // before a removal does, or the CLI drops the server first and fails the call anyway
  await new Promise(resolve => setTimeout(resolve, 0));
  return busy();
}

/** Interval between status checks while added servers connect. */
const CONNECT_POLL_MS = 5;

/**
 * Wait until the named servers of a live query have connected, or until `deadline` (epoch ms).
 * Returns the names that did not connect (failed, or still connecting at the deadline).
 */
export async function waitForMcpServers(live: Pick<Query, 'mcpServerStatus'>, names: string[], deadline: number): Promise<string[]> {
  while (names.length > 0) {
    const statuses = new Map((await live.mcpServerStatus()).map(server => [server.name, server.status]));
    const connecting = names.filter(name => (statuses.get(name) ?? 'pending') === 'pending');
    if (connecting.length === 0 || Date.now() >= deadline) {
      return names.filter(name => statuses.get(name) !== 'connected');
    }
    await new Promise(resolve => setTimeout(resolve, CONNECT_POLL_MS));
  }
  return [];
}
