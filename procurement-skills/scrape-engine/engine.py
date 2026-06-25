#!/usr/bin/env python3
"""Entry module / CLI. The mechanics now live in three layers:

  resource.py (L1) — BrowserPool, proxy buckets, gate, host-locks, run_batch,
                     env-proxy strip, fresh-browser, context lifecycle.
  antibot.py  (L2) — navigate() + per-defense PROFILES + the script escape-hatch.
  contract.py (L3) — Row / Defense / Adapter types.

This file is just the CLI front door + a couple of re-exports so existing
adapters that do `from engine import q` keep working. It owns NO mechanics.
"""
from __future__ import annotations

import argparse
import asyncio
import json

# Re-export the small pure helpers + the scheduler so callers/adapters have a
# stable entry point. q() is imported by several adapters as `from engine import q`.
from resource import (  # noqa: F401
    DEFAULT_GATE,
    MIHOMO,
    host_of,
    q,
    run_batch,
)


def _parse_csv(s: str) -> list[str]:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def main() -> None:
    from registry import get_adapters, all_ids  # local: registry imports adapters

    ap = argparse.ArgumentParser(description="Async scrape engine")
    ap.add_argument("--part", help="single part (back-compat)")
    ap.add_argument("--parts", help="csv list of parts")
    ap.add_argument("--source", default="", help="csv adapter ids (back-compat)")
    ap.add_argument("--gate", type=int, default=DEFAULT_GATE,
                    help="global concurrency (4C4G: keep small)")
    ap.add_argument("--wait", type=int, default=10, help="per-nav timeout seconds")
    ap.add_argument("--limit", type=int, default=5, help="api mode: max records")
    args = ap.parse_args()

    parts: list[str] = []
    if args.parts:
        parts.extend(_parse_csv(args.parts))
    if args.part:
        parts.append(args.part)
    parts = list(dict.fromkeys(parts))  # dedupe, keep order

    if not parts:
        print(json.dumps({"rows": [], "errors": [{"error": "need --part or --parts"}]},
                         ensure_ascii=False, indent=2))
        return

    ids = _parse_csv(args.source)
    adapters = get_adapters(ids) if ids else get_adapters(all_ids())
    if not adapters:
        print(json.dumps({"rows": [], "errors": [
            {"error": "no known adapters; available: " + ",".join(all_ids())}]},
            ensure_ascii=False, indent=2))
        return

    out = asyncio.run(run_batch(
        parts, adapters,
        gate=args.gate, wait_ms=args.wait * 1000, api_limit=args.limit,
    ))
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
