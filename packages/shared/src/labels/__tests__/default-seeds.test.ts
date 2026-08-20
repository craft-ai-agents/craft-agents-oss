import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getDefaultLabelConfig,
  loadLabelConfig,
  saveLabelConfig,
  ensureStockDefaultLabels,
} from '../storage.ts';
import { flattenLabels } from '../tree.ts';

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'labels-seeds-test-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('getDefaultLabelConfig P2 groups', () => {
  it('includes marketing and product groups with expected children', () => {
    const config = getDefaultLabelConfig();
    const ids = flattenLabels(config.labels).map((l) => l.id);
    expect(ids).toContain('marketing');
    expect(ids).toContain('sales');
    expect(ids).toContain('new-contracts');
    expect(ids).toContain('outreach');
    expect(ids).toContain('responses');
    expect(ids).toContain('product');
    expect(ids).toContain('discovery');
    expect(ids).toContain('specs');
    expect(ids).toContain('launch');
    expect(ids).toContain('feedback');
    // Keep legacy groups
    expect(ids).toContain('development');
    expect(ids).toContain('content');
  });
});

describe('ensureStockDefaultLabels migrate-in-place', () => {
  it('inserts missing marketing/product into older workspace configs', () => {
    // Simulate pre-P2 config (dev+content only)
    const old = {
      version: 1 as const,
      labels: [
        {
          id: 'development',
          name: 'Development',
          color: { light: '#3B82F6', dark: '#60A5FA' },
          children: [{ id: 'code', name: 'Code', color: { light: '#4F46E5', dark: '#818CF8' } }],
        },
        {
          id: 'content',
          name: 'Content',
          color: { light: '#8B5CF6', dark: '#A78BFA' },
        },
        { id: 'priority', name: 'Priority', color: { light: '#F59E0B', dark: '#FBBF24' }, valueType: 'number' as const },
      ],
    };
    saveLabelConfig(workspaceRoot, old);

    const loaded = loadLabelConfig(workspaceRoot);
    const ids = flattenLabels(loaded.labels).map((l) => l.id);
    expect(ids).toContain('marketing');
    expect(ids).toContain('sales');
    expect(ids).toContain('product');
    expect(ids).toContain('discovery');
    // Did not clobber existing
    expect(loaded.labels.find((l) => l.id === 'development')?.children?.map((c) => c.id)).toContain('code');
  });

  it('is idempotent and does not overwrite user renames', () => {
    const config = getDefaultLabelConfig();
    const marketing = config.labels.find((l) => l.id === 'marketing')!;
    marketing.name = 'My Marketing';
    saveLabelConfig(workspaceRoot, config);

    const again = loadLabelConfig(workspaceRoot);
    expect(again.labels.find((l) => l.id === 'marketing')?.name).toBe('My Marketing');
    expect(ensureStockDefaultLabels(again)).toBe(false);
  });

  it('fills missing child under existing parent without duplicating id elsewhere', () => {
    const config = getDefaultLabelConfig();
    // Remove sales child
    const marketing = config.labels.find((l) => l.id === 'marketing')!;
    marketing.children = marketing.children!.filter((c) => c.id !== 'sales');
    saveLabelConfig(workspaceRoot, config);

    const loaded = loadLabelConfig(workspaceRoot);
    const m = loaded.labels.find((l) => l.id === 'marketing')!;
    expect(m.children!.some((c) => c.id === 'sales')).toBe(true);
  });
});
