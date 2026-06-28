#!/usr/bin/env python3
"""Shared factory for the GENERIC SSR-dump adapters — mode=dom, body-text -> note.

Ported byte-faithfully from legacy extended-source cloak_search.py
(scrape_generic + the GENERIC config table). The OLD scrape_generic did, by hand,
per site (url_tpl, needs_proxy):
    1. url = url_tpl.format(q=_q(part))
    2. launch(headless, humanize, [proxy if needs_proxy]); direct sites strip the
       HTTP(S)_PROXY env so Chromium goes machine-direct.
    3. p.goto(url, wait_until="domcontentloaded", timeout=wait*1000)  (swallow)
    4. p.wait_for_timeout(4000)                  — 4s settle (NOT the 6s 'none' default)
    5. text = " ".join((inner_text("body") or "").split())[:max_chars]
    6. blocked = bool(BLOCK_PAT.search(text[:3000]))
       hit = (not blocked) and (part.lower() in text.lower())
    7. return {platform, url, text, hit, blocked}  — RAW text, NOT structured.

Faithful relocation into the 3-layer engine:
    - mode='dom': the engine (L2 navigate) does the single goto + the generic
      BLOCK_PAT check and reports blocked via meta -> Row.blocked. We use the
      'none' profile (single goto, generic BLOCK_PAT, no retry, no warmup) and
      override settle_wait_ms=4000 to match the old 4s wait_for_timeout (the
      'none' default is 6000).
    - NO min_body_len (old code had none — block purely on BLOCK_PAT).
    - block_resources stays profile default (False) — old code did no route
      interception.
    - needs_proxy mirrors the old per-site flag. The old direct=True env-strip is
      the engine's machine-direct bucket (needs_proxy=False); L1 owns that bucket,
      so direct sites simply register needs_proxy=False.

NOTE: the old code computed a `hit` flag (part.lower() in text.lower()) and
returned it alongside `blocked`. The L3 Row has no `hit` field; we port the body
dump faithfully (text -> note) and compute the same hit value into in_stock as a
faithful relocation of the old boolean (None when no hit, matching old falsy hit
not implying known-OOS). blocked is set by the engine. We DO NOT re-select or
improve extraction — this is a raw SSR text dump for the Agent to read.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row  # noqa: E402
from engine import q  # noqa: E402

MAINTENANCE_PAT = re.compile(
    r"(temporarily offline|scheduled maintenance|planned system upgrade|"
    r"site enhancements in progress|currently unavailable|we[’']ll be back soon|"
    r"performing (?:some )?maintenance|back online shortly)",
    re.I,
)


def _availability_status(site: str, final_url: str, text: str) -> str | None:
    if MAINTENANCE_PAT.search(text[:4000]):
        return "maintenance"
    if site == "future" and "error500" in final_url.lower():
        return "maintenance"
    return None


def make_generic(site: str, url_tpl: str, needs_proxy: bool) -> Adapter:
    """Build one GENERIC dom adapter from the old (url_tpl, needs_proxy) row.

    url_tpl uses the OLD literal template verbatim (its own query-param name,
    e.g. tme `queryPhrase`, szlcsc `k`, rs-* `searchTerm`); {q} -> percent-encoded
    part."""

    def url(part: str, _tpl: str = url_tpl) -> str:
        return _tpl.format(q=q(part))

    async def extract(page: Any, part: str, _site: str = site, _url: Callable = url) -> list[Row]:
        # Old: text = " ".join((inner_text("body") or "").split()); sliced [:4000].
        try:
            text = " ".join(((await page.inner_text("body")) or "").split())
        except Exception:
            text = ""
        try:
            final_url = page.url
        except Exception:
            final_url = _url(part)
        # Old: hit = (not blocked) and (part.lower() in text.lower()). blocked is
        # owned by the engine here; we port the part-in-text test faithfully.
        hit = part.lower() in text.lower()
        availability_status = _availability_status(_site, final_url, text)
        return [Row(
            part=part,
            platform=_site,
            product_url=final_url,
            note=(text[:4000] or "（空白页/未渲染——可能 SPA 未加载或需代理）"),
            in_stock=True if hit else None,
            availability_status=availability_status,
        )]

    return Adapter(
        id=site,
        tier="more",
        mode="dom",
        needs_proxy=needs_proxy,
        url=url,
        extract=extract,
        # 'none' profile = single goto + generic BLOCK_PAT + no retry/warmup.
        # Override only settle to the old 4s (vs the 6s 'none' default); NO
        # min_body_len, block_resources stays default False.
        defense=Defense(profile="none", settle_wait_ms=4000),
    )
