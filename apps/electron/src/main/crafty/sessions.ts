import type { RemoteServerConfig, Workspace } from '@craft-agent/core/types'
import { createLabel } from '@craft-agent/shared/labels/crud'
import { listLabels } from '@craft-agent/shared/labels/storage'
import { findLabelById, type CreateLabelInput, type LabelConfig } from '@craft-agent/shared/labels'
import { RPC_CHANNELS, type Session } from '@craft-agent/shared/protocol'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import { mainLog } from '../logger'
import type { CraftyCreateSessionResult, CraftySessionModel, CraftySessionSummary } from '../../shared/crafty'

/** Label for Crafty's sessions, so they're easy to find and delete. */
export const CRAFTY_LABEL = 'crafty'

/** The label as Crafty creates it in a workspace that lacks it, local or on a server. */
const CRAFTY_LABEL_INPUT: CreateLabelInput = { name: 'Crafty', color: 'foreground/50' }

/** One label check per workspace at a time: two first questions at once would each create it ("crafty-2"). */
const labelChecks = new Map<string, Promise<string>>()

/**
 * The `crafty` label's id in a workspace, created where it's missing. `list` and `create` reach the
 * workspace's labels: in this process for a local workspace, over RPC for a remote one (its server
 * runs the same functions).
 */
function ensureCraftyLabel(
  workspaceId: string,
  list: () => LabelConfig[] | Promise<LabelConfig[]>,
  create: (input: CreateLabelInput) => LabelConfig | Promise<LabelConfig>,
): Promise<string> {
  const running = labelChecks.get(workspaceId)
  if (running) return running
  const check = (async () => {
    if (findLabelById(await list(), CRAFTY_LABEL)) return CRAFTY_LABEL
    return (await create(CRAFTY_LABEL_INPUT)).id
  })().finally(() => labelChecks.delete(workspaceId))
  labelChecks.set(workspaceId, check)
  return check
}

/**
 * Crafty's session work in one workspace: checking the target, the target menu's list, the sessions
 * Crafty creates and its one-shots (Rewrite, Translate). A local workspace's sessions live in this
 * process's SessionManager, a remote workspace's on its server. Either way the summaries name the
 * workspace by its id here: a remote server's sessions carry the server's own workspace id.
 */
export interface CraftySessions {
  /** The session, if it can take Crafty's questions; null when it's gone, archived or hidden. */
  find(sessionId: string): Promise<CraftySessionSummary | null>
  /** The sessions that can take them, most recent first. */
  list(limit: number): Promise<CraftySessionSummary[]>
  /** A new session, labelled `crafty`; unset fields take the workspace's defaults. */
  create(model: CraftySessionModel): Promise<CraftyCreateSessionResult>
  /** One completion outside any session, on the connection's mini model. Nothing is stored. */
  complete(prompt: string, model: CraftySessionModel): Promise<string>
}

/** Archived and hidden sessions (a task's or an automation's internals) can't be targets. */
export function canTakeCrafty(session: Pick<Session, 'isArchived' | 'hidden'>): boolean {
  return !session.isArchived && !session.hidden
}

/** `workspaceId`: the workspace's id here, not the session's (a remote server's own id). */
export function summarize(session: Session, workspaceId: string): CraftySessionSummary {
  return {
    workspaceId,
    sessionId: session.id,
    name: session.name ?? null,
    preview: session.preview ?? null,
    lastMessageAt: session.lastMessageAt ?? null,
    isProcessing: !!session.isProcessing,
    llmConnection: session.llmConnection,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
  }
}

function created(session: Session, workspaceId: string): CraftyCreateSessionResult {
  return {
    sessionId: session.id,
    workspaceId,
    llmConnection: session.llmConnection,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
  }
}

/** A local workspace: everything runs in this process. */
export function localCraftySessions(sessionManager: SessionManager, workspace: Workspace): CraftySessions {
  return {
    async find(sessionId) {
      // At startup sessions load in the background; until then every session reads as missing
      await sessionManager.waitForSessionsLoaded()
      const session = sessionManager.getSessionSnapshot(sessionId)
      return session && session.workspaceId === workspace.id && canTakeCrafty(session) ? summarize(session, workspace.id) : null
    },

    async list(limit) {
      await sessionManager.waitForSessionsLoaded()
      return sessionManager.getSessions(workspace.id)
        .filter(canTakeCrafty)
        .slice(0, limit)
        .map(session => summarize(session, workspace.id))
    },

    async create(model) {
      let labels: string[] | undefined
      try {
        labels = [await ensureCraftyLabel(workspace.id, () => listLabels(workspace.rootPath), input => createLabel(workspace.rootPath, input))]
      } catch (error) {
        mainLog.warn('[crafty] could not ensure the crafty label', error)
      }
      // createSession announces it to every window, so the main window lists it right away and
      // "Open in Craft" finds it
      const session = await sessionManager.createSession(workspace.id, { labels, ...model })
      return created(session, workspace.id)
    },

    complete(prompt, model) {
      return sessionManager.runUtilityCompletion(workspace.id, prompt, { llmConnection: model.llmConnection, model: model.model })
    },
  }
}

/** What the remote side needs of a connection to the workspace's server (a `WsRpcClient`). */
export interface CraftyRemoteClient {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  /** False for a channel the server didn't advertise: it's older than the channel. */
  isChannelAvailable(channel: string): boolean
}

/** Where the remote side gets its connection (`RemoteConnections`, one per workspace). */
export interface CraftyRemoteConnection {
  /** The open connection, else a new one; rejects when the server can't be reached. */
  get(): Promise<CraftyRemoteClient>
  /** Stop using `client`, so the next call reconnects. */
  discard(client: CraftyRemoteClient): void
}

/** `WsRpcClient` rejects a request that got no answer in time with this message. */
function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Request timeout')
}

/**
 * A remote workspace: every call goes to its server, over a connection whose handshake names the
 * server's workspace (so `sessions:get` lists that workspace). The server announces a session
 * created here to its other clients, Craft's windows among them (servers before this change don't).
 */
export function remoteCraftySessions(
  workspace: Workspace,
  server: RemoteServerConfig,
  connection: CraftyRemoteConnection,
): CraftySessions {
  const remoteId = server.remoteWorkspaceId
  // Nothing in the panel names the server, so its errors say whose it is
  const call = async <T>(work: (rpc: CraftyRemoteClient) => Promise<T>): Promise<T> => {
    let rpc: CraftyRemoteClient
    try {
      rpc = await connection.get()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Couldn't reach the server of “${workspace.name}”: ${reason}`)
    }
    try {
      return await work(rpc)
    } catch (error) {
      if (!isRequestTimeout(error)) throw error
      // After sleep or a network change a socket can be dead with no reset ever arriving, and the
      // connection still reads as connected: reconnect next time instead of waiting out each call
      connection.discard(rpc)
      throw new Error(`The server of “${workspace.name}” didn't answer in time.`)
    }
  }
  const usable = (session: Session | null | undefined): session is Session =>
    !!session && session.workspaceId === remoteId && canTakeCrafty(session)

  return {
    async find(sessionId) {
      const session = await call(async rpc => rpc.isChannelAvailable(RPC_CHANNELS.sessions.GET_METADATA)
        ? await rpc.invoke(RPC_CHANNELS.sessions.GET_METADATA, sessionId) as Session | null
        // A server older than the single-session lookup: find it in the list
        : (await rpc.invoke(RPC_CHANNELS.sessions.GET) as Session[]).find(s => s.id === sessionId))
      return usable(session) ? summarize(session, workspace.id) : null
    },

    async list(limit) {
      // Most recent first, as the server sorts them
      const sessions = await call(async rpc => await rpc.invoke(RPC_CHANNELS.sessions.GET) as Session[])
      return sessions.filter(usable).slice(0, limit).map(session => summarize(session, workspace.id))
    },

    create(model) {
      return call(async rpc => {
        let labels: string[] | undefined
        try {
          labels = [await ensureCraftyLabel(
            workspace.id,
            async () => await rpc.invoke(RPC_CHANNELS.labels.LIST, remoteId) as LabelConfig[],
            async input => await rpc.invoke(RPC_CHANNELS.labels.CREATE, remoteId, input) as LabelConfig,
          )]
        } catch (error) {
          // Creating the session on a connection that just timed out would wait as long again
          if (isRequestTimeout(error)) throw error
          mainLog.warn('[crafty] could not ensure the crafty label on the server', error)
        }
        const session = await rpc.invoke(RPC_CHANNELS.sessions.CREATE, remoteId, { ...(labels && { labels }), ...model }) as Session
        return created(session, workspace.id)
      })
    },

    complete(prompt, model) {
      return call(async rpc => {
        if (!rpc.isChannelAvailable(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION)) {
          throw new Error(`Rewrite and Translate need a newer version of Craft Agents on the server of “${workspace.name}”.`)
        }
        return await rpc.invoke(RPC_CHANNELS.sessions.RUN_UTILITY_COMPLETION, remoteId, prompt, {
          llmConnection: model.llmConnection,
          model: model.model,
        }) as string
      })
    },
  }
}
