/**
 * Provider Icons
 *
 * Maps LLM provider types and base URLs to their respective brand icons.
 * Used in AI Settings page and anywhere connection logos are needed.
 */

import claudeIcon from '@/assets/provider-icons/claude.svg'
import copilotIcon from '@/assets/provider-icons/copilot.svg'
import ollamaIcon from '@/assets/provider-icons/ollama.svg'
import openaiIcon from '@/assets/provider-icons/openai.svg'
import openrouterIcon from '@/assets/provider-icons/openrouter.svg'
import vercelIcon from '@/assets/provider-icons/vercel.svg'

import type { LlmProviderType } from '@craft-agent/shared/config/llm-connections'

/**
 * Icon URLs for each provider
 */
export const providerIcons = {
  anthropic: claudeIcon,
  openai: openaiIcon,
  copilot: copilotIcon,
  ollama: ollamaIcon,
  openrouter: openrouterIcon,
  vercel: vercelIcon,
} as const

export type ProviderIconKey = keyof typeof providerIcons

/** Human-readable provider names */
const providerDisplayNames: Record<string, string> = {
  anthropic: 'Anthropic',
  anthropic_compat: 'Anthropic',
  openai: 'OpenAI',
  openai_compat: 'OpenAI',
  copilot: 'GitHub Copilot',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  vercel: 'Vercel',
}

/** Get a human-readable provider name from provider type and optional base URL */
export function getProviderDisplayName(providerType: string, baseUrl?: string | null): string {
  // Try URL detection first for compat providers
  if (baseUrl) {
    const url = baseUrl.toLowerCase()
    if (url.includes('openrouter.ai')) return 'OpenRouter'
    if (url.includes('ollama')) return 'Ollama'
    if (url.includes('v0.dev') || url.includes('vercel')) return 'Vercel'
  }
  return providerDisplayNames[providerType] || providerType
}

/**
 * Detect provider from base URL
 */
function detectProviderFromUrl(baseUrl: string): ProviderIconKey | null {
  const url = baseUrl.toLowerCase()

  if (url.includes('openrouter.ai')) return 'openrouter'
  if (url.includes('ollama')) return 'ollama'
  if (url.includes('api.anthropic.com')) return 'anthropic'
  if (url.includes('api.openai.com')) return 'openai'
  if (url.includes('v0.dev') || url.includes('vercel')) return 'vercel'

  return null
}

/**
 * Get provider icon URL for a given provider type and optional base URL.
 * Base URL detection takes precedence for compatible providers (openai_compat, anthropic_compat).
 *
 * @param providerType - The LLM provider type
 * @param baseUrl - Optional custom base URL for detection
 * @returns Icon URL string or null if no matching icon
 */
export function getProviderIcon(
  providerType: LlmProviderType | string,
  baseUrl?: string | null
): string | null {
  // For compatible providers, try to detect from URL first
  if (baseUrl && (providerType === 'openai_compat' || providerType === 'anthropic_compat')) {
    const detectedProvider = detectProviderFromUrl(baseUrl)
    if (detectedProvider) {
      return providerIcons[detectedProvider]
    }
  }

  // Map provider type to icon
  switch (providerType) {
    case 'anthropic':
    case 'anthropic_compat':
      return providerIcons.anthropic
    case 'openai':
    case 'openai_compat':
      return providerIcons.openai
    case 'copilot':
      return providerIcons.copilot
    default:
      // Try URL detection as fallback
      if (baseUrl) {
        const detectedProvider = detectProviderFromUrl(baseUrl)
        if (detectedProvider) {
          return providerIcons[detectedProvider]
        }
      }
      return null
  }
}
