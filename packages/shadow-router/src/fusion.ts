// Local fusion — OpenRouter-Fusion style. Fan out to diverse lanes, synthesize the best answer.
// Privacy-gated: members that fail the content's privacy floor are dropped before fan-out.

import { classifyContentSensitivity, checkConnectionPrivacy } from "./privacy.ts";
import { forward, type ResolvedProvider } from "./providers.ts";
import type { ChatRequest, RouterConfig, VirtualModel } from "./types.ts";

interface Candidate {
  label: string;
  content: string;
}

async function callOnce(
  provider: ResolvedProvider,
  model: string,
  req: ChatRequest,
): Promise<string | null> {
  try {
    const r = await forward(provider, { ...req, model, stream: false }, AbortSignal.timeout(60_000));
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function buildSynthesisPrompt(req: ChatRequest, candidates: Candidate[]): ChatRequest {
  const userQuery = req.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const blocks = candidates.map((c, i) => `### Candidate ${i + 1} (${c.label})\n${c.content}`).join("\n\n");
  const instruction =
    "You are a synthesis model. Below are independent answers from diverse models to the same prompt. " +
    "Weave together the strongest reasoning, most accurate facts, and clearest structure into one superior answer. " +
    "Do not mention the candidates or that fusion occurred — return only the final answer.";
  return {
    model: "synthesis",
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: `Original prompt:\n${userQuery}\n\n${blocks}\n\nProduce the single best answer.` },
    ],
    stream: false,
  };
}

export interface FusionResult {
  content: string;
  members: string[];
  dropped: string[];
}

/** Run fusion for the `fusion` virtual model. Returns the synthesized answer. */
export async function runFusion(
  req: ChatRequest,
  spec: VirtualModel,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
): Promise<FusionResult> {
  const category = classifyContentSensitivity(req);
  const members = spec.members ?? [];

  const allowed = members.filter((m) => {
    const p = config.providers[m.provider];
    const prov = providers.get(m.provider);
    return p && prov?.enabled && checkConnectionPrivacy(p, category).ok;
  });
  const dropped = members
    .filter((m) => !allowed.includes(m))
    .map((m) => `${m.provider}/${m.model}`);

  if (allowed.length === 0) {
    throw new Error(`fusion: no privacy-safe members for category=${category}`);
  }

  const results = await Promise.all(
    allowed.map(async (m) => {
      const prov = providers.get(m.provider)!;
      const content = await callOnce(prov, m.model, req);
      return content ? { label: `${m.provider}/${m.model}`, content } : null;
    }),
  );
  const candidates = results.filter((c): c is Candidate => c !== null);

  if (candidates.length === 0) throw new Error("fusion: all members failed");
  if (candidates.length === 1) {
    return { content: candidates[0].content, members: [candidates[0].label], dropped };
  }

  const synth = spec.synthesizer ?? allowed[0];
  const synthProv = providers.get(synth.provider)!;
  const synthReq = buildSynthesisPrompt(req, candidates);
  const fused = await callOnce(synthProv, synth.model, synthReq);

  return {
    content: fused ?? candidates[0].content,
    members: candidates.map((c) => c.label),
    dropped,
  };
}
