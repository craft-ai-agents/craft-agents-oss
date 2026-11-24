import * as React from 'react'
import { ANTHROPIC_MODELS, getModelDisplayName, type ModelDefinition } from '@config/models'
import {
  isCompatProvider,
  resolveEffectiveConnectionSlug,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'
import { derivePickerMode, type PickerMode } from './picker-mode'
import { groupConnectionsByProvider, stripPiPrefixForDisplay } from './model-picker-helpers'

export interface ModelPickerStateInput {
  llmConnections: LlmConnectionWithStatus[]
  workspaceDefaultConnection: string | undefined
  /** The session's own connection; undefined until it has one (then the defaults apply). */
  currentConnection: string | undefined
  currentModel: string
  /** No message yet, so the connection can still change (the switcher). */
  isEmptySession: boolean
  /** The session's connection has been removed. */
  connectionUnavailable: boolean
}

export interface ModelPickerState {
  /** The connection in use: the session's, else the workspace default, else the global default, else the first. */
  effectiveConnection: string | undefined
  effectiveConnectionDetails: LlmConnectionWithStatus | null
  /** The session's own connection (null while it has none). */
  currentConnectionDetails: LlmConnectionWithStatus | null
  /** Non-null only for a `pi_compat` connection with at most one model (a custom endpoint's fixed model). */
  connectionDefaultModel: string | null
  pickerMode: PickerMode
  availableModels: Array<ModelDefinition | string>
  currentModelDisplayName: string
  /** The current model says it can't think. */
  thinkingDisabled: boolean
  connectionsByProvider: Array<[string, LlmConnectionWithStatus[]]>
}

/**
 * What the model picker shows, derived from the connections and the session's choice. Shared by
 * the desktop menu (`FreeFormInput` → `ComposerModelMenu`), the compact drawer
 * (`CompactModelSelector`) and Crafty's panel, so they can't disagree.
 */
export function useModelPickerState({
  llmConnections,
  workspaceDefaultConnection,
  currentConnection,
  currentModel,
  isEmptySession,
  connectionUnavailable,
}: ModelPickerStateInput): ModelPickerState {
  const effectiveConnection = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)

  const effectiveConnectionDetails = React.useMemo(() => {
    if (!effectiveConnection) return null
    return llmConnections.find(c => c.slug === effectiveConnection) ?? null
  }, [llmConnections, effectiveConnection])

  const currentConnectionDetails = React.useMemo(() => {
    if (!currentConnection) return null
    return llmConnections.find(c => c.slug === currentConnection) ?? null
  }, [llmConnections, currentConnection])

  // Standard providers (anthropic, pi) get null, so the normal model list shows
  const connectionDefaultModel = React.useMemo(() => {
    const conn = effectiveConnectionDetails
    if (!conn || !isCompatProvider(conn.providerType)) return null
    // A custom endpoint with several models can switch between them
    if (conn.models && conn.models.length > 1) return null
    return conn.defaultModel ?? null
  }, [effectiveConnectionDetails])

  const pickerMode = derivePickerMode({
    connectionUnavailable,
    connectionDefaultModel,
    isEmptySession,
    connectionCount: llmConnections.length,
  })

  const availableModels = React.useMemo<Array<ModelDefinition | string>>(() => {
    // Connection removed: never fall through to another connection's models
    if (connectionUnavailable) return []
    // Every connection has models (backfillAllConnectionModels); ANTHROPIC_MODELS is a safety net
    return effectiveConnectionDetails?.models || ANTHROPIC_MODELS
  }, [effectiveConnectionDetails, connectionUnavailable])

  const thinkingDisabled = React.useMemo(() => {
    const model = availableModels.find(m => typeof m !== 'string' && m.id === currentModel)
    return typeof model !== 'string' && model?.supportsThinking === false
  }, [availableModels, currentModel])

  // The full name, not the short one
  const currentModelDisplayName = React.useMemo(() => {
    const modelToDisplay = connectionDefaultModel ?? currentModel
    const model = availableModels.find(m => (typeof m === 'string' ? m === modelToDisplay : m.id === modelToDisplay))
    if (!model) return stripPiPrefixForDisplay(getModelDisplayName(modelToDisplay))
    if (typeof model === 'string') return stripPiPrefixForDisplay(model)
    // Partial entries (custom-endpoint config, vision-toggle promotions) may lack a name; the
    // trigger must never go blank
    return model.name ?? stripPiPrefixForDisplay(model.id)
  }, [availableModels, currentModel, connectionDefaultModel])

  const connectionsByProvider = React.useMemo(() => groupConnectionsByProvider(llmConnections), [llmConnections])

  return {
    effectiveConnection,
    effectiveConnectionDetails,
    currentConnectionDetails,
    connectionDefaultModel,
    pickerMode,
    availableModels,
    currentModelDisplayName,
    thinkingDisabled,
    connectionsByProvider,
  }
}
