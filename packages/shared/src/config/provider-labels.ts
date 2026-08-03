/**
 * Human-readable label per provider type string, with optional isLocalModel override.
 * When isLocalModel is true and the type would otherwise show a generic label,
 * returns "Ollama (Local)" instead.
 *
 * Accepts `string` rather than the narrower `LlmProviderType` union because the
 * renderer can encounter provider types (e.g. 'openai', 'vertex', 'bedrock')
 * that aren't part of the canonical union yet are handled at runtime.
 *
 * Extracted here so both the ProvidersPanel card type row and the model picker
 * dropdown share one source of truth.
 */
export function providerLabel(type: string, isLocalModel?: boolean): string {
  // Local-model (Ollama) connections use anthropic_api_key but are not cloud Anthropic
  if (isLocalModel) return 'Ollama (Local)'

  switch (type) {
    case 'anthropic':       return 'Anthropic (Claude)'
    case 'pi':              return 'Pi SDK'
    case 'pi_compat':       return 'OpenAI-compatible'
    case 'openai':          return 'OpenAI'
    case 'vertex':          return 'Vertex AI'
    case 'bedrock':         return 'Bedrock'
    default:                return String(type)
  }
}

/**
 * Return a human-readable label for a connection, considering the
 * isLocalModel flag so local-model connections (e.g. Ollama) show
 * "Ollama (Local)" instead of the raw connection name.
 *
 * Uses a minimal inline type so it accepts any connection-like object
 * that has `name` and optional `isLocalModel`, avoiding cross-package
 * type-resolution issues with `LlmConnectionWithStatus`.
 */
export function getConnectionDisplayName(
  conn: { name: string; isLocalModel?: boolean },
): string {
  if (conn.isLocalModel) return 'Ollama (Local)'
  return conn.name
}
