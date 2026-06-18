/**
 * Tests for buildToolDescription — verifies that we don't inline guide.md
 * content into the tool description (regression for #683).
 *
 * Background: prior to the fix, the entire `guide.md` was concatenated into
 * the tool description and sent on every LLM request, both wasting tokens
 * and triggering bare-400 rejections from OpenAI-compat relays when the
 * guide was large.
 */

import { describe, test, expect } from 'bun:test';
import { buildToolDescription } from '../api-tools.ts';
import type { ApiConfig } from '../types.ts';

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    name: 'example-source',
    baseUrl: 'https://api.example.com',
    auth: { type: 'none' },
    ...overrides,
  };
}

describe('buildToolDescription', () => {
  test('does NOT contain documentation field content', () => {
    const secret = 'GUIDE_BLOB_SHOULD_NOT_LEAK_INTO_TOOL_DESCRIPTION';
    const desc = buildToolDescription(
      baseConfig({ documentation: secret + '\n'.repeat(100) + secret })
    );
    expect(desc).not.toContain(secret);
  });

  test('is bounded for a typical config (under 2 KB)', () => {
    // Even with a docsUrl and a long-ish slug, the description should stay
    // small. The whole point of the change is that this is a stub, not a dump.
    const desc = buildToolDescription(
      baseConfig({
        name: 'a-fairly-long-source-slug-with-many-words',
        baseUrl: 'https://api.long.example.com/v1',
        docsUrl: 'https://docs.long.example.com/reference',
      })
    );
    expect(desc.length).toBeLessThan(2_000);
  });

  test('points the model at sources/{slug}/guide.md', () => {
    // The description front-runs the prerequisite-manager block by telling the
    // model where to read. The path string must include the slug verbatim so
    // the model can resolve it without guessing.
    const desc = buildToolDescription(baseConfig({ name: 'my-special-slug' }));
    expect(desc).toContain('sources/my-special-slug/guide.md');
  });

  test('preserves docsUrl when present', () => {
    const url = 'https://api-docs.example.com/openapi.yaml';
    const desc = buildToolDescription(baseConfig({ docsUrl: url }));
    expect(desc).toContain(url);
  });

  test('omits docsUrl when not present (no dangling label)', () => {
    const desc = buildToolDescription(baseConfig());
    expect(desc).not.toContain('Official docs');
  });

  test('survives missing documentation field (no crash, no warning leak)', () => {
    // Old code branched on !config.documentation to print a "cached with an
    // older format" warning. The new stub doesn't read documentation at all,
    // so missing-documentation must not change the output.
    const a = buildToolDescription(baseConfig({ documentation: undefined }));
    const b = buildToolDescription(baseConfig({ documentation: 'whatever' }));
    expect(a).toBe(b);
    expect(a).not.toContain('older format');
  });
});
