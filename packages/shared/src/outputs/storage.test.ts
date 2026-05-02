import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OutputManifest } from './types.ts';
import {
  assertOutputAssetPath,
  createOutputBundle,
  createOutputManifest,
  deleteOutput,
  getOutputDir,
  getOutputManifestFile,
  isOutputManifest,
  isSafeRelativeAssetPath,
  listOutputManifests,
  listOutputs,
  readOutputManifest,
  resolveOutputAssetPath,
  writeOutputManifest,
} from './index.ts';

const OUTPUT_OLD_ID = '11111111-1111-4111-8111-111111111111';
const OUTPUT_NEW_ID = '22222222-2222-4222-8222-222222222222';
const OUTPUT_OTHER_ID = '33333333-3333-4333-8333-333333333333';
const OUTPUT_OUTSIDE_ID = '44444444-4444-4444-8444-444444444444';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'craft-outputs-test-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function manifest(id: string, overrides: Partial<OutputManifest> = {}): OutputManifest {
  const base: OutputManifest = {
    schemaVersion: 1,
    id,
    workspaceId: 'workspace-1',
    title: `Output ${id.slice(0, 4)}`,
    slug: `output-${id.slice(0, 4)}`,
    kind: 'report',
    status: 'published',
    summary: 'A short summary.',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    origin: { source: 'workflow', workflowRunId: 'run-1', stepId: 'final', sessionId: 'session-1' },
    assets: [],
    receipts: [],
    links: [],
  };
  return { ...base, ...overrides };
}

describe('output manifest validation', () => {
  test('accepts a complete manifest with assets, receipts, links, and preview', () => {
    const full = manifest(OUTPUT_OLD_ID, {
      primary: {
        id: 'asset-1',
        label: 'Report',
        role: 'primary',
        path: 'report.md',
        mimeType: 'text/markdown',
      },
      assets: [
        {
          id: 'asset-1',
          label: 'Report',
          role: 'primary',
          path: 'report.md',
          mimeType: 'text/markdown',
        },
      ],
      receipts: [
        {
          id: 'receipt-1',
          provider: 'vercel',
          action: 'deploy',
          status: 'succeeded',
          occurredAt: '2026-05-01T10:01:00.000Z',
          url: 'https://example.com',
        },
      ],
      links: [{ id: 'link-1', label: 'Published', url: 'https://example.com', role: 'primary' }],
      preview: { mode: 'markdown', assetId: 'asset-1', inlineText: '# Report' },
      tags: ['weekly'],
    });

    expect(isOutputManifest(full, OUTPUT_OLD_ID)).toBe(true);
  });

  test('rejects malformed manifests before saving', () => {
    expect(isOutputManifest({ ...manifest(OUTPUT_OLD_ID), kind: 'nope' }, OUTPUT_OLD_ID)).toBe(false);
    expect(isOutputManifest({ ...manifest(OUTPUT_OLD_ID), id: OUTPUT_NEW_ID }, OUTPUT_OLD_ID)).toBe(false);
    expect(
      isOutputManifest(
        {
          ...manifest(OUTPUT_OLD_ID),
          assets: [{ id: 'asset-1', label: 'A', role: 'primary', path: 'a.md' }],
          preview: { mode: 'markdown', assetId: 'missing' },
        },
        OUTPUT_OLD_ID,
      ),
    ).toBe(false);
  });
});

describe('output storage', () => {
  test('writes, reads, and lists manifests newest-first', () => {
    const oldManifest = manifest(OUTPUT_OLD_ID, {
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    });
    const newManifest = manifest(OUTPUT_NEW_ID, {
      createdAt: '2026-05-01T10:05:00.000Z',
      updatedAt: '2026-05-01T10:05:00.000Z',
    });

    writeOutputManifest(workspace, oldManifest);
    writeOutputManifest(workspace, newManifest);

    expect(readOutputManifest(workspace, OUTPUT_OLD_ID)).toEqual(oldManifest);
    expect(readOutputManifest(workspace, OUTPUT_NEW_ID)).toEqual(newManifest);
    expect(listOutputManifests(workspace).map((output) => output.id)).toEqual([OUTPUT_NEW_ID, OUTPUT_OLD_ID]);
    expect(listOutputs(workspace).map((output) => output.id)).toEqual([OUTPUT_NEW_ID, OUTPUT_OLD_ID]);
  });

  test('creates manifests once and uses atomic output.json writes', () => {
    const output = manifest(OUTPUT_OLD_ID);

    createOutputManifest(workspace, output);

    expect(JSON.parse(readFileSync(getOutputManifestFile(workspace, OUTPUT_OLD_ID), 'utf-8'))).toEqual(output);
    expect(existsSync(`${getOutputManifestFile(workspace, OUTPUT_OLD_ID)}.tmp`)).toBe(false);
    expect(() => createOutputManifest(workspace, output)).toThrow(/already exists/);
  });

  test('skips malformed and mismatched manifest files when listing', () => {
    mkdirSync(getOutputDir(workspace, OUTPUT_OTHER_ID), { recursive: true });
    writeFileSync(getOutputManifestFile(workspace, OUTPUT_OTHER_ID), JSON.stringify({ id: OUTPUT_OTHER_ID }));

    mkdirSync(getOutputDir(workspace, OUTPUT_NEW_ID), { recursive: true });
    writeFileSync(getOutputManifestFile(workspace, OUTPUT_NEW_ID), JSON.stringify(manifest(OUTPUT_OLD_ID)));

    const good = manifest(OUTPUT_OLD_ID);
    writeOutputManifest(workspace, good);

    expect(readOutputManifest(workspace, OUTPUT_OTHER_ID)).toBeNull();
    expect(readOutputManifest(workspace, OUTPUT_NEW_ID)).toBeNull();
    expect(listOutputManifests(workspace)).toEqual([good]);
  });

  test('skips manually edited manifests with unsafe asset paths', () => {
    const unsafe = manifest(OUTPUT_OLD_ID, {
      assets: [{ id: 'bad', label: 'Bad', role: 'attachment', path: '../secret.txt' }],
    });
    mkdirSync(getOutputDir(workspace, OUTPUT_OLD_ID), { recursive: true });
    writeFileSync(getOutputManifestFile(workspace, OUTPUT_OLD_ID), JSON.stringify(unsafe));

    expect(readOutputManifest(workspace, OUTPUT_OLD_ID)).toBeNull();
    expect(listOutputManifests(workspace)).toEqual([]);
  });

  test('rejects traversal output ids before reading or deleting', () => {
    const outsideDir = join(workspace, '..', OUTPUT_OUTSIDE_ID);
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'output.json'), 'outside');

    expect(readOutputManifest(workspace, `../${OUTPUT_OUTSIDE_ID}`)).toBeNull();
    expect(readOutputManifest(workspace, `${OUTPUT_OUTSIDE_ID}/..`)).toBeNull();
    expect(readOutputManifest(workspace, 'not-an-output-id')).toBeNull();
    expect(() => getOutputDir(workspace, `../${OUTPUT_OUTSIDE_ID}`)).toThrow(/Invalid output id/);

    expect(deleteOutput(workspace, `../${OUTPUT_OUTSIDE_ID}`)).toBe(false);
    expect(existsSync(join(outsideDir, 'output.json'))).toBe(true);
  });

  test('rejects asset path traversal but tolerates missing in-bundle assets', () => {
    const output = manifest(OUTPUT_OLD_ID, {
      primary: { id: 'missing', label: 'Missing', role: 'primary', path: 'attachments/missing.png' },
      assets: [{ id: 'missing', label: 'Missing', role: 'primary', path: 'attachments/missing.png' }],
      preview: { mode: 'image', assetId: 'missing' },
    });

    writeOutputManifest(workspace, output);

    const resolvedMissing = resolveOutputAssetPath(workspace, OUTPUT_OLD_ID, 'attachments/missing.png');
    expect(resolvedMissing).toBe(resolve(getOutputDir(workspace, OUTPUT_OLD_ID), 'attachments/missing.png'));
    expect(existsSync(resolvedMissing!)).toBe(false);
    expect(readOutputManifest(workspace, OUTPUT_OLD_ID)).toEqual(output);

    expect(isSafeRelativeAssetPath('../secret.txt')).toBe(false);
    expect(resolveOutputAssetPath(workspace, OUTPUT_OLD_ID, '../secret.txt')).toBeNull();
    expect(resolveOutputAssetPath(workspace, OUTPUT_OLD_ID, 'attachments/../../secret.txt')).toBeNull();
    expect(() => assertOutputAssetPath(workspace, OUTPUT_OLD_ID, '../secret.txt')).toThrow(/Invalid output asset path/);
    expect(() =>
      writeOutputManifest(
        workspace,
        manifest(OUTPUT_NEW_ID, {
          assets: [{ id: 'bad', label: 'Bad', role: 'attachment', path: '../secret.txt' }],
        }),
      ),
    ).toThrow(/Invalid output asset path/);
  });

  test('allows absolute asset paths only inside the workspace root', () => {
    const inside = join(workspace, 'source.txt');
    const outside = join(tmpdir(), `outside-${Date.now()}.txt`);
    writeFileSync(inside, 'inside');
    writeFileSync(outside, 'outside');

    try {
      expect(resolveOutputAssetPath(workspace, OUTPUT_OLD_ID, inside)).toBe(inside);
      expect(resolveOutputAssetPath(workspace, OUTPUT_OLD_ID, outside)).toBeNull();
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test('createOutputBundle writes content assets under the UUID output directory', () => {
    const output = createOutputBundle(workspace, {
      id: OUTPUT_OLD_ID,
      workspaceId: 'workspace-1',
      title: 'Research Brief',
      kind: 'report',
      origin: { source: 'manual' },
      content: '# Research\n\nFindings.',
      contentMimeType: 'text/markdown',
      createdAt: '2026-05-01T10:00:00.000Z',
    });

    expect(output.slug).toBe('research-brief');
    expect(output.primary?.path).toBe('content.md');
    expect(output.preview?.mode).toBe('markdown');
    expect(existsSync(join(getOutputDir(workspace, OUTPUT_OLD_ID), 'content.md'))).toBe(true);
    expect(readOutputManifest(workspace, OUTPUT_OLD_ID)).toEqual(output);
  });
});
