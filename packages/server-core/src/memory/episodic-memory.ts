/**
 * episodic-memory — M2 semantic (episodic) memory layer (spec §M2).
 *
 * Gated by config `memory.semantic` (default false, opt-in). Stores one line
 * per distilled session in {memoryDir}/episodic.jsonl:
 *   { id, ts, kind: 'success'|'failure', sessionId, text, embedding? }
 *
 * Embeddings are NOT computed at write time (writes stay sync and cheap); the
 * first search() that finds entries without an embedding computes them in one
 * batch and caches them back into the jsonl file (best-effort rewrite).
 *
 * Model: Xenova/all-MiniLM-L6-v2 via @xenova/transformers feature-extraction
 * pipeline, downloaded lazily on FIRST use into {configDir}/models
 * (~90MB total incl. ONNX weights). Any load failure — network down, huggingface
 * blocked, WASM runtime missing — marks the embedder unavailable for the
 * process lifetime and every API degrades to keyword-overlap (Jaccard over
 * unicode token sets) scoring, sharing the same minScore threshold so the
 * failure mode is "fewer related sessions", never an error.
 *
 * Failure contract (mirrors fts-index): EVERYTHING is fail-soft. addEpisode
 * returns null instead of throwing; search/searchEpisodes return [] on any
 * error. Episodic memory must never break a distill, a session start, or a
 * prompt build.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'

/** Episode store file name inside the scope's memory directory. */
export const EPISODIC_FILE = 'episodic.jsonl'
/** Embedding model (lazy-downloaded to {configDir}/models on first use). */
export const EPISODIC_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
/** Hard timeout for the one-time pipeline load + model download. */
export const MODEL_LOAD_TIMEOUT_MS = 3 * 60_000
/** Default recall: top-3 episodes, only when topical overlap ≥ 0.78 (spec §M2). */
export const DEFAULT_EPISODE_LIMIT = 3
export const DEFAULT_EPISODE_MIN_SCORE = 0.78

export interface Episode {
  id: string
  /** ISO timestamp of the episode write. */
  ts: string
  kind: 'success' | 'failure'
  sessionId: string
  /** One-line session summary (single line, no \n). */
  text: string
  /** Embedding vector; absent until the first semantic search computes it. */
  embedding?: number[]
}

export interface ScoredEpisode extends Episode {
  /** Cosine similarity (semantic) or Jaccard token overlap (fallback), 0..1. */
  score: number
}

/** Batched text embedder: texts → one embedding per input text. */
export type Embedder = (texts: string[]) => Promise<number[][]>

export interface EpisodeSearchOptions {
  /** Max episodes returned (default 3). */
  limit?: number
  /** Minimum score, applied to BOTH cosine and keyword-fallback scores (default 0.78). */
  minScore?: number
}

export interface EpisodicMemoryOptions {
  /**
   * DI seam: a ready-made embedder (tests, future providers). When given, the
   * lazy @xenova/transformers loader is never touched.
   */
  embedder?: Embedder
  /**
   * DI seam: custom lazy loader producing the embedder (or null when
   * unavailable). Defaults to the @xenova/transformers loader below; inject a
   * rejecting factory to force the keyword fallback in tests.
   */
  loadEmbedder?: () => Promise<Embedder | null>
  /** Config dir holding the models cache; defaults to CRAFT_CONFIG_DIR || CONFIG_DIR. */
  configDir?: string
  /** Clock for episode ts/id ordering (tests). */
  now?: () => number
}

/** Race a promise against a hard timeout. The losing branch keeps running but is unobserved. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    if (typeof timer.unref === 'function') timer.unref()
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Lazy @xenova/transformers embedder (process-lifetime cache per configDir;
// a failure is cached as null — "mark unavailable" — and never retried).
// ---------------------------------------------------------------------------

const xenovaCache = new Map<string, Promise<Embedder | null>>()

/**
 * Test seam: drop the cached loader results so a suite can re-arm failure
 * scenarios. Production code never calls this.
 */
export function resetXenovaCacheForTests(): void {
  xenovaCache.clear()
}

function loadXenovaEmbedder(configDir: string): Promise<Embedder | null> {
  let cached = xenovaCache.get(configDir)
  if (!cached) {
    cached = doLoadXenovaEmbedder(configDir).catch(() => null)
    xenovaCache.set(configDir, cached)
  }
  return cached
}

async function doLoadXenovaEmbedder(configDir: string): Promise<Embedder | null> {
  try {
    const cacheDir = join(configDir, 'models')
    // Dynamic import is the feature contract (spec §M2 laziness): the module
    // and its onnxruntime/sharp natives must never load in a process that has
    // memory.semantic disabled. Static import would break that guarantee.
    const { env, pipeline } = await import('@xenova/transformers')
    env.cacheDir = cacheDir
    const extractor = await withTimeout(
      pipeline('feature-extraction', EPISODIC_MODEL_ID, { cache_dir: cacheDir }),
      MODEL_LOAD_TIMEOUT_MS,
    )
    return async (texts: string[]): Promise<number[][]> => {
      const out: number[][] = []
      for (const text of texts) {
        const tensor = await extractor(text, { pooling: 'mean', normalize: true })
        out.push(Array.from(tensor.data as ArrayLike<number>))
      }
      return out
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Unicode-aware lowercase tokenizer: words/digits, length ≥ 2. */
export function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1))
}

/** Jaccard similarity |A∩B| / |A∪B| over token sets; 0 for two empty sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

/** Cosine similarity; 0 on length mismatch/empty/zero-norm vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function topByScore(scored: ScoredEpisode[], opts: Required<EpisodeSearchOptions>): ScoredEpisode[] {
  return scored
    .filter((e) => e.score >= opts.minScore)
    .sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts))
    .slice(0, opts.limit)
}

// ---------------------------------------------------------------------------
// EpisodicMemory — one store per scope memory directory.
// ---------------------------------------------------------------------------

export class EpisodicMemory {
  readonly memoryDir: string
  private readonly opts: EpisodicMemoryOptions
  private readonly configDir: string
  private readonly now: () => number
  /** Resolved embedder promise; cached once resolved (null = unavailable). */
  private embedderReady: Promise<Embedder | null> | null = null
  /** Set once any embedder attempt fails at runtime — permanently degrades this instance. */
  private embedderFailed = false

  constructor(memoryDir: string, opts: EpisodicMemoryOptions = {}) {
    this.memoryDir = memoryDir
    this.opts = opts
    this.configDir = opts.configDir ?? (process.env.CRAFT_CONFIG_DIR || CONFIG_DIR)
    this.now = opts.now ?? (() => Date.now())
  }

  get filePath(): string {
    return join(this.memoryDir, EPISODIC_FILE)
  }

  /**
   * Append one episode. NO embedding is computed here (embeddings are
   * backfilled lazily by the next search). Returns the stored episode, or
   * null on any I/O failure (a full disk etc. must never fail a distill).
   */
  addEpisode(input: { kind: Episode['kind']; sessionId: string; text: string }): Episode | null {
    try {
      const entry: Episode = {
        id: randomUUID(),
        ts: new Date(this.now()).toISOString(),
        kind: input.kind,
        sessionId: input.sessionId,
        text: input.text.replace(/\s+/g, ' ').trim(),
      }
      if (!entry.text) return null
      mkdirSync(this.memoryDir, { recursive: true })
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8')
      return entry
    } catch {
      return null
    }
  }

  /** Parse the jsonl store tolerantly (bad/truncated lines are skipped). */
  private readEpisodes(): Episode[] {
    try {
      if (!existsSync(this.filePath)) return []
      const out: Episode[] = []
      for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const raw = JSON.parse(trimmed) as Partial<Episode>
          if (typeof raw.text !== 'string' || !raw.text) continue
          out.push({
            id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
            ts: typeof raw.ts === 'string' && raw.ts ? raw.ts : '',
            kind: raw.kind === 'failure' ? 'failure' : 'success',
            sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
            text: raw.text,
            embedding:
              Array.isArray(raw.embedding) && raw.embedding.length > 0 && raw.embedding.every((v) => typeof v === 'number')
                ? (raw.embedding as number[])
                : undefined,
          })
        } catch {
          // skip corrupted line
        }
      }
      return out
    } catch {
      return []
    }
  }

  /**
   * Persist enriched entries (embedding backfill). Atomic tmp+rename so a
   * crash mid-rewrite can't corrupt the store the append path relies on.
   */
  private writeEpisodes(entries: Episode[]): void {
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
    renameSync(tmp, this.filePath)
  }

  private getEmbedder(): Promise<Embedder | null> {
    if (this.embedderFailed) return Promise.resolve(null)
    if (this.opts.embedder) return Promise.resolve(this.opts.embedder)
    if (!this.embedderReady) {
      this.embedderReady = (this.opts.loadEmbedder ?? (() => loadXenovaEmbedder(this.configDir)))().catch(() => null)
    }
    return this.embedderReady
  }

  /**
   * Keyword-overload fallback scoring (Jaccard over token sets) — used both
   * when no embedder is available and when it fails mid-search.
   */
  private keywordSearch(entries: Episode[], query: string, opts: Required<EpisodeSearchOptions>): ScoredEpisode[] {
    const qTokens = tokenize(query)
    return topByScore(
      entries.map((e) => ({ ...e, score: jaccard(qTokens, tokenize(e.text)) })),
      opts,
    )
  }

  /**
   * Semantic recall: cosine similarity over embeddings when the embedder is
   * available (computing + caching embeddings for entries that lack them),
   * else the keyword fallback. Never throws.
   */
  async search(query: string, options: EpisodeSearchOptions = {}): Promise<ScoredEpisode[]> {
    const opts: Required<EpisodeSearchOptions> = {
      limit: options.limit ?? DEFAULT_EPISODE_LIMIT,
      minScore: options.minScore ?? DEFAULT_EPISODE_MIN_SCORE,
    }
    try {
      const trimmed = query.trim()
      if (!trimmed) return []
      const entries = this.readEpisodes()
      if (entries.length === 0) return []
      const embedder = await this.getEmbedder()
      if (!embedder) return this.keywordSearch(entries, trimmed, opts)
      try {
        // Backfill missing embeddings in one batch, then cache them on disk.
        const missing = entries.filter((e) => !e.embedding || e.embedding.length === 0)
        if (missing.length > 0) {
          const vectors = await embedder(missing.map((m) => m.text))
          let filled = false
          missing.forEach((m, i) => {
            if (Array.isArray(vectors[i]) && vectors[i].length > 0) {
              m.embedding = vectors[i]
              filled = true
            }
          })
          if (filled) {
            try {
              this.writeEpisodes(entries)
            } catch {
              // cache rewrite is best-effort; the in-memory entries are scored below
            }
          }
        }
        const [qVec] = await embedder([trimmed])
        if (!qVec || qVec.length === 0) return this.keywordSearch(entries, trimmed, opts)
        const scored: ScoredEpisode[] = []
        for (const e of entries) {
          if (e.embedding && e.embedding.length > 0) {
            scored.push({ ...e, score: cosineSimilarity(qVec, e.embedding) })
          }
        }
        return topByScore(scored, opts)
      } catch {
        // Embedder loaded but failed at runtime → mark unavailable, degrade.
        this.embedderFailed = true
        this.embedderReady = Promise.resolve(null)
        return this.keywordSearch(entries, trimmed, opts)
      }
    } catch {
      return []
    }
  }
}

/**
 * Standalone convenience search (throws never; [] on any error). For repeated
 * queries against one store prefer a long-lived EpisodicMemory instance.
 */
export async function searchEpisodes(
  memoryDir: string,
  query: string,
  options: EpisodeSearchOptions & EpisodicMemoryOptions = {},
): Promise<ScoredEpisode[]> {
  try {
    return await new EpisodicMemory(memoryDir, options).search(query, options)
  } catch {
    return []
  }
}
