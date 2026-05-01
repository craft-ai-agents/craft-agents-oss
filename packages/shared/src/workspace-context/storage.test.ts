import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteContextDoc,
  loadActiveContextDocsForAgent,
  loadAllContextDocs,
  loadContextDoc,
  parseContextFile,
  serializeContextDoc,
  upsertContextDoc,
} from './storage.ts';
import type { ContextDocMetadata } from './types.ts';
import { CONCIERGE_SLUG } from '../agent-definitions/types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'wctx-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseContextFile
// ---------------------------------------------------------------------------

describe('parseContextFile', () => {
  test('parses minimal frontmatter and defaults to broadcast + enabled', () => {
    const got = parseContextFile('---\nname: Vision\n---\nBody.');
    expect(got).not.toBeNull();
    expect(got!.metadata.name).toBe('Vision');
    expect(got!.metadata.routing).toEqual({ mode: 'broadcast' });
    expect(got!.metadata.enabled).toBe(true);
    expect(got!.body).toBe('Body.');
  });

  test('returns null when name is missing', () => {
    expect(parseContextFile('---\ndescription: x\n---\n')).toBeNull();
  });

  test('agents: "all" reads as broadcast', () => {
    const got = parseContextFile('---\nname: A\nagents: all\n---\n');
    expect(got!.metadata.routing).toEqual({ mode: 'broadcast' });
  });

  test('agents as list narrows routing', () => {
    const got = parseContextFile('---\nname: A\nagents:\n  - writer\n  - critic\n---\n');
    expect(got!.metadata.routing).toEqual({ mode: 'targeted', agents: ['writer', 'critic'] });
  });

  test('agents as comma-separated string narrows routing', () => {
    const got = parseContextFile('---\nname: A\nagents: writer, critic\n---\n');
    expect(got!.metadata.routing).toEqual({ mode: 'targeted', agents: ['writer', 'critic'] });
  });

  test('empty list falls back to broadcast', () => {
    const got = parseContextFile('---\nname: A\nagents: []\n---\n');
    expect(got!.metadata.routing).toEqual({ mode: 'broadcast' });
  });

  test('invalid slugs in agents list are dropped with a warning', () => {
    const got = parseContextFile('---\nname: A\nagents:\n  - writer\n  - "not a slug"\n---\n');
    expect(got!.metadata.routing).toEqual({ mode: 'targeted', agents: ['writer'] });
    expect(got!.warnings.length).toBeGreaterThan(0);
  });

  test('enabled: false is honored', () => {
    const got = parseContextFile('---\nname: A\nenabled: false\n---\n');
    expect(got!.metadata.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serialize round-trip
// ---------------------------------------------------------------------------

describe('serializeContextDoc', () => {
  test('round-trips a broadcast doc', () => {
    const meta: ContextDocMetadata = {
      name: 'Vision',
      description: 'What we are building',
      routing: { mode: 'broadcast' },
      enabled: true,
    };
    const text = serializeContextDoc(meta, 'Body content here.');
    const parsed = parseContextFile(text);
    expect(parsed!.metadata).toEqual(meta);
    expect(parsed!.body).toBe('Body content here.');
  });

  test('round-trips a targeted, disabled doc', () => {
    const meta: ContextDocMetadata = {
      name: 'Voice',
      routing: { mode: 'targeted', agents: ['writer'] },
      enabled: false,
    };
    const text = serializeContextDoc(meta, 'Tone: direct.');
    const parsed = parseContextFile(text);
    expect(parsed!.metadata.routing).toEqual({ mode: 'targeted', agents: ['writer'] });
    expect(parsed!.metadata.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('upsert / load / delete', () => {
  test('upsert writes a CONTEXT.md and load returns it', () => {
    upsertContextDoc(workspace, {
      slug: 'vision',
      metadata: { name: 'Vision', routing: { mode: 'broadcast' }, enabled: true },
      body: 'Hello.',
    });
    const got = loadContextDoc(workspace, 'vision');
    expect(got).not.toBeNull();
    expect(got!.metadata.name).toBe('Vision');
    expect(got!.body).toBe('Hello.');
  });

  test('upsert rejects invalid slugs', () => {
    expect(() =>
      upsertContextDoc(workspace, {
        slug: 'Bad Slug!',
        metadata: { name: 'X', routing: { mode: 'broadcast' }, enabled: true },
        body: '',
      }),
    ).toThrow();
  });

  test('upsert rejects empty name', () => {
    expect(() =>
      upsertContextDoc(workspace, {
        slug: 'ok',
        metadata: { name: '   ', routing: { mode: 'broadcast' }, enabled: true },
        body: '',
      }),
    ).toThrow();
  });

  test('loadAll returns all parseable docs sorted by slug', () => {
    upsertContextDoc(workspace, {
      slug: 'b-doc',
      metadata: { name: 'B', routing: { mode: 'broadcast' }, enabled: true },
      body: '',
    });
    upsertContextDoc(workspace, {
      slug: 'a-doc',
      metadata: { name: 'A', routing: { mode: 'broadcast' }, enabled: true },
      body: '',
    });
    const all = loadAllContextDocs(workspace);
    expect(all.map((d) => d.slug)).toEqual(['a-doc', 'b-doc']);
  });

  test('loadAll skips malformed and non-slug directories', () => {
    const ctxDir = join(workspace, 'context');
    mkdirSync(join(ctxDir, 'good-doc'), { recursive: true });
    writeFileSync(join(ctxDir, 'good-doc', 'CONTEXT.md'), '---\nname: Good\n---\nBody');
    mkdirSync(join(ctxDir, 'NoUpper'), { recursive: true });
    writeFileSync(join(ctxDir, 'NoUpper', 'CONTEXT.md'), '---\nname: X\n---\n');
    mkdirSync(join(ctxDir, 'broken'), { recursive: true });
    writeFileSync(join(ctxDir, 'broken', 'CONTEXT.md'), 'no frontmatter at all');

    const all = loadAllContextDocs(workspace);
    expect(all.map((d) => d.slug)).toEqual(['good-doc']);
  });

  test('delete removes the doc', () => {
    upsertContextDoc(workspace, {
      slug: 'gone',
      metadata: { name: 'Gone', routing: { mode: 'broadcast' }, enabled: true },
      body: '',
    });
    expect(deleteContextDoc(workspace, 'gone')).toBe(true);
    expect(loadContextDoc(workspace, 'gone')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Routing — the load-bearing rule
// ---------------------------------------------------------------------------

describe('loadActiveContextDocsForAgent', () => {
  beforeEach(() => {
    upsertContextDoc(workspace, {
      slug: 'broadcast-doc',
      metadata: { name: 'Broadcast', routing: { mode: 'broadcast' }, enabled: true },
      body: 'b',
    });
    upsertContextDoc(workspace, {
      slug: 'writer-only',
      metadata: { name: 'Writer Only', routing: { mode: 'targeted', agents: ['writer'] }, enabled: true },
      body: 'w',
    });
    upsertContextDoc(workspace, {
      slug: 'disabled-doc',
      metadata: { name: 'Disabled', routing: { mode: 'broadcast' }, enabled: false },
      body: 'd',
    });
  });

  test('a regular agent gets broadcast docs', () => {
    const got = loadActiveContextDocsForAgent(workspace, 'researcher');
    expect(got.map((d) => d.slug)).toEqual(['broadcast-doc']);
  });

  test('a targeted agent gets broadcast + its own', () => {
    const got = loadActiveContextDocsForAgent(workspace, 'writer');
    expect(got.map((d) => d.slug).sort()).toEqual(['broadcast-doc', 'writer-only']);
  });

  test('null agentSlug (ad-hoc) gets only broadcast', () => {
    const got = loadActiveContextDocsForAgent(workspace, null);
    expect(got.map((d) => d.slug)).toEqual(['broadcast-doc']);
  });

  test('Concierge gets EVERY enabled doc regardless of routing', () => {
    const got = loadActiveContextDocsForAgent(workspace, CONCIERGE_SLUG);
    expect(got.map((d) => d.slug).sort()).toEqual(['broadcast-doc', 'writer-only']);
  });

  test('Concierge override is normalized at the RPC boundary', () => {
    const got = loadActiveContextDocsForAgent(workspace, ` ${CONCIERGE_SLUG.toUpperCase()} `);
    expect(got.map((d) => d.slug).sort()).toEqual(['broadcast-doc', 'writer-only']);
  });

  test('disabled docs are never delivered, even to Concierge', () => {
    const got = loadActiveContextDocsForAgent(workspace, CONCIERGE_SLUG);
    expect(got.find((d) => d.slug === 'disabled-doc')).toBeUndefined();
  });
});
