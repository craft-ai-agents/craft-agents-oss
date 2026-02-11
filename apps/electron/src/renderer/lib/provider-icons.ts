/**
 * Provider icon and display name mapping for LLM connections.
 */

import claudeSvg from '@/assets/provider-icons/claude.svg'
import openaiSvg from '@/assets/provider-icons/openai.svg'
import ollamaSvg from '@/assets/provider-icons/ollama.svg'
import openrouterSvg from '@/assets/provider-icons/openrouter.svg'
import awsSvg from '@/assets/provider-icons/aws.svg'
import googleSvg from '@/assets/provider-icons/google.svg'

import type { LlmProviderType } from '../../shared/types'

/** Map of provider type → icon URL */
const providerIcons: Partial<Record<LlmProviderType, string>> = {
  anthropic: claudeSvg,
  anthropic_compat: claudeSvg,
  openai: openaiSvg,
  openai_compat: openaiSvg,
  bedrock: awsSvg,
  vertex: googleSvg,
}

/** Map of provider type → human-readable display name */
const providerDisplayNames: Record<LlmProviderType, string> = {
  anthropic: 'Anthropic',
  anthropic_compat: 'Anthropic Compatible',
  openai: 'OpenAI',
  openai_compat: 'OpenAI Compatible',
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex',
}

/**
 * Detect provider icon from base URL for compat providers.
 * Checks known provider domains (OpenRouter, Ollama, etc.)
 */
function detectIconFromBaseUrl(baseUrl?: string | null): string | undefined {
  if (!baseUrl) return undefined
  const lower = baseUrl.toLowerCase()
  if (lower.includes('openrouter.ai')) return openrouterSvg
  if (lower.includes('ollama') || lower.includes('localhost:11434') || lower.includes('127.0.0.1:11434')) return ollamaSvg
  return undefined
}

/**
 * Get the icon URL for a provider, with URL-based detection for compat providers.
 */
export function getProviderIcon(providerType: LlmProviderType, baseUrl?: string | null): string | undefined {
  // For compat providers, try URL-based detection first
  if (providerType === 'anthropic_compat' || providerType === 'openai_compat') {
    const urlIcon = detectIconFromBaseUrl(baseUrl)
    if (urlIcon) return urlIcon
  }
  return providerIcons[providerType]
}

/**
 * Get display name for a provider, with URL-based overrides for compat providers.
 */
export function getProviderDisplayName(providerType: LlmProviderType, baseUrl?: string | null): string {
  if (providerType === 'anthropic_compat' || providerType === 'openai_compat') {
    if (baseUrl) {
      const lower = baseUrl.toLowerCase()
      if (lower.includes('openrouter.ai')) return 'OpenRouter'
      if (lower.includes('ollama') || lower.includes('localhost:11434') || lower.includes('127.0.0.1:11434')) return 'Ollama'
    }
  }
  return providerDisplayNames[providerType]
}
