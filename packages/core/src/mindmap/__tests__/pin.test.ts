import { describe, expect, test } from 'bun:test';
import { deriveNoteMindMap } from '../derive-note.ts';
import {
  createPinnedMap,
  entityPinKey,
  isStale,
  loadPinnedMap,
  parsePinnedMap,
  pinFilename,
  sanitizePinFilenamePart,
  savePinnedMap,
  serializePinnedMap,
} from '../pin.ts';

describe('pin helpers', () => {
  test('entityPinKey and filename sanitize', () => {
    expect(entityPinKey({ type: 'session', sessionId: 'abc' })).toBe('session_abc');
    expect(entityPinKey({ type: 'note', noteId: 'n/../x' })).toBe('note_n_x');
    expect(
      entityPinKey({
        type: 'knowledge',
        ref: { scheme: 'siyuan', kind: 'document', id: 'd1' },
      }),
    ).toBe('knowledge_document_d1');
    expect(pinFilename({ type: 'session', sessionId: 's1' })).toBe('session_s1.json');
    expect(sanitizePinFilenamePart('a b/c')).toBe('a_b_c');
  });

  test('serialize/parse round-trip', () => {
    const graph = deriveNoteMindMap({
      noteId: 'n1',
      title: 'T',
      markdown: '# H',
    });
    const pin = createPinnedMap(graph, { positions: { root: { x: 1, y: 2 } }, collapsed: [] }, 1000);
    const json = serializePinnedMap(pin);
    const back = parsePinnedMap(json);
    expect(back.entity).toEqual(pin.entity);
    expect(back.sourceContentHash).toBe(graph.contentHash);
    expect(back.layout.positions.root).toEqual({ x: 1, y: 2 });
    expect(back.graph.nodes.root!.label).toBe('T');
  });

  test('load/save with in-memory io', async () => {
    const store = new Map<string, string>();
    const io = {
      async read(path: string) {
        return store.has(path) ? store.get(path)! : null;
      },
      async write(path: string, data: string) {
        store.set(path, data);
      },
    };

    const entity = { type: 'note' as const, noteId: 'n-io' };
    expect(await loadPinnedMap(io, '/pins', entity)).toBeNull();

    const graph = deriveNoteMindMap({
      noteId: 'n-io',
      title: 'IO',
      markdown: 'body only',
    });
    const pin = createPinnedMap(graph);
    await savePinnedMap(io, '/pins', pin);

    expect(store.has('/pins/note_n-io.json')).toBe(true);
    const loaded = await loadPinnedMap(io, '/pins', entity);
    expect(loaded?.sourceContentHash).toBe(graph.contentHash);
    expect(loaded?.graph.nodes['section:body']?.kind).toBe('section');
  });

  test('isStale compares sourceContentHash', () => {
    const graph = deriveNoteMindMap({
      noteId: 'n',
      title: 'T',
      markdown: '# A',
    });
    const pin = createPinnedMap(graph);
    expect(isStale(pin, graph.contentHash)).toBe(false);
    expect(isStale(pin, 'deadbeef')).toBe(true);
  });
});

  test('sourceContentHash override tracks live hash separately', () => {
    const graph = deriveNoteMindMap({
      noteId: 'n-enrich',
      title: 'T',
      markdown: '# A',
    });
    const enriched = { ...graph, contentHash: 'enriched-hash', derivation: 'enriched' as const };
    const pin = createPinnedMap(enriched, { positions: {}, collapsed: [] }, 1, graph.contentHash);
    expect(pin.graph.contentHash).toBe('enriched-hash');
    expect(pin.sourceContentHash).toBe(graph.contentHash);
    expect(isStale(pin, graph.contentHash)).toBe(false);
    expect(isStale(pin, 'other')).toBe(true);
  });
