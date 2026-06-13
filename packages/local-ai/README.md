# @craft-agent/local-ai — WebGPU local AI for Craft

On-device AI via [transformers.js](https://github.com/huggingface/transformers.js):
embeddings, PII/NER, and small-LLM generation that run in Craft's Electron renderer
on **WebGPU** (Chromium), falling back to WASM elsewhere. Nothing leaves the machine.

## Verified (live, WebGPU)

Open `demo.html` in Chrome / Craft (or `python3 -m http.server -d .` then `/demo.html`):

- device badge → **WEBGPU**
- embeddings: `mxbai-embed-xsmall` → cosine similarity over two sentences (384-dim) ✓
- NER: *"Email Dr. Sarah Chen in Boston about the patient's MRI results."* →
  `Sarah Chen` (PER, 1.00), `Boston` (LOC, 1.00) ✓

The NER result is the point: identity entities (person, location) that the gateway's
keyword-only privacy classifier cannot detect.

## API

```ts
import { embed, classifyEntities, hasIdentityPII, generate, activeDevice } from "@craft-agent/local-ai";

await embed(["hello", "world"]);                 // number[][] (mean-pooled, normalized)
await classifyEntities("Email Sarah in Boston"); // [{entity, word, score}]
await hasIdentityPII("Email Sarah in Boston");   // true — names a person/location
await generate([{ role: "user", content: "hi" }]); // on-device Qwen2.5-0.5B (q4)
activeDevice();                                   // "webgpu" | "wasm"
```

Models load lazily + cache. `configure({ localModelPath, allowRemote:false })` to serve
models offline (thumbdrive) instead of the HF hub.

## Where it merges into Craft

1. **Privacy floor upgrade** — the gateway's `privacy.ts` uses keyword regex only (it
   can't see "Sarah Chen" = a person). `hasIdentityPII()` adds real NER so identity
   content is correctly forced to the local/never-trains lane. This is the fix for the
   keyword-only weakness flagged in the improvement review.
2. **Free embeddings** — memory / source-spine / RAG ranking with zero API cost,
   GPU-fast, fully private.
3. **`private` lane, in-app** — `generate()` answers fully offline (no Ollama server),
   the strongest interpretation of the gateway's `private` virtual model.

## Renderer wiring (Craft Electron)

Craft's renderer is Vite + React. Add the dep and import:

```bash
bun add @huggingface/transformers   # in apps/electron
```

```ts
// apps/electron/src/renderer — e.g. a small status badge + a privacy pre-check
import { activeDevice, hasIdentityPII, embed } from "@craft-agent/local-ai";
// gate sensitive turns to local lanes before they hit the gateway; embed memory locally.
```

Vite bundles transformers.js (ESM) and serves the WASM/ONNX assets; WebGPU is automatic
in the Electron renderer. For the Bun gateway (no WebGPU), the same module runs on WASM
— slower, but lets `hasIdentityPII` run server-side too.

## Note

`demo.html` loads transformers.js from CDN (no local install needed). For production,
Vite bundles `@huggingface/transformers` (declared as a peer dep here).
