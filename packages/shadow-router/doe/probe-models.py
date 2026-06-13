#!/usr/bin/env python3
"""Reverse-probe every model a provider advertises: trial each, classify health, capture metadata.
Vets the catalog so the gateway can hide broken/deprecated lanes. Concurrent, one-time use.

  python3 probe.py --base http://127.0.0.1:8319/v1 --key vibe-factory-local-2026 --out registry.json
"""
import json, time, sys, argparse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8319/v1")
ap.add_argument("--key", default="vibe-factory-local-2026")
ap.add_argument("--out", default="registry.json")
ap.add_argument("--workers", type=int, default=6)
ap.add_argument("--timeout", type=int, default=45)
args = ap.parse_args()

def http(path, body=None):
    url = args.base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if body else "GET",
                                 headers={"authorization": f"Bearer {args.key}", "content-type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as r:
            return r.status, json.loads(r.read().decode()), int((time.time()-t0)*1000)
    except urllib.error.HTTPError as e:
        try: payload = json.loads(e.read().decode())
        except Exception: payload = {"raw": str(e)}
        return e.code, payload, int((time.time()-t0)*1000)
    except Exception as e:
        return 0, {"error": {"message": str(e)}}, int((time.time()-t0)*1000)

st, models_resp, _ = http("/models")
ids = sorted(m["id"] for m in models_resp.get("data", []))
print(f"probing {len(ids)} models @ {args.base}", file=sys.stderr)

def probe(mid):
    status, body, latency = http("/chat/completions", {
        "model": mid, "max_tokens": 8, "messages": [{"role": "user", "content": "Reply with: OK"}],
    })
    choices = body.get("choices") or []
    content = (choices[0].get("message", {}).get("content") if choices else "") or ""
    served = body.get("model")
    err = body.get("error", {})
    errmsg = (err.get("message") if isinstance(err, dict) else str(err)) or ""
    usage = body.get("usage", {}) or {}
    # classify
    if content.strip():
        health = "working"
    elif "deprecated" in errmsg.lower() or "no longer supported" in errmsg.lower() or "upgrade" in errmsg.lower():
        health = "deprecated"
    elif "temperature" in errmsg.lower():
        health = "param_sensitive"
    elif status == 200 and not content.strip():
        health = "empty"
    else:
        health = f"error_{status}"
    return {
        "id": mid, "health": health, "status": status, "latency_ms": latency,
        "served_as": served, "prompt_overhead": usage.get("prompt_tokens"),
        "error": errmsg[:200] if errmsg else None,
        "is_thinking": any(s in mid for s in ("thinking", "-high")),
        "is_image": "image" in mid,
    }

with ThreadPoolExecutor(max_workers=args.workers) as ex:
    rows = list(ex.map(probe, ids))

rows.sort(key=lambda r: (r["health"] != "working", r["id"]))
by_health = {}
for r in rows:
    by_health.setdefault(r["health"], []).append(r["id"])

out = {"base": args.base, "total": len(rows), "by_health": {k: len(v) for k, v in by_health.items()}, "models": rows}
json.dump(out, open(args.out, "w"), indent=2)

print(f"\n{'MODEL':38} {'HEALTH':14} {'LAT':>6} {'OVHD':>6}  ERR")
for r in rows:
    print(f"{r['id']:38} {r['health']:14} {r['latency_ms']:>6} {str(r['prompt_overhead'] or ''):>6}  {(r['error'] or '')[:60]}")
print(f"\nsummary: {out['by_health']}")
print(f"working: {by_health.get('working', [])}")
print(f"wrote {args.out}")
