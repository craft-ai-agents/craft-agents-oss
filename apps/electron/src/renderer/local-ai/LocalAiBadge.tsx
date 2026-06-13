// Tiny status chip: shows whether on-device AI is GPU-accelerated, and (optionally)
// flags identity PII in the current draft before it's sent. Drop it next to the
// composer: <LocalAiBadge text={draft} />. Opt-in; renders nothing heavy until used.

import { useEffect, useState } from "react";
import { useLocalAi } from "./useLocalAi";

export function LocalAiBadge({ text }: { text?: string }) {
  const ai = useLocalAi();
  const [pii, setPii] = useState<boolean | null>(null);

  useEffect(() => {
    if (!text || text.trim().length < 12) {
      setPii(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const flagged = await ai.hasIdentityPII(text).catch(() => false);
      if (!cancelled) setPii(flagged);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, ai]);

  const gpu = ai.device === "webgpu";
  return (
    <span
      title={gpu ? "Local AI running on WebGPU" : "Local AI on CPU (WASM)"}
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 6,
        background: gpu ? "rgba(19,115,51,0.12)" : "rgba(176,96,0,0.12)",
        color: gpu ? "#137333" : "#b06000",
      }}
    >
      local · {gpu ? "WebGPU" : "CPU"}
      {pii && (
        <span title="This draft names a person/location — it will route to a private lane" style={{ color: "#b3261e" }}>
          · identity PII
        </span>
      )}
    </span>
  );
}
