#!/usr/bin/env python3
"""TTI (德州 TTI Inc, sager 源头) adapter — mode=dom, needs_proxy, PerimeterX
Press&Hold warmup.
Ported from procurement-platform-search-more/scripts/cloak_search.py
(scrape_tti) byte-faithfully.

  Old scrape_tti did, by hand:
    1. search = tti.com/.../part-search.html?q=<part>;
    2. launch(proxy=MIHOMO);
    3. warmup goto https://www.tti.com/ + 4s dwell
       (首页不弹验证，让 PX 种 cookie);
    4. goto search URL + 3s dwell (过验证后服务端渲染);
    5. text = body inner_text; blocked = BLOCK_PAT.search(text[:3000]);
       hit = (not blocked) and (part.lower() in text.lower());
    6. returns rendered body text for the agent to read.

  Faithful relocation onto the 3-layer engine:
    - profile='perimeterx' owns warmup/retries/fresh-browser/PX block_pat.
    - warmup_url=https://www.tti.com/ + warmup_wait_ms=4000 (old: 4s homepage dwell).
    - settle_wait_ms=3000 (old: 3s after search goto — NOT avnet's 6s).
    - NO min_body_len override: scrape_tti had no <80-char block clause
      (that clause was avnet-only); inherit profile default (off).
    - block_resources stays the profile default (False = zero route interception),
      mirroring the old code's lack of any route interception.

  NOTE: the old `hit = (not blocked) and (part in text)` part-in-text check is
  not represented as a structured field here — dom-mode body-dump puts RAW text
  in Row.note and leaves structured fields None per the contract. The block flag
  is stamped by the engine from BLOCK_PAT. Ported as-is, no structured parsing.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.tti.com/content/ttiinc/en/apps/part-search.html?q={q(part)}"


async def extract(page: Any, part: str) -> list[Row]:
    """dom-mode extract: payload is the live async Page, already warmed/retried/
    settled by engine.navigate(). Old scrape_tti handed the rendered body text to
    the agent; preserve that exactly — emit ONE Row carrying the rendered text in
    `note` plus the final URL."""
    try:
        text = " ".join((await page.inner_text("body") or "").split())
    except Exception:
        text = ""
    try:
        final_url = page.url
    except Exception:
        final_url = url(part)
    return [Row(part=part, platform="tti", product_url=final_url,
                note=text[:4000] or "(空白页——PerimeterX 预热可能失败)")]


ADAPTER = Adapter(
    id="tti",
    tier="more",
    mode="dom",
    needs_proxy=True,                       # 老代码 launch(proxy=MIHOMO)，住宅代理
    url=url,
    extract=extract,
    defense=Defense(
        profile="perimeterx",
        warmup_url="https://www.tti.com/",
        warmup_wait_ms=4000,                # old: 4s after homepage
        settle_wait_ms=3000,                # old: 3s after search goto
    ),
    host_key="www.tti.com",
)
