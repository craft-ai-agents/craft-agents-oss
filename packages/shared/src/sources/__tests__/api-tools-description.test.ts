import { describe, expect, it } from 'bun:test';
import { buildToolDescription } from '../api-tools.ts';

describe('buildToolDescription', () => {
  it('keeps guide markdown out of the API tool description', () => {
    const description = buildToolDescription({
      name: 'big-api',
      baseUrl: 'https://api.example.test',
      documentation: 'THIS SHOULD NOT BE INLINED '.repeat(200),
      auth: { type: 'bearer' },
    });

    expect(description).toContain('sources/big-api/guide.md');
    expect(description).not.toContain('THIS SHOULD NOT BE INLINED');
    expect(description.length).toBeLessThan(1000);
  });
});
