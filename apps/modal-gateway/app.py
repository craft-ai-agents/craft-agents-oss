"""craft-cloud-runs — Modal fallback gateway (PRD docs/cloud-runs-prd.md, phase G4).

Mirrors the Cloudflare gateway HTTP contract exactly so CloudflareComputerProvider
works against it unchanged (subclassed as ModalProvider in packages/cloud-runner):

  POST   /runs                        create run (idempotent by spec.id)
  GET    /runs/{id}/status
  DELETE /runs/{id}                   cancel (subtask-granular; driver honors the flag)
  GET    /runs/{id}/artifacts         list
  GET    /runs/{id}/artifacts/{path}  fetch

Execution model: the web endpoint spawns the driver function per run; the
driver walks subtasks sequentially, spawning one Modal Sandbox per subtask
with a baked-in runner that calls the LLM gateway. State lives in
modal.Dict; artifacts on a modal.Volume; per-subtask done.marker files
give the same crash-resume / cancel-wins semantics as the RunDO alarm chain.

Secrets (modal secret "craft-cloud-runs"):
  CLOUD_RUNS_TOKEN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
"""

import hmac
import json
import os
import time
from pathlib import Path

import modal

app = modal.App("craft-cloud-runs")
volume = modal.Volume.from_name("craft-cloud-runs-data", create_if_missing=True)
state = modal.Dict.from_name("craft-cloud-runs-state", create_if_missing=True)
secret = modal.Secret.from_name("craft-cloud-runs")

runner_image = modal.Image.debian_slim().pip_install("httpx==0.28.1")
DATA_ROOT = Path("/data/runs")

DEFAULT_WALL_CLOCK_SEC = 5400
SUBTASK_TIMEOUT_SEC = 720

RUNNER_SOURCE = r'''
import json, os, sys, time
from pathlib import Path
import httpx

t0 = time.monotonic()

workspace = Path(sys.argv[1])
config_name = sys.argv[2] if len(sys.argv) > 2 else "config.json"
config = json.loads((workspace / ".craft-run" / config_name).read_text())
subtasks = config.get("subtasks") or ([config["subtask"]] if config.get("subtask") else None)
base = config["baseUrl"].rstrip("/")
model = config["model"]
key = config.get("apiKey") or ""
subtask = subtasks[0]  # modal driver spawns one sandbox per subtask
headers = {"content-type": "application/json"}
if key:
    headers["authorization"] = f"Bearer {key}"

def fail(msg):
    out = workspace / "artifacts" / subtask["id"]
    out.mkdir(parents=True, exist_ok=True)
    (out / "fail.marker").write_text(json.dumps({"error": str(msg)[:1000], "durationMs": int((time.monotonic() - t0) * 1000)}) + "\n")
    sys.exit(1)

SYSTEM = "You are a research sub-agent. Investigate with the tools, then answer thoroughly, factually, citing sources."

def load_context(ws):
    ctx_dir = ws / "context"
    if not ctx_dir.exists():
        return ""
    parts = []
    for md in sorted(ctx_dir.rglob("*"))[:12]:
        if md.is_file():
            parts.append(f"### {md.name}\n{md.read_text()[:1500]}")
    if not parts:
        return ""
    return ("\n\nPRIOR RESEARCH CONTEXT (from a related previous run — build on it, do not repeat it):\n\n"
            + "\n\n---\n\n".join(parts))[:20000]

SYSTEM = SYSTEM + load_context(workspace)
TOOLS = [
    {"type": "function", "function": {"name": "web_search", "description": "Search the web.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "fetch_url", "description": "Fetch a page, return plain text (~8000 chars).", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
]

def llm(messages, use_tools=False, json_mode=False, model_override=None):
    body = {"model": model_override or model, "stream": False, "messages": messages}
    if use_tools:
        body["tools"] = TOOLS
        body["tool_choice"] = "auto"
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    resp = httpx.post(f"{base}/chat/completions", headers=headers, json=body, timeout=570)
    if resp.status_code != 200:
        fail(f"LLM gateway error {resp.status_code}: {resp.text[:400]}")
    return resp.json()

def web_search(query):
    try:
        r = httpx.get("https://html.duckduckgo.com/html/", params={"q": query}, headers={"user-agent": "Mozilla/5.0"}, timeout=30)
        import re
        links = re.findall(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', r.text)[:5]
        snips = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', r.text)[:5]
        strip = lambda s: re.sub(r"<[^>]+>", "", s).strip()
        out = []
        for i, (href, title) in enumerate(links):
            snip = strip(snips[i])[:250] if i < len(snips) else ""
            out.append(f"- {strip(title)}\n  {href}\n  {snip}")
        return "\n".join(out) or "no results"
    except Exception as e:
        return f"search error: {e}"

def fetch_url(url):
    try:
        import re
        r = httpx.get(url, headers={"user-agent": "Mozilla/5.0"}, timeout=30, follow_redirects=True)
        if r.status_code != 200:
            return f"fetch error: HTTP {r.status_code}"
        text = re.sub(r"<(script|style)[\s\S]*?</\\1>", "", r.text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000] if text else "empty page"
    except Exception as e:
        return f"fetch error: {e}"

out_dir = workspace / "artifacts" / subtask["id"]
out_dir.mkdir(parents=True, exist_ok=True)
trace = out_dir / "trace.jsonl"

if (out_dir / "done.marker").exists():
    print(f"subtask {subtask['id']} already done")
    sys.exit(0)

model_override = (subtask.get("model") or {}).get("modelId")
total = {"prompt_tokens": 0, "completion_tokens": 0}
def acc(u):
    if u:
        total["prompt_tokens"] += u.get("prompt_tokens", 0)
        total["completion_tokens"] += u.get("completion_tokens", 0)

text = ""
agentic = config.get("agentic", True)
if agentic:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": subtask["prompt"]}]
    for round_no in range(6):
        payload = llm(messages, use_tools=True, model_override=model_override)
        acc(payload.get("usage"))
        msg = payload["choices"][0]["message"]
        with open(trace, "a") as f:
            f.write(json.dumps({"t": time.time(), "round": round_no, "tool_calls": len(msg.get("tool_calls") or []), "content": (msg.get("content") or "")[:200]}) + "\n")
        calls = msg.get("tool_calls") or []
        if not calls:
            text = msg.get("content") or ""
            break
        messages.append(msg)
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = web_search(str(args.get("query", ""))) if name == "web_search" else fetch_url(str(args.get("url", ""))) if name == "fetch_url" else f"unknown tool: {name}"
            with open(trace, "a") as f:
                f.write(json.dumps({"t": time.time(), "round": round_no, "tool": name, "result": result[:200]}) + "\n")
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})
else:
    payload = llm([{"role": "system", "content": SYSTEM}, {"role": "user", "content": subtask["prompt"]}], model_override=model_override)
    acc(payload.get("usage"))
    text = payload["choices"][0]["message"]["content"]

brief = None
try:
    structured_instruction = (
        'Subtask: ' + subtask['prompt'] + '\n\nResearch material:\n' + text[:12000]
        + '\n\nDeliver ONE JSON object: {"summary": "3-5 sentence summary", '
        + '"claims": [{"text": "...", "confidence": "high|medium|low", "sources": ["https://..."]}], '
        + '"links": [{"title": "...", "url": "https://..."}]}'
    )
    p2 = llm([
        {"role": "system", "content": "You summarize research into strict JSON."},
        {"role": "user", "content": structured_instruction},
    ], json_mode=True)
    acc(p2.get("usage"))
    brief = json.loads(p2["choices"][0]["message"]["content"])
except Exception:
    brief = None

md = [f"# {subtask.get('title') or subtask['id']}", "", "## Prompt", "", subtask["prompt"], ""]
if brief and brief.get("summary"):
    md += ["## Summary", "", brief["summary"], ""]
    if brief.get("claims"):
        md += ["## Key claims", ""]
        for c in brief["claims"]:
            md.append(f"- **[{c.get('confidence', 'medium')}]** {c.get('text', '')}")
            for s in c.get("sources") or []:
                md.append(f"  - {s}")
        md.append("")
    if brief.get("links"):
        md += ["## Sources", ""]
        for l in brief["links"]:
            md.append(f"- [{l.get('title') or l.get('url')}]({l.get('url')})")
        md.append("")
else:
    md += ["## Brief", "", text, ""]

(out_dir / "answer.md").write_text("\n".join(md))
if brief:
    (out_dir / "brief.json").write_text(json.dumps(brief, ensure_ascii=False, indent=2) + "\n")
duration_ms = int((time.monotonic() - t0) * 1000)
(out_dir / "done.marker").write_text(json.dumps({"finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "durationMs": duration_ms}) + "\n")
usage_dir = workspace / "artifacts" / "_usage"
usage_dir.mkdir(parents=True, exist_ok=True)
(usage_dir / f"{subtask['id']}.json").write_text(
    json.dumps({**total, "durationMs": duration_ms}) + "\n"
)
print(f"subtask {subtask['id']} done")
'''


def _run_dir(run_id: str) -> Path:
    return DATA_ROOT / run_id


def _state_key(run_id: str) -> str:
    return f"run:{run_id}"


def _cancel_key(run_id: str) -> str:
    return f"cancel:{run_id}"


def _sandbox_key(run_id: str) -> str:
    return f"sandboxes:{run_id}"


def _authorized(headers) -> bool:
    want = os.environ.get("CLOUD_RUNS_TOKEN", "")
    got = (headers.get("authorization") or "").removeprefix("Bearer ")
    return bool(want) and hmac.compare_digest(got, want)


def _share_key(run_id: str) -> str:
    return f"share:{run_id}"


def _maybe_expired(run_id: str) -> bool:
    """ttlSec enforcement: finished runs age out; dict record + volume files purged."""
    import shutil

    cur = state.get(_state_key(run_id))
    if not cur:
        return False
    spec: dict = {}
    spec_path = _run_dir(run_id) / "spec.json"
    if spec_path.exists():
        try:
            spec = json.loads(spec_path.read_text())
        except (OSError, json.JSONDecodeError):
            pass
    ttl = spec.get("ttlSec")
    finished = cur.get("finishedAt")
    if not ttl or not finished or cur.get("state") not in ("done", "failed", "cancelled"):
        return False
    if time.time() * 1000 < finished + ttl * 1000:
        return False
    shutil.rmtree(_run_dir(run_id), ignore_errors=True)
    volume.commit()
    state.pop(_state_key(run_id), None)
    return True


@app.function(volumes={"/data": volume}, secrets=[secret], timeout=3600)
def driver(spec: dict):
    run_id = spec["id"]
    wall_clock = spec.get("limits", {}).get("maxWallClockSec") or DEFAULT_WALL_CLOCK_SEC
    deadline = time.monotonic() + wall_clock
    workspace = _run_dir(run_id)
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "spec.json").write_text(json.dumps(spec))

    def set_status(**fields):
        cur = dict(state.get(_state_key(run_id), {}))
        # F14: capped event log on meaningful state transitions
        if "state" in fields and fields["state"] != cur.get("state"):
            log = cur.get("eventLog", [])
            log.append({"t": int(time.time() * 1000), "message": fields["state"]})
            cur["eventLog"] = log[-50:]
        cur.update(fields)
        state[_state_key(run_id)] = cur

    def log_event(message):
        cur = dict(state.get(_state_key(run_id), {}))
        log = cur.get("eventLog", [])
        log.append({"t": int(time.time() * 1000), "message": message})
        cur["eventLog"] = log[-50:]
        state[_state_key(run_id)] = cur

    set_status(id=run_id, state="running", startedAt=int(time.time() * 1000))
    subtasks = spec["subtasks"]
    completed = 0

    semaphore = __import__('threading').Semaphore(max(1, min(int(spec.get('concurrency') or 2), 4)))
    errors = {}

    def run_subtask(subtask):
        with semaphore:
            if state.get(_cancel_key(run_id)):
                return
            if time.monotonic() > deadline:
                errors['budget'] = True
                return
            volume.reload()
            marker = workspace / "artifacts" / subtask["id"] / "done.marker"
            if marker.exists():
                return
            (workspace / ".craft-run").mkdir(exist_ok=True)
            (workspace / ".craft-run" / f"config-{subtask['id']}.json").write_text(json.dumps({
                "baseUrl": os.environ["LLM_BASE_URL"],
                "apiKey": os.environ.get("LLM_API_KEY", ""),
                "model": spec.get("model", {}).get("modelId") or os.environ.get("LLM_MODEL", "kimi-K3"),
                "subtask": subtask,
            }))
            volume.commit()

            exit_code = -1
            stderr = ""
            for attempt in range(2):
                try:
                    sb = modal.Sandbox.create(
                        "python", "-c", RUNNER_SOURCE, str(workspace), f"config-{subtask['id']}.json",
                        app=app,
                        image=runner_image,
                        volumes={"/data": volume},
                        timeout=SUBTASK_TIMEOUT_SEC + 60,
                    )
                    track = state.get(_sandbox_key(run_id), {})
                    track[subtask["id"]] = sb.object_id
                    state[_sandbox_key(run_id)] = track
                    sb.wait()
                    exit_code = sb.returncode
                    stderr = sb.stderr.read() if exit_code else ""
                    if exit_code == 0:
                        break
                except Exception:
                    break
            if state.get(_cancel_key(run_id)):
                return

            volume.reload()
            marker = workspace / "artifacts" / subtask["id"] / "done.marker"
            if not marker.exists():
                fail_marker = workspace / "artifacts" / subtask["id"] / "fail.marker"
                detail = stderr[-400:]
                if fail_marker.exists():
                    try:
                        detail = (json.loads(fail_marker.read_text()).get("error") or detail)[:400]
                    except (OSError, json.JSONDecodeError):
                        pass
                errors[subtask["id"]] = f"exit {exit_code}: {detail}"
                return

            usage_file = workspace / "artifacts" / "_usage" / f"{subtask['id']}.json"
            if usage_file.exists():
                try:
                    usage = json.loads(usage_file.read_text())
                    cur = state.get(_state_key(run_id), {}).get("usage", {"promptTokens": 0, "completionTokens": 0, "cpuMs": 0})
                    cur["promptTokens"] += usage.get("prompt_tokens", 0)
                    cur["completionTokens"] += usage.get("completion_tokens", 0)
                    cur["cpuMs"] += usage.get("durationMs", 0)
                    set_status(usage=cur)
                except (json.JSONDecodeError, KeyError):
                    pass
            completed[0] += 1
            log_event(f"subtask {subtask['id']} done")
            set_status(progress={"completed": completed[0], "total": len(subtasks)})

    completed = [0]
    threads = [__import__('threading').Thread(target=run_subtask, args=(s,)) for s in subtasks]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    if state.get(_cancel_key(run_id)):
        set_status(state="cancelled", failureReason="cancelled", finishedAt=int(time.time() * 1000))
        return
    if errors.get('budget'):
        set_status(state="failed", failureReason="budget_exceeded",
                   failureDetail=f"wall-clock budget {wall_clock}s exceeded", finishedAt=int(time.time() * 1000))
        return
    if errors:
        first = next(iter(errors.items()))
        if any("503" in e or "resource pressure" in e for e in errors.values()):
            errors['concurrency'] = True  # marker for future adaptive behavior
        set_status(state="failed", failureReason="runner_error",
                   failureDetail=f"subtask {first[0]}: {first[1]}"[:1000], finishedAt=int(time.time() * 1000))
        return

    volume.commit()
    set_status(state="done", finishedAt=int(time.time() * 1000),
               progress={"completed": len(subtasks), "total": len(subtasks)})


# ---------------------------------------------------------------------------
# HTTP surface (same contract as the Cloudflare gateway). One ASGI app so
# route paths match exactly (/runs/{id}/status etc.) — provider-agnostic.
# ---------------------------------------------------------------------------

web_image = modal.Image.debian_slim().pip_install("fastapi[standard]==0.115.*")


@app.function(volumes={"/data": volume}, secrets=[secret], image=web_image)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def gateway_api():
    import fastapi
    from fastapi import Depends, Header, Response

    api = fastapi.FastAPI(title="craft-cloud-runs")

    def auth(authorization: str = Header(default="")) -> None:
        if not _authorized({"authorization": authorization}):
            raise fastapi.HTTPException(status_code=401, detail="unauthorized")

    @api.post("/runs")
    async def post_run(spec: dict, _=Depends(auth)):
        run_id = spec.get("id")
        if not run_id or ".." in run_id or "/" in run_id or not spec.get("subtasks"):
            raise fastapi.HTTPException(status_code=400, detail="invalid_spec")
        # F7 fork: copy parent briefs into the child's context dir
        # (same volume — cheap local copy, no cross-service call).
        parent_id = spec.get("fromRunId")
        if parent_id:
            import shutil
            volume.reload()
            parent_art = _run_dir(parent_id) / "artifacts"
            if parent_art.exists():
                target_dir = _run_dir(run_id) / "context"
                target_dir.mkdir(parents=True, exist_ok=True)
                for md_file in parent_art.rglob("*.md"):
                    rel = md_file.relative_to(parent_art)
                    shutil.copyfile(md_file, target_dir / str(rel).replace("/", "__"))
                volume.commit()
        key = _state_key(run_id)
        existing = state.get(key)
        if existing:
            if existing.get("state") in ("failed", "cancelled"):
                # Resume semantics (F1): restart failed/cancelled runs; done
                # markers on the volume make finished subtasks skip. Active
                # states keep idempotent behavior.
                state.pop(_cancel_key(run_id), None)
                existing = {**existing, "state": "queued", "failureReason": None, "failureDetail": None}
                existing.pop("finishedAt", None)
                state[key] = existing
                driver.spawn(spec)
            return {"id": run_id, "createdAt": existing.get("createdAt", int(time.time() * 1000))}
        now = int(time.time() * 1000)
        state[key] = {"id": run_id, "name": spec.get("name"), "state": "queued", "createdAt": now}
        driver.spawn(spec)
        return {"id": run_id, "createdAt": now}

    @api.get("/runs/{run_id}/status")
    async def status_of(run_id: str, _=Depends(auth)):
        volume.reload()
        _maybe_expired(run_id)
        cur = state.get(_state_key(run_id))
        if not cur:
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        return cur

    @api.websocket("/runs/{run_id}/ws")
    async def ws_events(websocket: fastapi.WebSocket, run_id: str):
        authorization = websocket.headers.get("authorization", "")
        if not _authorized({"authorization": authorization}):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        try:
            cursor = 0
            while True:
                cur = state.get(_state_key(run_id))
                if cur is None:
                    await websocket.send_json({"t": 0, "message": "run not found"})
                    break
                log = cur.get("eventLog", [])
                while cursor < len(log):
                    await websocket.send_json(log[cursor])
                    cursor += 1
                if cur.get("state") in ("done", "failed", "cancelled") and cursor >= len(log):
                    break
                import asyncio
                await asyncio.sleep(2)
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    @api.get("/runs/{run_id}/events")
    async def events_of(run_id: str, _=Depends(auth)):
        cur = state.get(_state_key(run_id))
        if not cur:
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        return cur.get("eventLog", [])

    @api.delete("/runs/{run_id}")
    async def delete_run(run_id: str, _=Depends(auth)):
        cur = state.get(_state_key(run_id))
        if not cur:
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        if cur.get("state") in ("queued", "running"):
            state[_cancel_key(run_id)] = True
            state[_state_key(run_id)] = {
                **cur, "state": "cancelled", "failureReason": "cancelled",
                "finishedAt": int(time.time() * 1000),
            }
            # F2: terminate live sandboxes — cancel must stop the LLM burn,
            # not just the state flag.
            for sb_id in (state.get(_sandbox_key(run_id)) or {}).values():
                try:
                    modal.Sandbox.from_id(sb_id).terminate()
                except Exception:
                    pass
        return {"ok": True}

    @api.get("/runs/{run_id}/artifacts")
    async def artifacts_of(run_id: str, _=Depends(auth)):
        _maybe_expired(run_id)
        if not state.get(_state_key(run_id)):
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        volume.reload()
        root = _run_dir(run_id) / "artifacts"
        out = []
        if root.exists():
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    out.append({"path": str(path.relative_to(root)), "size": path.stat().st_size})
        return out

    @api.get("/runs/{run_id}/artifacts/{artifact_path:path}")
    async def artifact_file(run_id: str, artifact_path: str, _=Depends(auth)):
        _maybe_expired(run_id)
        if not state.get(_state_key(run_id)):
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        if artifact_path.startswith(("/", "\\")) or ".." in artifact_path.split("/"):
            raise fastapi.HTTPException(status_code=400, detail="unsafe artifact path")
        volume.reload()
        target = (_run_dir(run_id) / "artifacts" / artifact_path).resolve()
        if not str(target).startswith(str((_run_dir(run_id) / "artifacts").resolve())) or not target.is_file():
            raise fastapi.HTTPException(status_code=404, detail="artifact not found")
        return Response(content=target.read_bytes(), media_type="application/octet-stream")

    @api.post("/runs/{run_id}/share")
    async def share(run_id: str, _=Depends(auth)):
        cur = state.get(_state_key(run_id))
        if not cur:
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        if cur.get("state") != "done":
            raise fastapi.HTTPException(status_code=400, detail="run not finished")
        import secrets as _secrets
        token = cur.get("shareToken") or _secrets.token_urlsafe(24)
        state[_state_key(run_id)] = {**cur, "shareToken": token}
        return {"token": token}

    @api.post("/runs/{run_id}/revoke")
    async def revoke(run_id: str, _=Depends(auth)):
        cur = state.get(_state_key(run_id))
        if not cur:
            raise fastapi.HTTPException(status_code=404, detail="run not found")
        cur.pop("shareToken", None)
        state[_state_key(run_id)] = cur
        return {"ok": True}

    @api.get("/share/{run_id}/{token}")
    async def shared_page(run_id: str, token: str):
        cur = state.get(_state_key(run_id))
        if not cur or cur.get("shareToken") != token:
            raise fastapi.HTTPException(status_code=404, detail="not found")
        volume.reload()
        root = _run_dir(run_id) / "artifacts"
        from html import escape
        sections = []
        if root.exists():
            for md in sorted(root.rglob("*.md"))[:20]:
                rel = str(md.relative_to(root))
                sections.append(
                    f"<section><h2>{escape(rel)}</h2><pre>{escape(md.read_text()[:100000])}</pre></section>"
                )
        title = escape(cur.get("name") or run_id)
        html_doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;}}pre{{white-space:pre-wrap;font-family:inherit;background:#f6f6f6;padding:1rem;border-radius:8px;overflow-wrap:anywhere}}h2{{font-size:1rem;color:#555}}header{{display:flex;gap:1rem;align-items:baseline}}.badge{{background:#22c55e22;color:#15803d;padding:.15em .6em;border-radius:999px;font-size:.8rem}}</style>
</head><body><header><h1>{title}</h1><span class="badge">cloud research · {escape(cur.get("state", ""))}</span></header>
{"".join(sections)}
<footer><small>Shared read-only view · cloud-runs</small></footer></body></html>"""
        return fastapi.Response(content=html_doc, media_type="text/html")

    @api.get("/healthz")
    async def healthz():
        return {"ok": True}

    return api
