#!/usr/bin/env python3
"""Master Electronics (masterelectronics.com) adapter — mode=dom, needs_proxy.
Ported from procurement-platform-search/scripts/cloak_search.py (scrape_master).

  Old scrape_master did, by hand:
    1. launch(headless=True, humanize=True, proxy=MIHOMO)  — 走住宅代理;
    2. goto search URL, wait_until="domcontentloaded", timeout=wait*1000
       (swallow nav exceptions);
    3. p.wait_for_timeout(1000)  — 1s settle;
    4. collect .search-result rows: " ".join(e.inner_text().split()) for each,
       sliced [:limit], dropping empties;
    5. text = "\n".join(hits) or "（无 .search-result 命中——该平台可能无此料）".
    Master is behind Akamai Bot Manager (curl 403). NO warmup goto in the old
    code; NO route interception.

  Faithful relocation:
    - profile='akamai' supplies the homepage-warmup/retry/block-check machinery,
      but the old scrape_master had NO warmup goto, so warmup_url is left None
      (engine skips the warmup hop). needs_proxy=True mirrors the launch-level
      MIHOMO residential proxy.
    - settle_wait_ms=1000 mirrors the old 1s p.wait_for_timeout.
    - extract() reads .search-result rows specifically (not a whole-body dump),
      matching the old per-row .search-result inner_text harvest, then joins them
      into note exactly as the old code joined hits. NOTE: the old code used the
      CLI `limit` to slice rows; the engine does not pass `limit` into dom
      extract(), so we keep ALL .search-result rows (no slice). This is the one
      behavioral gap — porting the join/empty-drop logic byte-faithfully but
      without the limit cap, which the engine's signature does not expose here.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.masterelectronics.com/en/keywordsearch?text={q(part)}"


async def extract(page: Any, part: str) -> list[Row]:
    """dom-mode extract is async: payload is the live async Page, already
    warmed/retried/settled by engine.navigate(). The old code harvested every
    .search-result row's inner_text (whitespace-collapsed, empties dropped) and
    joined them; we reproduce that, putting the joined product-row text in note."""
    rows = []
    try:
        for e in await page.query_selector_all(".search-result"):
            try:
                rows.append(" ".join(((await e.inner_text()) or "").split()))
            except Exception:
                pass
    except Exception:
        pass
    hits = [r for r in rows if r]
    text = "\n".join(hits) or "（无 .search-result 命中——该平台可能无此料）"
    try:
        final_url = page.url
    except Exception:
        final_url = url(part)
    return [Row(part=part, platform="master", product_url=final_url,
                note=text[:4000], in_stock=bool(hits) or None)]


ADAPTER = Adapter(
    id="master",
    tier="more",
    mode="dom",
    needs_proxy=True,                       # 走住宅代理（Akamai 直连必挡）
    url=url,
    extract=extract,
    # Akamai profile owns warmup/retry/block-check. The old scrape_master skipped
    # warmup (warmup_url=None) and got blocked=true — Akamai needs the homepage hop
    # to seed the _abck cookie BEFORE the search goto, which is exactly what the
    # akamai profile does when given a warmup_url. Hit cold, the search page is
    # blocked; warm via the homepage first.
    defense=Defense(
        profile="akamai",
        warmup_url="https://www.masterelectronics.com/en",
        settle_wait_ms=1000,                # old: p.wait_for_timeout(1000)
    ),
    host_key="www.masterelectronics.com",
)
