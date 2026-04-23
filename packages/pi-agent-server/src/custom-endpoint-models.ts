export type CustomEndpointInput = 'text' | 'image'

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  supportsImages?: boolean
  /**
   * Whether this model is reasoning-capable (i.e. Pi SDK should pass the
   * session's thinkingLevel through as reasoning_effort on requests).
   * Required for providers like Cursor that expose effort-suffixed variants
   * (claude-4.6-opus-medium, gpt-5.4-high, …) and expect the caller to
   * send reasoning_effort so the upstream proxy can select the right
   * variant.
   */
  reasoning?: boolean
  /**
   * Whether the upstream endpoint actually honours OpenAI-style
   * `reasoning_effort` on chat completion requests. Pi's openai-completions
   * driver gates the `reasoning_effort` param on both (model.reasoning &&
   * compat.supportsReasoningEffort); the default compat block derived from
   * baseUrl heuristics doesn't know about private loopback proxies like
   * ours, so we thread this through explicitly when true.
   */
  supportsReasoningEffort?: boolean
  /**
   * Map from Pi/Craft thinking levels (minimal/low/medium/high/xhigh) to
   * the suffix the upstream endpoint expects. For Cursor this comes from
   * buildEffortMap in @craft-agent/cursor-provider: e.g. { minimal:"low",
   * low:"low", medium:"medium", high:"high", xhigh:"max" } for a Claude
   * variant. Passed straight through to compat.reasoningEffortMap.
   */
  reasoningEffortMap?: Record<string, string>
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Uses reasonable defaults for context window and max tokens since we can't
 * query the endpoint for its actual capabilities. Image support must be
 * explicitly enabled either at the connection level or per-model.
 *
 * Reasoning support is explicitly opt-in: if the caller knows the endpoint
 * understands `reasoning_effort` (e.g. Cursor's OpenAI-compat proxy), they
 * should pass reasoning: true + supportsReasoningEffort: true so the Pi
 * SDK actually emits the field instead of dropping it.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
) {
  const supportsImages = overrides?.supportsImages ?? defaults?.supportsImages ?? false
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']
  const reasoning = overrides?.reasoning ?? false
  const supportsReasoningEffort = overrides?.supportsReasoningEffort ?? false
  const reasoningEffortMap = overrides?.reasoningEffortMap

  return {
    id,
    name: id,
    reasoning,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: overrides?.contextWindow ?? 131_072,
    maxTokens: 8_192,
    // Pi SDK reads compat.* to decide whether to emit reasoning_effort and
    // to map Pi levels → upstream suffixes. See pi-ai's openai-completions
    // provider: params.reasoning_effort is set only when model.reasoning &&
    // compat.supportsReasoningEffort are both true. Setting these fields
    // overrides the baseUrl-sniffing defaults that don't know about our
    // loopback Cursor proxy.
    ...(reasoning || supportsReasoningEffort || reasoningEffortMap
      ? {
          compat: {
            ...(supportsReasoningEffort !== undefined
              ? { supportsReasoningEffort }
              : {}),
            ...(reasoningEffortMap ? { reasoningEffortMap } : {}),
          },
        }
      : {}),
  }
}
