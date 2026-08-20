/**
 * craft-cloud-gateway — Worker entrypoint.
 *
 * HTTP surface (PRD docs/cloud-runs-prd.md §G2.2):
 *   POST   /runs                       create run (idempotent by spec.id)
 *   GET    /runs/:id/status            poll status
 *   DELETE /runs/:id                   cancel
 *   GET    /runs/:id/artifacts         list
 *   GET    /runs/:id/artifacts/*       fetch one
 *
 * Auth (v1): `authorization: Bearer $CLOUD_RUNS_TOKEN`. Craft-JWT
 * integration lands with app-side phase G3.
 */
import { RunAgent } from "./run-do.ts";
export { RunAgent, WorkspaceProxy } from "./run-do.ts";

interface Env {
  RunAgent: DurableObjectNamespace<RunAgent>;
  CLOUD_RUNS_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

async function authorize(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLOUD_RUNS_TOKEN) {
    return json({ error: "gateway misconfigured: CLOUD_RUNS_TOKEN missing", code: "provider_error" }, 500);
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!(await constantTimeEqual(token, env.CLOUD_RUNS_TOKEN))) {
    return json({ error: "unauthorized", code: "unauthorized" }, 401);
  }
  return null;
}

function stubOf(env: Env, id: string) {
  return env.RunAgent.get(env.RunAgent.idFromName(id));
}

/** DO RPC rejects with the thrown Error's message; map "not_found". */
async function callDo<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const value = await fn();
    if (value === null) return json({ error: "run not found", code: "not_found" }, 404);
    return json(value, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not_found")) return json({ error: "run not found", code: "not_found" }, 404);
    return json({ error: message, code: "provider_error" }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return json({ ok: true }, 200);

    // F15: public tokenized share page — no auth, token IS the capability.
    const shareMatch = url.pathname.match(/^\/share\/([^/]+)\/([0-9a-f-]+)$/);
    if (shareMatch && request.method === "GET") {
      try {
        const html = await stubOf(env, shareMatch[1]!).renderShare(shareMatch[2]!);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }

    const denied2 = await authorize(request, env);
    if (denied2) return denied2;

    if (url.pathname.match(/^\/runs\/[^/]+\/ws$/) && request.headers.get("upgrade") === "websocket") {
      const id = url.pathname.split("/")[2]!;
      return stubOf(env, id).fetch(request);
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)(\/status|\/events|\/share|\/revoke|\/artifacts(?:\/(.*))?)?$/);
    if (url.pathname === "/runs" && request.method === "POST") {
      const spec = (await request.json().catch(() => null)) as { id?: string; subtasks?: unknown[]; fromRunId?: string } | null;
      if (!spec?.id || !Array.isArray(spec.subtasks) || spec.subtasks.length === 0) {
        return json({ error: "spec.id and non-empty spec.subtasks are required", code: "invalid_spec" }, 400);
      }
      // F7: fork — gather the parent's markdown briefs as context files.
      const contextFiles: { path: string; content: string }[] = [];
      if (spec.fromRunId) {
        const parent = stubOf(env, spec.fromRunId);
        const parentArtifacts = (await parent.listArtifacts()) as { path: string; size: number }[];
        for (const artifact of parentArtifacts) {
          if (!artifact.path.endsWith(".md") || artifact.path.startsWith("_usage/")) continue;
          if (artifact.size > 200_000) continue;
          try {
            contextFiles.push({ path: artifact.path, content: await parent.fetchArtifact(artifact.path) });
          } catch { /* skip unreadable parent artifact */ }
        }
      }
      return callDo(() => stubOf(env, spec.id!).createRun(spec as never, contextFiles as never));
    }

    if (!runMatch) return new Response("not found", { status: 404 });
    const [, id, sub, artifactPath] = runMatch;
    const stub = stubOf(env, id!);

    if (request.method === "GET" && sub === "/status") {
      return callDo(() => stub.getStatus());
    }
    if (request.method === "GET" && sub === "/events") {
      return callDo(() => stub.getEvents());
    }
    if (request.method === "POST" && sub === "/share") {
      const result = await callDo(() => stub.shareRun());
      return result;
    }
    if (request.method === "POST" && sub === "/revoke") {
      return callDo(() => stub.revokeShare());
    }
    if (request.method === "DELETE" && sub === undefined) {
      return callDo(async () => {
        await stub.cancelRun();
        return { ok: true };
      });
    }
    if (request.method === "GET" && sub === "/artifacts") {
      return callDo(() => stub.listArtifacts());
    }
    if (request.method === "GET" && sub?.startsWith("/artifacts/") && artifactPath) {
      const bytes = await callDoText(() => stub.fetchArtifact(decodeURIComponent(artifactPath)));
      return bytes;
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function callDoText(fn: () => Promise<string>): Promise<Response> {
  try {
    return new Response(await fn(), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not_found") ? 404 : message.includes("unsafe artifact path") ? 400 : 500;
    return json({ error: message, code: status === 404 ? "not_found" : status === 400 ? "path_traversal" : "provider_error" }, status);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Best-effort constant-time compare; not a substitute for HSM-grade auth. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
