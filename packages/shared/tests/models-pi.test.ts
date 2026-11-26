import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';
import { fromPiProviderId, regionalProviderBaseUrl, toPiProviderId } from '../src/config/pi-provider-ids.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('keeps Claude Opus 4.6 models in Anthropic catalogs', () => {
    // TODO(opus-4.6-sunset): flip these back to exclusion when 4.6 is deprecated.
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-4-6');

    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds.some(id => id.includes('claude-opus-4-6'))).toBe(true);
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models from the Pi SDK catalog', () => {
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    // Pi 0.86.0 replaced the retired `deepseek-v4-flash` alias with `deepseek-flash`.
    expect(ids).toContain('pi/deepseek-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');
    expect(ids).not.toContain('pi/deepseek-v4-flash');
  });

  it('includes Moonshot AI in the Pi API key provider list with human-readable labels', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'moonshotai' && provider.label === 'Moonshot AI')).toBe(true);
    expect(providers.some(provider => provider.key === 'moonshotai-cn' && provider.label === 'Moonshot AI (CN)')).toBe(true);
  });

  it('returns Claude Opus 5 from the Pi SDK catalog for Anthropic and Bedrock', () => {
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-5');

    // Bedrock exposes Opus 5 only as regional inference profiles (us./eu./global.).
    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds).toContain('pi/us.anthropic.claude-opus-5');
  });

  it('returns Claude Opus 5.5 from the Pi SDK catalog for Anthropic and Bedrock', () => {
    // Added in Pi SDK 0.87.1 (adaptive thinking, 1M context). Bedrock exposes it
    // only as regional inference profiles (us./eu./global./au./jp.).
    expect(getPiModelsForAuthProvider('anthropic').map(m => m.id)).toContain('pi/claude-opus-5-5');
    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds).toContain('pi/us.anthropic.claude-opus-5-5');
    expect(bedrockIds).toContain('pi/eu.anthropic.claude-opus-5-5');
    expect(bedrockIds).toContain('pi/global.anthropic.claude-opus-5-5');
  });

  it('returns GPT-6 Astra from the Pi SDK catalog for OpenAI API keys and ChatGPT accounts', () => {
    // Added in Pi SDK 0.85.1 for `openai` and `openai-codex` only.
    expect(getPiModelsForAuthProvider('openai').map(m => m.id)).toContain('pi/gpt-6-astra');
    expect(getPiModelsForAuthProvider('openai-codex').map(m => m.id)).toContain('pi/gpt-6-astra');
  });

  it('returns Kimi K3 from the Pi SDK catalog for both Moonshot providers', () => {
    const ids = getPiModelsForAuthProvider('moonshotai').map(m => m.id);
    expect(ids).toContain('pi/kimi-k3');
    expect(ids).toContain('pi/kimi-k2.6');

    const cnIds = getPiModelsForAuthProvider('moonshotai-cn').map(m => m.id);
    expect(cnIds).toContain('pi/kimi-k3');
  });

  it("keeps Craft's Azure provider id across the Pi 1.0.3 rename (azure-openai-responses -> azure)", () => {
    expect(toPiProviderId('azure-openai-responses')).toBe('azure');
    expect(fromPiProviderId('azure')).toBe('azure-openai-responses');
    expect(toPiProviderId('openai')).toBe('openai');
    expect(fromPiProviderId('openai')).toBe('openai');

    // Stored Azure connections keep resolving their catalog…
    expect(getPiModelsForAuthProvider('azure-openai-responses').length).toBeGreaterThan(0);
    // …and the API-key provider list keeps Craft's key and label.
    const providers = getPiApiKeyProviders();
    expect(providers.some(p => p.key === 'azure-openai-responses' && p.label === 'Azure OpenAI')).toBe(true);
    expect(providers.some(p => p.key === 'azure')).toBe(false);
  });

  it('maps the OpenAI EU/US presets to OpenAI at their regional API, one way only', () => {
    expect(toPiProviderId('openai-eu')).toBe('openai');
    expect(toPiProviderId('openai-us')).toBe('openai');
    expect(fromPiProviderId('openai')).toBe('openai');
    expect(regionalProviderBaseUrl('openai-eu')).toBe('https://eu.api.openai.com/v1');
    expect(regionalProviderBaseUrl('openai-us')).toBe('https://us.api.openai.com/v1');
    expect(regionalProviderBaseUrl('openai')).toBeUndefined();
    expect(regionalProviderBaseUrl(undefined)).toBeUndefined();

    // Stored EU/US connections get OpenAI's catalog.
    const openAiIds = getPiModelsForAuthProvider('openai').map(m => m.id);
    expect(openAiIds.length).toBeGreaterThan(0);
    expect(getPiModelsForAuthProvider('openai-eu').map(m => m.id)).toEqual(openAiIds);
    expect(getPiModelsForAuthProvider('openai-us').map(m => m.id)).toEqual(openAiIds);
  });

  it('offers Cloudflare AI Gateway in the API key provider list with its Claude and GPT catalog', () => {
    expect(getPiApiKeyProviders().some(p => p.key === 'cloudflare-ai-gateway' && p.label === 'Cloudflare AI Gateway')).toBe(true);
    const ids = getPiModelsForAuthProvider('cloudflare-ai-gateway').map(m => m.id);
    // Pi 1.1.0 switched the gateway's Claude ids from dotted (claude-opus-4.8) to dashed.
    expect(ids).toContain('pi/claude-opus-5-5');
    expect(ids).toContain('pi/claude-sonnet-5-5');
    expect(ids).toContain('pi/gpt-6-luna');
  });
});
