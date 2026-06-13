// React hook for on-device AI in Craft's renderer (WebGPU via transformers.js).
// Opt-in: import where you need local embeddings, a privacy pre-check, or offline generation.
// Nothing here runs until a method is called (models load lazily, then cache).

import { useCallback, useMemo, useState } from "react";
import { activeDevice, embed, hasIdentityPII, generate, type ChatMessage } from "@craft-agent/local-ai";

export interface LocalAi {
  device: "webgpu" | "wasm";
  busy: boolean;
  /** Mean-pooled, normalized embeddings — for memory / RAG ranking, fully local. */
  embed: (texts: string | string[]) => Promise<number[][]>;
  /** True if the text names a person/location — a local privacy pre-check before sending. */
  hasIdentityPII: (text: string) => Promise<boolean>;
  /** Fully on-device generation (small model) — the strongest `private` lane. */
  generate: (messages: ChatMessage[]) => Promise<string>;
}

export function useLocalAi(): LocalAi {
  const device = useMemo(() => activeDevice(), []);
  const [busy, setBusy] = useState(false);

  const wrap = useCallback(<A extends unknown[], R>(fn: (...a: A) => Promise<R>) => {
    return async (...args: A): Promise<R> => {
      setBusy(true);
      try {
        return await fn(...args);
      } finally {
        setBusy(false);
      }
    };
  }, []);

  return useMemo(
    () => ({
      device,
      busy,
      embed: wrap(embed) as LocalAi["embed"],
      hasIdentityPII: wrap(hasIdentityPII) as LocalAi["hasIdentityPII"],
      generate: wrap((m: ChatMessage[]) => generate(m)) as LocalAi["generate"],
    }),
    [device, busy, wrap],
  );
}
