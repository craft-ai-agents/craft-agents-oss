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
    from source_sets import source_csv, source_ids_for_set, source_set_names

    ap = argparse.ArgumentParser(description="Async scrape engine")
    ap.add_argument("--part", help="single part (back-compat)")
    ap.add_argument("--parts", help="csv list of parts")
    ap.add_argument("--source", default="", help="csv adapter ids (back-compat)")
    ap.add_argument("--source-set", choices=source_set_names(),
                    help="named source set from source_catalog.yaml")
    ap.add_argument("--list-source-set", choices=source_set_names(),
                    help="print the named source set and exit")
    ap.add_argument("--gate", type=int, default=DEFAULT_GATE,
                    help="global concurrency (4C4G: keep small)")
    ap.add_argument("--wait", type=int, default=10, help="per-nav timeout seconds")
    ap.add_argument("--limit", type=int, default=5, help="api mode: max records")
    args = ap.parse_args()

    if args.list_source_set:
        ids = source_ids_for_set(args.list_source_set)
        print(json.dumps({
            "source_set": args.list_source_set,
            "sources": ids,
            "source_csv": source_csv(ids),
        }, ensure_ascii=False, indent=2))
        return

    if args.source and args.source_set:
        print(json.dumps({"rows": [], "errors": [
            {"error": "use either --source or --source-set, not both"},
        ]}, ensure_ascii=False, indent=2))
        return

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

    ids = source_ids_for_set(args.source_set) if args.source_set else _parse_csv(args.source)
    adapter_ids = all_ids()
    known_ids = set(adapter_ids)
    unknown_ids = [source_id for source_id in ids if source_id not in known_ids]
    adapters = get_adapters(ids) if ids else get_adapters(adapter_ids)
    if not adapters:
        print(json.dumps({"rows": [], "errors": [
            {"error": "no known adapters; available: " + ",".join(sorted(known_ids))},
            *[
                {"platform": source_id, "part": part, "error": "unknown source id"}
                for source_id in unknown_ids
                for part in parts
            ],
        ]},
            ensure_ascii=False, indent=2))
        return

    out = asyncio.run(run_batch(
        parts, adapters,
        gate=args.gate, wait_ms=args.wait * 1000, api_limit=args.limit,
    ))
    for source_id in unknown_ids:
        for part in parts:
            out.setdefault("errors", []).append({
                "platform": source_id,
                "part": part,
                "error": "unknown source id",
            })
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
