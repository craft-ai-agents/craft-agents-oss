// Optional NER-backed identity detection for the privacy floor.
//
// privacy.ts is keyword-only — it cannot see that "Sarah Chen" is a person or "Boston"
// a location. This adds a real local NER model (transformers.js, WASM in the gateway /
// WebGPU in Craft's renderer) to catch identity entities regex misses. Env-gated
// (SHADOW_ROUTER_NER=1), lazy, cached, and fail-open to keyword-only if the model can't load.

let nerPromise: Promise<((t: string) => Promise<Array<{ entity?: string; entity_group?: string; score: number }>>) | null> | null = null;

function loadNER() {
  if (!nerPromise) {
    nerPromise = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        const model = process.env.SHADOW_ROUTER_NER_MODEL ?? "Xenova/bert-base-NER";
        return (await pipeline("token-classification", model)) as never;
      } catch {
        return null; // degrade silently to keyword-only
      }
    })();
  }
  return nerPromise;
}

export function nerEnabled(): boolean {
  return process.env.SHADOW_ROUTER_NER === "1";
}

/**
 * True if the text names a person or location above `minScore`. Safety-biased: an
 * over-flag just routes to a safer lane, which is the correct failure direction.
 */
export async function hasIdentityPII(text: string, minScore = 0.9): Promise<boolean> {
  const ner = await loadNER();
  if (!ner) return false;
  try {
    const ents = await ner(text);
    return ents.some((e) => /PER|LOC/i.test(e.entity_group ?? e.entity ?? "") && e.score >= minScore);
  } catch {
    return false;
  }
}
