// @craft-agent/local-ai — WebGPU local AI for Craft via transformers.js.
//
// Runs entirely on-device: embeddings, PII/entity detection, and small-LLM generation.
// In Craft's Electron renderer (Chromium) it uses WebGPU; elsewhere it falls back to WASM.
// Models load lazily and cache; nothing leaves the machine. This is the "private/local"
// substrate the gateway's privacy floor wants, plus free embeddings for memory/RAG.

import { pipeline, env } from "@huggingface/transformers";

export type Device = "webgpu" | "wasm" | "auto";

/** Default model ids (small, ONNX, quantized) — override per call if needed. */
export const MODELS = {
  embed: "mixedbread-ai/mxbai-embed-xsmall-v1", // ~24MB, 384-dim
  ner: "Xenova/bert-base-NER", // token-classification: PER / LOC / ORG / MISC
  gen: "onnx-community/Qwen2.5-0.5B-Instruct", // small instruct LLM
} as const;

function resolveDevice(d: Device): "webgpu" | "wasm" {
  if (d !== "auto") return d;
  const hasGPU = typeof navigator !== "undefined" && (navigator as unknown as { gpu?: unknown }).gpu;
  return hasGPU ? "webgpu" : "wasm";
}

/** Allow callers to host models locally (offline / thumbdrive) instead of the HF hub. */
export function configure(opts: { localModelPath?: string; allowRemote?: boolean } = {}): void {
  if (opts.localModelPath) env.localModelPath = opts.localModelPath;
  if (opts.allowRemote === false) env.allowRemoteModels = false;
}

const cache = new Map<string, Promise<unknown>>();
function getPipe(task: string, model: string, device: "webgpu" | "wasm", extra: Record<string, unknown> = {}) {
  const key = `${task}:${model}:${device}`;
  if (!cache.has(key)) cache.set(key, pipeline(task as never, model, { device, ...extra } as never));
  return cache.get(key)!;
}

/** Mean-pooled, normalized sentence embeddings. */
export async function embed(
  texts: string | string[],
  opts: { device?: Device; model?: string } = {},
): Promise<number[][]> {
  const device = resolveDevice(opts.device ?? "auto");
  const extractor = (await getPipe("feature-extraction", opts.model ?? MODELS.embed, device)) as (
    t: string | string[],
    o: object,
  ) => Promise<{ tolist(): number[][] }>;
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

export interface Entity { entity_group?: string; entity?: string; score: number; word: string; start?: number; end?: number }

/** Named-entity recognition — catches PERSON / LOCATION / ORG that keyword PII rules miss. */
export async function classifyEntities(
  text: string,
  opts: { device?: Device; model?: string } = {},
): Promise<Entity[]> {
  const device = resolveDevice(opts.device ?? "auto");
  const ner = (await getPipe("token-classification", opts.model ?? MODELS.ner, device)) as (
    t: string,
  ) => Promise<Entity[]>;
  return ner(text);
}

/**
 * Local PII signal for the privacy floor: true if the text names a person / location
 * (identity-class entities) above `minScore`. Complements the keyword classifier — NER
 * catches identity entities that regex can't, addressing the keyword-only weakness.
 */
export async function hasIdentityPII(text: string, minScore = 0.85, opts: { device?: Device } = {}): Promise<boolean> {
  const ents = await classifyEntities(text, opts);
  return ents.some(
    (e) => /PER|LOC/i.test(e.entity_group ?? e.entity ?? "") && e.score >= minScore,
  );
}

export interface ChatMessage { role: string; content: string }

/** On-device generation with a small instruct model (q4). For offline / fully-private turns. */
export async function generate(
  messages: ChatMessage[],
  opts: { device?: Device; model?: string; maxNewTokens?: number } = {},
): Promise<string> {
  const device = resolveDevice(opts.device ?? "auto");
  const gen = (await getPipe("text-generation", opts.model ?? MODELS.gen, device, { dtype: "q4" })) as (
    m: ChatMessage[],
    o: object,
  ) => Promise<Array<{ generated_text: ChatMessage[] }>>;
  const out = await gen(messages, { max_new_tokens: opts.maxNewTokens ?? 256 });
  return out[0].generated_text.at(-1)?.content ?? "";
}

/** Which device this environment will use — handy for a status badge in the UI. */
export function activeDevice(): "webgpu" | "wasm" {
  return resolveDevice("auto");
}
