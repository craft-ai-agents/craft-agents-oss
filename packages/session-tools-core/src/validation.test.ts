import { describe, expect, it } from 'bun:test';
import { normalizeMermaidSource, validateMermaidSyntax } from './validation.ts';

describe('Mermaid validation helpers', () => {
  it('normalizes YAML frontmatter before diagram syntax', () => {
    expect(normalizeMermaidSource('---\ntitle: Demo\n---\ngraph LR\nA-->B')).toBe('graph LR\nA-->B');
  });

  it('accepts xychart-beta as a Mermaid diagram type', () => {
    expect(validateMermaidSyntax('xychart-beta\n  x-axis [Jan, Feb]\n  bar [10, 20]').valid).toBe(true);
  });

  it('accepts YAML frontmatter before a supported diagram type', () => {
    expect(validateMermaidSyntax('---\ntitle: Demo\n---\nsequenceDiagram\nA->>B: hello').valid).toBe(true);
  });

  it('still rejects unknown diagram types', () => {
    const result = validateMermaidSyntax('unknownDiagram\nA-->B');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('Unknown diagram type');
  });
});
