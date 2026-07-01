#!/usr/bin/env python3
"""L1 — hardware / deployment concern. Knows NOTHING about why a page is blocked
or what a part is. It owns browsers, proxy buckets, the concurrency gate, the
per-host locks, context lifecycle, and the env-proxy / fresh-browser MECHANICS.

What lives here (and ONLY here):

  BrowserPool   — proxy is a LAUNCH-level param in cloakbrowser (cannot be set
                  per-context), so the pool is keyed by proxy BUCKET: ONE proxy
                  browser (proxy=MIHOMO) + ONE machine-direct browser, each
                  launched once via launch_async and reused across all tasks.
                  new_context() per task gives cookie isolation without
                  relaunching Chromium. .fresh() launches an UN-pooled Chromium
                  PROCESS — the real reset L2 needs for PerimeterX retries.

  _no_env_proxy / _launch
                — the env-proxy STRIP mechanic. Chromium INHERITS HTTP(S)_PROXY
                  at launch regardless of the proxy= kwarg, so we pop those vars
                  around BOTH bucket launches: the proxy bucket gets ONLY its
                  explicit launch proxy (no double-proxy that breaks PX SPA
                  render), and the direct bucket is TRULY machine-direct (not
                  silently egressing through the residential proxy that Akamai
                  rejects). This is fix #1 from the prior review, owned here.

  Gate / host-locks / run_batch
                — the asyncio.Semaphore concurrency GATE, a per-host asyncio.Lock
                  (站内串行: same site never hit by two concurrent tasks; 站间并行:
                  different sites run up to the gate), and the batch scheduler.
                  One task crashing never kills the batch.

L1 imports the Adapter/Row TYPES from contract.py and the navigate() entrypoint
from antibot.py (L2). It does NOT know block patterns, warmup, or profiles —
those are L2's. The dependency is one-way: L1 -> L2 -> L3(contract).

Memory note (4C4G, OOM-bound) — the gate UNIT must match the COST it bounds:

  Two cost classes hide behind one gate permit if you're not careful:
    - new_context() on a pooled browser  — cheap, ~one tab's RAM.
    - pool.fresh()  — a WHOLE Chromium PROCESS (renderer + GPU + zygote heap),
      which is what the perimeterx profile launches PER ATTEMPT (FIX #3).

  Peak live Chromium PROCESSES at any instant =
      (2 persistent pooled base browsers: proxy + direct, launched on first use
       and kept alive for the whole run by BrowserPool)
    + (the fresh full processes held under the gate simultaneously).

  If a fresh-browser task only cost ONE permit, gate=2 could hold up to 2
  concurrent FULL processes on top of the 2 pooled ones = 4 heavy Chromiums on
  a 4G box (the OOM the design claims to prevent). So a fresh-browser task
  charges FRESH_BROWSER_PERMITS (>1) permits — it occupies more of the gate,
  which lowers how many full processes run at once for a given --gate.

  The OOM budget the operator must satisfy (assert it before raising --gate):
      2 * BASE_RSS
    + ceil(gate / FRESH_BROWSER_PERMITS) * FRESH_BROWSER_RSS   <  RAM
  (BASE_RSS ≈ pooled-browser RSS, FRESH_BROWSER_RSS ≈ a full Chromium process.)
  DEFAULT_GATE=2 with FRESH_BROWSER_PERMITS=2 => at most ONE fresh process at a
  time alongside the 2 pooled = 3 heavy Chromiums, which fits 4G. --gate trades
  RAM for throughput; bump it only if the inequality above still holds.
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from typing import Any, Optional
from urllib.parse import urlparse

os.environ.setdefault("CLOAKBROWSER_AUTO_UPDATE", "false")

from cloakbrowser import launch_async  # noqa: E402

from contract import Adapter, Row  # noqa: E402
from url_utils import q  # noqa: E402

MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")

# Env-proxy vars Chromium INHERITS at launch. Popped around every launch so the
# ONLY proxy in effect is the explicit launch kwarg (proxy bucket) or none at all
# (direct bucket = machine-direct). FIX #1 — preserved here.
_ENV_PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")

# Default global concurrency, in GATE PERMITS. 4C4G box -> OOM-bound.
DEFAULT_GATE = 2

# A fresh-browser task (perimeterx: a FULL Chromium process per attempt, not a
# cheap context) charges this many permits instead of 1, so the gate bounds the
# real RSS cost and not just a task COUNT. With DEFAULT_GATE=2 this means at most
# ONE fresh full process runs at a time (2 permits) on top of the 2 persistent
# pooled browsers = 3 heavy Chromiums, which fits 4G. See the module docstring
# OOM inequality before raising either constant.
FRESH_BROWSER_PERMITS = 2


def host_of(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return url


@contextlib.contextmanager
def _no_env_proxy():
    """Strip HTTP(S)_PROXY from os.environ for the duration, then restore.
    Chromium reads these at launch; popping them is the ONLY way to stop the
    inherited proxy (the proxy= launch kwarg does NOT override env)."""
    saved = {k: os.environ.pop(k, None) for k in _ENV_PROXY_VARS}
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


async def _launch(proxy_url: Optional[str], headless: bool) -> Any:
    """Launch one Chromium with env proxy stripped. proxy_url=None -> machine
    direct; otherwise the launch-level proxy is the ONLY proxy in effect."""
    kw: dict[str, Any] = {"headless": headless, "humanize": True}
    if proxy_url:
        kw["proxy"] = proxy_url
    with _no_env_proxy():                       # FIX #1: strip around BOTH buckets
        return await launch_async(**kw)


# ---------------------------------------------------------------------------
# Browser pool — one browser per proxy bucket, launched once, reused.
# ---------------------------------------------------------------------------


class BrowserPool:
    """Lazily launches at most ONE proxy browser + ONE direct browser and hands
    out the right one by `needs_proxy`. proxy is launch-level in cloakbrowser, so
    we cannot mix proxied/direct on one browser — hence two buckets, not N."""

    def __init__(self, proxy: str = MIHOMO, headless: bool = True):
        self._proxy_url = proxy
        self._headless = headless
        self._browsers: dict[str, Any] = {}        # bucket -> Browser
        self._locks: dict[str, asyncio.Lock] = {
            "proxy": asyncio.Lock(), "direct": asyncio.Lock()}

    async def get(self, needs_proxy: bool) -> Any:
        """Return the pooled bucket browser, launching it once on first use."""
        bucket = "proxy" if needs_proxy else "direct"
        if bucket in self._browsers:
            return self._browsers[bucket]
        async with self._locks[bucket]:
            if bucket in self._browsers:           # double-checked
                return self._browsers[bucket]
            self._browsers[bucket] = await self.fresh(needs_proxy)
            return self._browsers[bucket]

    async def fresh(self, needs_proxy: bool) -> Any:
        """Launch a brand-new, UN-pooled Chromium PROCESS for this bucket. Used by
        L2's fresh_browser_per_attempt retries (FIX #3): a new context shares
        process/TLS/fingerprint and is NOT the same reset. Caller owns closing."""
        return await _launch(self._proxy_url if needs_proxy else None, self._headless)

    async def close(self) -> None:
        for b in self._browsers.values():
            try:
                await b.close()
            except Exception:
                pass
        self._browsers.clear()


# ---------------------------------------------------------------------------
# Per-task runner + batch scheduler. L1 drives the gate/locks; L2 drives the
# anti-bot navigate; the adapter drives extraction.
# ---------------------------------------------------------------------------


async def _maybe_await(value):
    """extract() may be sync (api/xhr) or a coroutine (dom/script). Normalize."""
    if asyncio.iscoroutine(value):
        return await value
    return value


async def _run_one(
    pool: BrowserPool,
    adapter: Adapter,
    part: str,
    *,
    wait_ms: int,
    api_limit: int,
) -> tuple[list[Row], Optional[dict]]:
    """Run one (part × adapter). Returns (rows, error|None). Never raises."""
    # Imported here (not at module top) so contract/resource can be imported
    # without pulling cloakbrowser nav code until a run actually happens, and to
    # keep the L1->L2 edge explicit at the call site.
    from antibot import navigate  # noqa: E402

    try:
        if adapter.mode == "api":
            # No browser. Adapter does its own HTTP via api_fetch -> payload.
            if adapter.api_fetch is None:
                return [], {"platform": adapter.id, "part": part,
                            "error": "api mode without api_fetch"}
            payload = await adapter.api_fetch(part, api_limit)
            rows = await _maybe_await(adapter.extract(payload, part))
            return rows, None

        # dom / xhr / script: L2 gets the page past the defense wall, returns the
        # payload to feed extract plus (ctx, meta) for lifecycle.
        payload, ctx, meta = await navigate(pool, adapter, part, wait_ms=wait_ms)
        try:
            if payload is None:
                # blocked / nothing captured — single blocked sentinel Row.
                return [Row(part=part, platform=adapter.id,
                            blocked=bool(meta.get("blocked")),
                            product_url=meta.get("url"),
                            note="blocked or no payload after retries")], None
            rows = await _maybe_await(adapter.extract(payload, part))
            if meta.get("blocked"):
                for r in rows:
                    r.blocked = True
            return rows, None
        finally:
            # context lifecycle is L1's: close the per-task context and any
            # per-attempt browser L2 owned (fresh_browser path).
            if ctx is not None:
                try:
                    await ctx.close()
                except Exception:
                    pass
            owned = (meta or {}).get("_owned_browser")
            if owned is not None:
                try:
                    await owned.close()
                except Exception:
                    pass
    except Exception as e:  # one task crashing never kills the batch
        return [], {"platform": adapter.id, "part": part,
                    "error": f"{type(e).__name__}: {e}"}


class WeightedGate:
    """Correct weighted semaphore: a task takes ALL n permits atomically or waits
    — it never holds a partial allotment. The naive 'acquire n permits one-by-one
    from an asyncio.Semaphore' DEADLOCKS when two big tasks each grab some and both
    wait for the rest (e.g. two 2-permit fresh-browser PerimeterX tasks on
    different hosts at gate=2). Check-and-take under a Condition removes that: a
    task only decrements when it can take its full n, so no one is ever stuck
    holding 1 of 2."""

    def __init__(self, total: int):
        self._total = max(1, total)
        self._avail = self._total
        self._cond = asyncio.Condition()

    @contextlib.asynccontextmanager
    async def slot(self, n: int):
        n = max(1, min(n, self._total))          # never ask for more than exist
        async with self._cond:
            while self._avail < n:
                await self._cond.wait()
            self._avail -= n
        try:
            yield
        finally:
            async with self._cond:
                self._avail += n
                self._cond.notify_all()


async def run_batch(
    parts: list[str],
    adapters: list[Adapter],
    *,
    gate: int = DEFAULT_GATE,
    wait_ms: int = 10000,
    api_limit: int = 5,
    proxy: str = MIHOMO,
) -> dict:
    """Schedule every (part × adapter) task. Global gate caps total concurrency;
    a per-host lock serializes same-site tasks (站内串行) while different sites
    run concurrently (站间并行). Returns {"rows": [...], "errors": [...]}."""
    from antibot import uses_fresh_browser  # L1->L2 edge, kept at call site

    gate = max(1, gate)
    pool = BrowserPool(proxy=proxy)
    gate_obj = WeightedGate(gate)
    host_locks: dict[str, asyncio.Lock] = {}

    def permits_for(a: Adapter) -> int:
        """Gate permits this task costs. A fresh-browser task (full Chromium
        process) charges FRESH_BROWSER_PERMITS so the gate bounds RSS, not just
        count; capped at gate so a single such task can never deadlock when
        FRESH_BROWSER_PERMITS > gate."""
        if a.exclusive:
            return gate
        if uses_fresh_browser(a):
            return min(FRESH_BROWSER_PERMITS, gate)
        return 1

    def host_lock_for(a: Adapter) -> asyncio.Lock:
        key = a.host_key or host_of(a.url(""))
        if key not in host_locks:
            host_locks[key] = asyncio.Lock()
        return host_locks[key]

    rows_out: list[dict] = []
    errors_out: list[dict] = []

    async def task(a: Adapter, part: str):
        # 站内串行 first (so two same-site tasks don't both occupy a gate slot
        # while one waits), then the global gate.
        async with host_lock_for(a):
            async with gate_obj.slot(permits_for(a)):
                rows, err = await _run_one(
                    pool, a, part, wait_ms=wait_ms, api_limit=api_limit)
                if not rows and not err:
                    rows = [Row(
                        part=part,
                        platform=a.id,
                        product_url=a.url(part),
                        availability_status="no_result",
                        note="no_result: adapter returned no rows",
                    )]
                for r in rows:
                    rows_out.append(r.to_dict())
                if err:
                    errors_out.append(err)

    try:
        await asyncio.gather(*[task(a, p) for p in parts for a in adapters])
    finally:
        await pool.close()

    return {"rows": rows_out, "errors": errors_out}


__all__ = [
    "MIHOMO", "DEFAULT_GATE", "FRESH_BROWSER_PERMITS", "q", "host_of",
    "BrowserPool", "run_batch",
]
