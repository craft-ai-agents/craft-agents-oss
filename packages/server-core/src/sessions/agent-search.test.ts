import { describe, expect, test } from 'bun:test';
import { agentMatchesSearch } from './agent-search.ts';

describe('agentMatchesSearch', () => {
  const gaygent = {
    slug: 'gaygent-master',
    name: 'Gaygent Master',
    description: 'Brand strategy, copy, launches, design, positioning, and market narrative.',
    inputs: 'Brand ideas, landing pages, copy, product concepts, launch plans.',
    outputs: 'Critique, rewritten hooks, copy, positioning, and final recommended direction.',
    tags: ['brand-strategy', 'copywriting', 'critique', 'launch'],
  };

  test('matches long natural-language searches by meaningful tokens', () => {
    expect(agentMatchesSearch(gaygent, 'brand positioning marketing copy writer specialist')).toBe(true);
  });

  test('keeps exact phrase matching for simple searches', () => {
    expect(agentMatchesSearch(gaygent, 'market narrative')).toBe(true);
  });

  test('does not match unrelated searches', () => {
    expect(agentMatchesSearch(gaygent, 'shopify inventory orders')).toBe(false);
  });
});
