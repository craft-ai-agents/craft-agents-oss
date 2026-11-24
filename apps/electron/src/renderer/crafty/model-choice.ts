/**
 * Which connection, model and thinking level a Crafty question runs on. Pure, so it's tested
 * without a window (`__tests__/model-choice.test.ts`); `useCraftyModel` feeds it.
 *
 * A new Crafty session starts like a new session in Craft: the workspace's defaults. The panel's
 * model menu changes that, and the last pick is remembered on this device for the next time Crafty
 * opens.
 */

import { ANTHROPIC_MODELS } from '@config/models'
import { resolveEffectiveConnectionSlug, type LlmConnectionWithStatus } from '@config/llm-connections'
import { normalizeThinkingLevel, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import type { CraftySessionModel } from '../../shared/crafty'

/** The workspace's defaults for new sessions (its settings, then the app's thinking level). */
export interface CraftyDefaults {
  connection?: string
  model?: string
  thinkingLevel: ThinkingLevel
}

export interface ResolvedCraftyModel {
  /** The session's connection, or the pick; undefined means the default chain decides. */
  connection: string | undefined
  model: string
  thinkingLevel: ThinkingLevel
}

const modelIds = (connection: LlmConnectionWithStatus) =>
  (connection.models || ANTHROPIC_MODELS).map(model => (typeof model === 'string' ? model : model.id))

/**
 * The remembered pick, minus what no longer applies: a connection that's gone or signed out
 * takes its model with it, and a model the connection no longer lists is dropped.
 */
export function usableChoice(choice: CraftySessionModel, connections: LlmConnectionWithStatus[]): CraftySessionModel {
  const thinkingLevel = normalizeThinkingLevel(choice.thinkingLevel)
  const connection = choice.llmConnection ? connections.find(c => c.slug === choice.llmConnection) : undefined
  if (!connection || !connection.isAuthenticated) return { thinkingLevel }
  const model = choice.model && modelIds(connection).includes(choice.model) ? choice.model : undefined
  return { llmConnection: connection.slug, model, thinkingLevel }
}

/** A tier hint ('fast', 'default') isn't a model id; the session resolves it on the server. */
const isModelId = (model: string | undefined): model is string => !!model && model !== 'fast' && model !== 'default'

/**
 * What the menu shows: the live session's settings once it exists, else the pick, else the
 * workspace defaults. A model left unset is the connection's default, as in Craft's composer.
 */
export function resolveCraftyModel({ connections, defaults, choice, session }: {
  connections: LlmConnectionWithStatus[]
  defaults: CraftyDefaults
  /** Already passed through `usableChoice`. */
  choice: CraftySessionModel
  session: CraftySessionModel | null
}): ResolvedCraftyModel {
  const connection = session ? session.llmConnection : choice.llmConnection
  const effective = resolveEffectiveConnectionSlug(connection, defaults.connection, connections)
  const connectionDefault = connections.find(c => c.slug === effective)?.defaultModel ?? ''
  const thinkingLevel = session?.thinkingLevel ?? choice.thinkingLevel ?? defaults.thinkingLevel
  if (session) return { connection, model: session.model ?? connectionDefault, thinkingLevel }
  if (choice.model) return { connection, model: choice.model, thinkingLevel }
  // The workspace's default model belongs to its default connection, not to a picked one
  const workspaceModel = !choice.llmConnection && isModelId(defaults.model) ? defaults.model : undefined
  return { connection, model: workspaceModel ?? connectionDefault, thinkingLevel }
}

/**
 * The new session's options: only what was picked, so an untouched menu gets the defaults like
 * any new session. A picked connection always goes with its model, because on its own the server
 * would pair it with the workspace's default model.
 */
export function sessionOptionsFor(choice: CraftySessionModel, resolved: ResolvedCraftyModel): CraftySessionModel {
  const options: CraftySessionModel = {}
  if (choice.llmConnection) {
    options.llmConnection = choice.llmConnection
    if (resolved.model) options.model = resolved.model
  }
  if (choice.thinkingLevel) options.thinkingLevel = choice.thinkingLevel
  return options
}
