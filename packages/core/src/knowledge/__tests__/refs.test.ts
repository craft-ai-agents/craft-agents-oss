import { describe, expect, test } from 'bun:test';

import {
  canonicalKnowledgeRef,
  formatKnowledgeDisplay,
  formatKnowledgeMention,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_MENTION_PATTERN,
  parseCraftRef,
  parseKnowledgeMentions,
  parseKnowledgeRef,
  parseSiyuanDeepLink,
  serializeCraftRef,
  serializeKnowledgeRef,
  siyuanDeepLink,
  toProviderForm,
  type KnowledgeRef,
} from '../refs.ts';

describe('serialize/parse KnowledgeRef round-trip', () => {
  test('canonical form serializes as siyuan/<kind>/<id>', () => {
    expect(serializeKnowledgeRef({ scheme: 'siyuan', kind: 'block', id: '20240101120000-abcde' })).toBe(
      'siyuan/block/20240101120000-abcde',
    );
  });

  test('serialize → parse round-trips for every knowledge kind', () => {
    for (const kind of KNOWLEDGE_KINDS) {
      const ref: KnowledgeRef = { scheme: 'siyuan', kind, id: `id-${kind}` };
      expect(parseKnowledgeRef(serializeKnowledgeRef(ref))).toEqual(ref);
    }
  });

  test('custom provider round-trips through the provider segment', () => {
    const ref: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'd1', provider: 'memory' };
    expect(serializeKnowledgeRef(ref)).toBe('memory/document/d1');
    expect(parseKnowledgeRef('memory/document/d1')).toEqual(ref);
  });

  test('compact form resolves to the default provider siyuan', () => {
    expect(parseKnowledgeRef('block/xyz')).toEqual({ scheme: 'siyuan', kind: 'block', id: 'xyz' });
  });

  test('ids may contain slashes', () => {
    expect(parseKnowledgeRef('siyuan/document/a/b')).toEqual({ scheme: 'siyuan', kind: 'document', id: 'a/b' });
  });

  test('invalid shapes return null instead of throwing', () => {
    expect(parseKnowledgeRef('')).toBeNull();
    expect(parseKnowledgeRef('block')).toBeNull();
    expect(parseKnowledgeRef('siyuan/')).toBeNull();
    expect(parseKnowledgeRef('siyuan/notkind/x')).toBeNull();
    expect(parseKnowledgeRef('BLOCK/x')).toBeNull();
  });
});

describe('serialize/parse CraftRef round-trip', () => {
  test('craft/<kind>/<id> round-trips', () => {
    for (const kind of ['session', 'run', 'skill', 'automation'] as const) {
      const ref = { scheme: 'craft' as const, kind, id: `id-${kind}` };
      expect(serializeCraftRef(ref)).toBe(`craft/${kind}/id-${kind}`);
      expect(parseCraftRef(serializeCraftRef(ref))).toEqual(ref);
    }
  });

  test('invalid craft refs return null', () => {
    expect(parseCraftRef('craft/unknown/x')).toBeNull();
    expect(parseCraftRef('craft/session')).toBeNull();
    expect(parseCraftRef('siyuan/session/x')).toBeNull();
  });
});

describe('KNOWLEDGE_MENTION_PATTERN and mention helpers', () => {
  test('regex matches full and compact tokens in message text', () => {
    const matches = 'see [knowledge:siyuan/block/20240101120000-abcde] and [knowledge:block/plain]'.match(
      KNOWLEDGE_MENTION_PATTERN,
    );
    expect(matches).toEqual(['[knowledge:siyuan/block/20240101120000-abcde]', '[knowledge:block/plain]']);
  });

  test('parseKnowledgeMentions extracts refs in order', () => {
    const refs = parseKnowledgeMentions(
      'read [knowledge:siyuan/block/b1] then [knowledge:document/d1] and [knowledge:memory/database/db1]',
    );
    expect(refs).toEqual([
      { scheme: 'siyuan', kind: 'block', id: 'b1' },
      { scheme: 'siyuan', kind: 'document', id: 'd1' },
      { scheme: 'siyuan', kind: 'database', id: 'db1', provider: 'memory' },
    ]);
  });

  test('compact mention serializes back under the default provider', () => {
    const [ref] = parseKnowledgeMentions('[knowledge:block/xyz]');
    expect(ref).toBeDefined();
    expect(ref?.provider).toBeUndefined();
    expect(serializeKnowledgeRef(ref!)).toBe('siyuan/block/xyz');
  });

  test('non-knowledge tokens and plain text yield no refs', () => {
    expect(parseKnowledgeMentions('a [skill:review] and [source:github] badge')).toEqual([]);
  });

  test('formatKnowledgeMention produces parseable tokens (full + compact)', () => {
    const ref: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'b1' };
    expect(formatKnowledgeMention(ref)).toBe('[knowledge:siyuan/block/b1]');
    expect(formatKnowledgeMention(ref, { compact: true })).toBe('[knowledge:block/b1]');
    expect(parseKnowledgeMentions(formatKnowledgeMention(ref))).toEqual([ref]);
    expect(parseKnowledgeMentions(formatKnowledgeMention(ref, { compact: true }))).toEqual([ref]);
  });

  test('display form is @-prefixed serialization', () => {
    expect(formatKnowledgeDisplay({ scheme: 'siyuan', kind: 'document', id: 'doc-1' })).toBe('@siyuan/document/doc-1');
  });
});

describe('siyuan:// deep links', () => {
  test('document/block refs emit the native siyuan://blocks/<id> grammar', () => {
    // parseSiYuanUriInfo (app/src/util/pathName.ts @ eef1056838) resolves ONLY the blocks
    // hostname; a document opens natively by its root-block id under the same grammar.
    expect(siyuanDeepLink({ scheme: 'siyuan', kind: 'document', id: '20240101120000-abcde' })).toBe(
      'siyuan://blocks/20240101120000-abcde',
    );
    expect(siyuanDeepLink({ scheme: 'siyuan', kind: 'block', id: '20240101120000-fghij' })).toBe(
      'siyuan://blocks/20240101120000-fghij',
    );
    // Native-open-less kinds keep the legacy kind segment (in-app route consumers only).
    expect(siyuanDeepLink({ scheme: 'siyuan', kind: 'notebook', id: 'nb-1' })).toBe('siyuan://notebook/nb-1');
  });

  test('block refs round-trip through the native blocks grammar', () => {
    const blockRef = { scheme: 'siyuan', kind: 'block', id: 'blk-1' } as const;
    expect(parseSiyuanDeepLink(siyuanDeepLink(blockRef))).toEqual(blockRef);
    // A document id under blocks/ parses as a block — the grammar itself cannot tell a
    // document from its root block (upstream resolves the doc at open time).
    expect(parseSiyuanDeepLink(siyuanDeepLink({ scheme: 'siyuan', kind: 'document', id: 'doc-1' }))).toEqual({
      scheme: 'siyuan',
      kind: 'block',
      id: 'doc-1',
    });
  });

  test('parse keeps legacy document/block hostnames resolvable', () => {
    expect(parseSiyuanDeepLink('siyuan://document/doc-1')).toEqual({ scheme: 'siyuan', kind: 'document', id: 'doc-1' });
    expect(parseSiyuanDeepLink('siyuan://block/blk-1')).toEqual({ scheme: 'siyuan', kind: 'block', id: 'blk-1' });
    expect(parseSiyuanDeepLink('siyuan://blocks/')).toBeNull();
    expect(parseSiyuanDeepLink('https://siyuan.example/doc-1')).toBeNull();
  });
});

describe('canonicalKnowledgeRef / toProviderForm', () => {
  test('provider form with default provider collapses to canonical without provider', () => {
    expect(canonicalKnowledgeRef({ provider: 'siyuan', kind: 'document', id: 'd1' })).toEqual({
      scheme: 'siyuan',
      kind: 'document',
      id: 'd1',
    });
  });

  test('provider form with a non-default provider keeps it', () => {
    expect(canonicalKnowledgeRef({ provider: 'obsidian', kind: 'database', id: 'db1' })).toEqual({
      scheme: 'siyuan',
      kind: 'database',
      id: 'db1',
      provider: 'obsidian',
    });
  });

  test('canonical input passes through', () => {
    const ref: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'b1', connectionId: 'c1' };
    expect(canonicalKnowledgeRef(ref)).toBe(ref);
  });

  test('toProviderForm maps absent provider to siyuan and keeps explicit providers', () => {
    expect(toProviderForm({ scheme: 'siyuan', kind: 'block', id: 'b1' })).toEqual({
      provider: 'siyuan',
      kind: 'block',
      id: 'b1',
    });
    expect(toProviderForm({ scheme: 'siyuan', kind: 'block', id: 'b1', provider: 'memory' })).toEqual({
      provider: 'memory',
      kind: 'block',
      id: 'b1',
    });
  });

  test('canonicalKnowledgeRef throws on invalid shapes', () => {
    expect(() => canonicalKnowledgeRef({ provider: 'siyuan', kind: 'flow' as never, id: 'x' })).toThrow();
  });
});
