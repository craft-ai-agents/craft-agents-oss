import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  EpisodicMemory,
  cosineSimilarity,
  jaccard,
  searchEpisodes,
  tokenize,
  type Embedder,
  type Episode,
} from '../episodic-memory'

const tmpRoots: string[] = []

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true })
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'episodic-'))
  tmpRoots.push(dir)
  return dir
}

function readLines(dir: string): Episode[] {
  return readFileSync(join(dir, 'episodic.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Episode)
}

describe('scoring helpers', () => {
  it('tokenize splits unicode words and drops length-1 tokens', () => {
    expect(tokenize('Fix the БД migration, ok?')).toEqual(new Set(['fix', 'the', 'бд', 'migration', 'ok']))
  })

  it('jaccard over token sets', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c']))).toBe(1)
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'dd']))).toBe(0.5)
    expect(jaccard(new Set(), new Set(['a']))).toBe(0)
  })

  it('cosineSimilarity basic cases', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
    expect(cosineSimilarity([1], [1, 2])).toBe(0) // dimension mismatch is silence, not a crash
  })
})

describe('EpisodicMemory.addEpisode', () => {
  it('appends one jsonl line per episode, normalizing whitespace', () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    const ep = mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'shipped\nthe   thing' })
    expect(ep).not.toBeNull()
    expect(ep!.text).toBe('shipped the thing')
    expect(ep!.kind).toBe('success')
    mem.addEpisode({ kind: 'failure', sessionId: 's2', text: 'boom' })
    const lines = readLines(dir)
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.kind)).toEqual(['success', 'failure'])
    // No embedding at write time — embeddings are backfilled by search.
    expect(lines[0].embedding).toBeUndefined()
  })

  it('write path is fire-safe on error (no throw, returns null)', () => {
    // memoryDir occupied by a regular FILE → mkdir/append must fail, never throw.
    const dir = makeDir()
    const blocker = join(dir, 'occupied')
    writeFileSync(blocker, 'i am a file', 'utf8')
    const mem = new EpisodicMemory(blocker)
    expect(mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'hi' })).toBeNull()
  })

  it('rejects empty text without creating a file', () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    expect(mem.addEpisode({ kind: 'success', sessionId: 's1', text: '   ' })).toBeNull()
  })
})

describe('EpisodicMemory.search — semantic path', () => {
  it('cosine search ranks sanely and caches embeddings back to disk', async () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'alpha' })
    mem.addEpisode({ kind: 'success', sessionId: 's2', text: 'beta' })
    mem.addEpisode({ kind: 'failure', sessionId: 's3', text: 'gamma' })

    const vecByText: Record<string, number[]> = {
      alpha: [1, 0, 0],
      beta: [0.9, 0.1, 0], // close to alpha but second
      gamma: [0, 1, 0], // orthogonal → below 0.78 threshold
      'looking for alpha work': [1, 0, 0],
    }
    const embedCalls: string[][] = []
    const embedder: Embedder = async (texts) => {
      embedCalls.push([...texts])
      return texts.map((t) => vecByText[t] ?? [0, 0, 1])
    }
    const mem2 = new EpisodicMemory(dir, { embedder })

    const hits = await mem2.search('looking for alpha work')
    expect(hits.map((h) => h.sessionId)).toEqual(['s1', 's2'])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
    expect(hits[0].score).toBeCloseTo(1)
    // Embeddings persisted back into the store after first search.
    const cached = readLines(dir)
    expect(cached[0].embedding).toEqual([1, 0, 0])
    expect(cached[2].embedding).toEqual([0, 1, 0])

    // Second search: cached entries are not re-embedded — only the query is.
    embedCalls.length = 0
    const hits2 = await mem2.search('looking for alpha work')
    expect(hits2.map((h) => h.sessionId)).toEqual(['s1', 's2'])
    expect(embedCalls).toEqual([['looking for alpha work']])
  })

  it('honors limit and a custom minScore', async () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'a' })
    mem.addEpisode({ kind: 'success', sessionId: 's2', text: 'b' })
    mem.addEpisode({ kind: 'success', sessionId: 's3', text: 'c' })
    const embedder: Embedder = async (texts) => texts.map(() => [1, 0]) // everything identical → max cosine
    const hits = await new EpisodicMemory(dir, { embedder }).search('q', { limit: 2, minScore: 0.5 })
    expect(hits).toHaveLength(2)
  })

  it('embedder runtime failure marks it unavailable and degrades to keyword', async () => {
    const dir = makeDir()
    new EpisodicMemory(dir).addEpisode({ kind: 'success', sessionId: 's1', text: 'fixed the database migration regression in the sqlite layer' })
    let calls = 0
    const embedder: Embedder = async (texts) => {
      calls++
      if (calls > 1) throw new Error('embedders are down') // backfill ok, query embed explodes
      return texts.map(() => [1, 0])
    }
    const mem = new EpisodicMemory(dir, { embedder })
    const query = 'fixed the database migration regression in the sqlite layer today'
    const hits = await mem.search(query)
    expect(hits).toHaveLength(1) // keyword fallback still finds the near-verbatim episode
    expect(hits[0].score).toBeCloseTo(8 / 9)
    // Marked unavailable: next search never touches the embedder again.
    const hits2 = await mem.search(query)
    expect(hits2).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('empty store / blank query → no hits without touching the embedder', async () => {
    const dir = makeDir()
    let calls = 0
    const embedder: Embedder = async (texts) => {
      calls++
      return texts.map(() => [1, 0])
    }
    const mem = new EpisodicMemory(dir, { embedder })
    expect(await mem.search('anything')).toEqual([])
    mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'stored' })
    expect(await mem.search('   ')).toEqual([])
    expect(calls).toBe(0)
  })

  it('tolerates corrupted jsonl lines', async () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'good line about vercel deploys' })
    writeFileSync(
      join(dir, 'episodic.jsonl'),
      readFileSync(join(dir, 'episodic.jsonl'), 'utf8') + '{"broken json\n{"text":""}\n{"text":123}\n',
      'utf8',
    )
    const hits = await new EpisodicMemory(dir, { embedder: async (texts) => texts.map(() => [1, 0]) }).search('vercel deploys')
    expect(hits.map((h) => h.sessionId)).toEqual(['s1'])
  })
})

describe('EpisodicMemory.search — keyword fallback (model unavailable)', () => {
  it('works when the model load is forced to fail, and marks it unavailable', async () => {
    const dir = makeDir()
    const mem = new EpisodicMemory(dir)
    mem.addEpisode({ kind: 'success', sessionId: 's1', text: 'fixed the database migration regression in the sqlite layer' })
    mem.addEpisode({ kind: 'failure', sessionId: 's2', text: 'watering office plants again' })

    let loads = 0
    const forcedFail = async () => {
      loads++
      throw new Error('model download failed')
    }
    const offline = new EpisodicMemory(dir, { loadEmbedder: forcedFail })

    // Query shares 8/9 tokens with s1 → jaccard 0.888 ≥ 0.78; s2 is disjoint.
    const hits = await offline.search('fixed the database migration regression in the sqlite layer today')
    expect(hits).toHaveLength(1)
    expect(hits[0].sessionId).toBe('s1')
    expect(hits[0].kind).toBe('success')
    expect(hits[0].score).toBeCloseTo(8 / 9)
    expect(hits[0].embedding).toBeUndefined() // fallback never fabricates embeddings

    // Unavailable is sticky — the failing loader is not retried per search.
    await offline.search('fixed the database migration regression in the sqlite layer today')
    expect(loads).toBe(1)
  })

  it('standalone searchEpisodes degrades to [] on an unreadable store', async () => {
    const dir = makeDir()
    const blocker = join(dir, 'occupied')
    writeFileSync(blocker, 'i am a file', 'utf8')
    expect(await searchEpisodes(blocker, 'query', { loadEmbedder: async () => null })).toEqual([])
  })
})
