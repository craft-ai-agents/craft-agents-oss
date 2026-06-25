#!/usr/bin/env python3
"""Avnet (安富利) adapter — mode=dom, needs_proxy, antibot warmup+retry.
Ported from procurement-platform-search-more/scripts/cloak_search.py
(scrape_avnet). This is load-bearing, working anti-bot code; the PerimeterX
warmup/block semantics are preserved as DATA in the Defense policy below
(profile='perimeterx' + per-adapter overrides).

  Old scrape_avnet did, by hand:
    1. pop HTTP(S)_PROXY env so only the launch-level proxy is used
       (双代理会干扰重 SPA 渲染);
    2. launch(proxy=MIHOMO);
    3. warmup goto https://www.avnet.com/americas/  + 4s dwell
       (let PX pass the auto-challenge / seed a cookie);
    4. goto search URL + 6s dwell;
    5. blocked = BLOCK_PAT.search(text[:3000]) OR len(text) < 80;
    6. NO route interception (it did NOT block image/media resources — doing so
       can drop PX beacon/challenge assets that load as images).
    Note: the old scrape_avnet did NOT itself retry (the 4-round relaunch loop
    lived in octopart-alt). The retries below are a deliberate improvement.

  Faithful relocation:
    - env-proxy strip: done by engine._launch (it pops HTTP(S)_PROXY around
      launch_async). Chromium INHERITS env proxy regardless of the proxy= kwarg,
      so passing proxy=MIHOMO alone would NOT have avoided the double-proxy that
      degrades the SPA render — the engine pops env proxy, which is what matters.
    - block_resources=False below mirrors the old "zero route interception".
    - min_body_len=80 keeps the avnet-only <80-char block heuristic (generic dom
      adapters do NOT set it).
    - fresh_browser_per_attempt=True so each retry relaunches the whole Chromium
      process (the real PX reset), matching the old octopart-alt loop.

extract() reads the settled live Page and returns the rendered product text as a
Row (mirroring the old behavior of handing body text to the agent). The block
flag is stamped by the engine from BLOCK_PAT/len detection.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.avnet.com/americas/products/c/search?search={q(part)}"


async def extract(page: Any, part: str) -> list[Row]:
    """dom-mode extract is async: payload is the live async Page, already
    warmed/retried/settled by engine.navigate(). The engine awaits this coroutine
    (see engine._maybe_await). Avnet renders product rows server-side once PX
    passes; the old code captured the whole body text and let the agent read
    料号/库存/阶梯价 out of it. We preserve that exactly: emit ONE Row carrying the
    rendered text in `note` plus the final URL. Structured per-row parsing of
    Avnet's grid is a later refinement; faithfulness to the working scraper first."""
    try:
        text = " ".join((await page.inner_text("body") or "").split())
    except Exception:
        text = ""
    try:
        final_url = page.url
    except Exception:
        final_url = url(part)
    return [Row(part=part, platform="avnet", product_url=final_url,
                note=text[:4000] or "(被反爬拦截/未渲染未取到，不代表无货)")]


ADAPTER = Adapter(
    id="avnet",
    tier="more",
    mode="dom",
    needs_proxy=True,                       # 直连必被 PX 挡
    url=url,
    extract=extract,
    # PerimeterX profile owns warmup/retries/fresh-browser/PX block_pat. avnet
    # overrides only what genuinely differs from the shared PX default: its own
    # homepage warmup_url and the avnet-only <80-char short-body block clause.
    # block_resources stays the profile default (False = zero route interception,
    # FIX #2). fresh_browser_per_attempt comes from the PX profile (FIX #3).
    defense=Defense(
        profile="perimeterx",
        warmup_url="https://www.avnet.com/americas/",
        warmup_wait_ms=4000,                # old: 4s after homepage
        settle_wait_ms=6000,                # old: 6s after search goto
        min_body_len=80,                    # old avnet-only <80-char block clause (FIX #4 opt-in)
    ),
    host_key="www.avnet.com",
)
