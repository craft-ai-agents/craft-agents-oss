#!/usr/bin/env python3
"""京北通宇电子元器件商城 (jbchip.com) adapter — mode=script, direct (no proxy).
Ported from procurement-platform-search-more/scripts/cloak_search.py
(scrape_jbchip), lifted byte-faithfully.

  Old scrape_jbchip did, by hand:
    1. launch(headless, humanize)  — DIRECT, no proxy (境内站, needs_proxy=False);
    2. install a page.on('response') sniffer for '/api/item/goods/v1/' that
       parses each matched JSON and appends formatted ' | '-joined lines;
    3. goto https://www.jbchip.com/  (root, domcontentloaded) — boots the Vue
       Router / SPA shell so the result navigation can fire its XHR;
    4. wait 3000ms;
    5. goto the ProductDetailSearch result URL (domcontentloaded) — fires the
       /api/item/goods/v1/<token> search XHR (token is dynamically encrypted, so
       it can only be intercepted, not constructed);
    6. wait 4000ms;
    7. dedup the captured lines, cap at limit, join with '\n'.

  Why mode=script (not xhr): the data XHR fires on the SECOND navigation, and ONLY
  after the FIRST (root) navigation has booted Vue Router. The plain xhr mode does
  a single goto(search) and would miss it. script mode lets the adapter wire
  ctx.on_response BEFORE its own gotos and drive the two-hop nav itself.

  Structure: this is a BODY-DUMP-style port — the old code produced ' | '-joined
  text lines, not structured fields. We preserve that exactly and put the joined
  text in Row.note (NOT structured per-row fields), per the contract's HONEST
  structure note. The per-record line-formatting (goodsName / brandName / 库存 /
  ¥price / 封装|pack / link, and the price/pluid fallbacks) is lifted verbatim.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.jbchip.com/ProductDetailSearch?keywords={q(part)}&searchFieldType=0"


async def extract(ctx: Any, part: str) -> list[Row]:
    """script-mode extract: ctx is a ScriptCtx (live warmed Page + helpers).
    Wire the /api/item/goods/v1/ sniffer BEFORE the first goto, then drive the
    two-hop nav (root -> result) exactly as the old scrape_jbchip did, parsing
    each captured response with the lifted line-formatting logic."""
    page = ctx.page
    result_url = url(part)
    lines: list[str] = []
    get_captured = ctx.on_response("/api/item/goods/v1/")

    # hop 1: boot Vue Router (old: goto root, 3s dwell)
    await ctx.goto("https://www.jbchip.com/")
    await page.wait_for_timeout(3000)
    # hop 2: fire the search XHR (old: goto result_url, 4s dwell)
    await ctx.goto(result_url)
    await page.wait_for_timeout(4000)

    # parse every captured /api/item/goods/v1/ response — byte-faithful to on_resp
    for r in get_captured():
        try:
            d = await r.json()
            for rec in (d.get("data") or {}).get("records") or []:
                stock = str(rec.get("goodsNumber") or rec.get("ty_mall_goods_number") or 0)
                price = rec.get("stepMinPrices") or ""
                if not price:
                    dp = rec.get("discountPrice") or {}
                    if dp:
                        price = str(min(dp.values(), key=lambda x: float(x) if x else 9999))
                pluid = rec.get("pluid") or rec.get("ty_mall_goods_id") or ""
                link = f"https://www.jbchip.com/ProductDetail/{pluid}" if pluid else result_url
                row = " | ".join(x for x in [
                    rec.get("goodsName") or "", rec.get("brandName") or "",
                    f"库存{stock}", f"¥{price}" if price else "",
                    rec.get("封装") or rec.get("pack") or "", link] if x)
                if row:
                    lines.append(row)
        except Exception:
            pass

    uniq = list(dict.fromkeys(l for l in lines if l))
    return [Row(part=part, platform="jbchip", product_url=result_url,
                note="\n".join(uniq) or "（无命中）")]


ADAPTER = Adapter(
    id="jbchip",
    tier="more",
    mode="script",
    needs_proxy=False,                  # 境内站，直连 (old: launch() no proxy)
    url=url,
    extract=extract,
    defense=None,                       # old code had no warmup wall / no antibot profile
    host_key="www.jbchip.com",
)
