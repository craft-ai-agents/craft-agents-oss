/**
 * Environment Variable Backend
 *
 * Read-only fallback for local/dev credentials. Encrypted app storage keeps
 * priority; env vars only fill gaps so app source can stay key-free.
 */

import type { CredentialBackend } from './types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';

export class EnvironmentBackend implements CredentialBackend {
  readonly name = 'environment';
  readonly priority = 10;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    const names = getEnvironmentNamesForCredential(id);
    for (const name of names) {
      const value = process.env[name]?.trim();
      if (value) return { value };
    }
    return null;
  }

  async set(_id: CredentialId, _credential: StoredCredential): Promise<void> {
    throw new Error('Environment backend is read-only');
  }

  async delete(_id: CredentialId): Promise<boolean> {
    return false;
  }

  async list(_filter?: Partial<CredentialId>): Promise<CredentialId[]> {
    return [];
  }
}

function normalizeSlug(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return normalized || null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function providerAliases(slug: string): string[] {
  const lower = slug.toLowerCase();
  const aliases: string[] = [];

  if (lower.includes('openrouter')) aliases.push('OPENROUTER_API_KEY');
  if (lower.includes('anthropic') || lower.includes('claude')) aliases.push('ANTHROPIC_API_KEY');
  if (lower.includes('openai') || lower.includes('gpt')) aliases.push('OPENAI_API_KEY');
  if (lower.includes('deepseek')) aliases.push('DEEPSEEK_API_KEY');
  if (lower.includes('kimi')) aliases.push('KIMI_API_KEY');
  if (lower.includes('qwen')) aliases.push('QWEN_API_KEY');
  if (lower.includes('google') || lower.includes('gemini')) aliases.push('GOOGLE_API_KEY', 'GEMINI_API_KEY');

  return aliases;
}

function sourceAliases(slug: string, suffix: 'API_KEY' | 'BEARER_TOKEN' | 'BASIC_AUTH'): string[] {
  switch (slug) {
    case 'youtube-research':
      return suffix === 'API_KEY' ? ['YOUTUBE_API_KEY', 'YOUTUBE_RESEARCH_API_KEY'] : [];
    case 'elevenlabs':
      return suffix === 'API_KEY' ? ['ELEVENLABS_API_KEY'] : [];
    case 'inworld':
      return suffix === 'API_KEY' ? ['INWORLD_API_KEY'] : [];
    default:
      return [];
  }
}

function getEnvironmentNamesForCredential(id: CredentialId): string[] {
  if (id.type === 'anthropic_api_key') {
    return ['ANTHROPIC_API_KEY'];
  }

  if (id.type === 'llm_api_key') {
    const slug = normalizeSlug(id.connectionSlug);
    return unique([
      slug ? `RUNNER_LLM_${slug}_API_KEY` : null,
      slug ? `${slug}_API_KEY` : null,
      ...(id.connectionSlug ? providerAliases(id.connectionSlug) : []),
    ]);
  }

  if (id.type === 'source_apikey') {
    const slug = normalizeSlug(id.sourceId);
    return unique([
      slug ? `RUNNER_SOURCE_${slug}_API_KEY` : null,
      slug ? `${slug}_API_KEY` : null,
      ...(id.sourceId ? sourceAliases(id.sourceId, 'API_KEY') : []),
    ]);
  }

  if (id.type === 'source_bearer') {
    const slug = normalizeSlug(id.sourceId);
    return unique([
      slug ? `RUNNER_SOURCE_${slug}_BEARER_TOKEN` : null,
      slug ? `${slug}_BEARER_TOKEN` : null,
      ...(id.sourceId ? sourceAliases(id.sourceId, 'BEARER_TOKEN') : []),
    ]);
  }

  if (id.type === 'source_basic') {
    const slug = normalizeSlug(id.sourceId);
    return unique([
      slug ? `RUNNER_SOURCE_${slug}_BASIC_AUTH` : null,
      slug ? `${slug}_BASIC_AUTH` : null,
      ...(id.sourceId ? sourceAliases(id.sourceId, 'BASIC_AUTH') : []),
    ]);
  }

  if (id.type === 'messaging_bearer') {
    const slug = normalizeSlug(id.name);
    return unique([
      slug ? `RUNNER_MESSAGING_${slug}_TOKEN` : null,
      slug ? `${slug}_BOT_TOKEN` : null,
    ]);
  }

  return [];
}
