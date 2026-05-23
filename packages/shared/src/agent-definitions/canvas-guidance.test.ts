import { describe, expect, test } from 'bun:test';
import { buildCanvasGuidanceSection } from './canvas-guidance.ts';

describe('buildCanvasGuidanceSection', () => {
  test('renders base Canvas guidance for every agent', () => {
    const result = buildCanvasGuidanceSection({ metadata: {} });

    expect(result).toContain('Canvas guidance');
    expect(result).toContain('create or reuse a durable Output and pin/display it in Canvas');
    expect(result).not.toContain('Visual agent mode:');
  });

  test('adds proactive guidance for visual agents only', () => {
    const result = buildCanvasGuidanceSection({ metadata: { visualAgent: true } });

    expect(result).toContain('Visual agent mode:');
    expect(result).toContain('Proactively create durable Outputs');
    expect(result).toContain('make one focused fix');
  });
});
