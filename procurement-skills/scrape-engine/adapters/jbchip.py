#!/usr/bin/env python3
"""京北通宇电子元器件商城 (jbchip.com) adapter — mode=script, direct (no proxy).
Ported from legacy extended-source cloak_search.py
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

  Structure: the captured JSON records are now mapped into Row fields
  (mpn/brand/package/stock/price/product_url) instead of being flattened into
  note text.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.jbchip.com/ProductDetailSearch?keywords={q(part)}&searchFieldType=0"


def _num(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    m = re.search(r"[\d,.]+", value)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _stock(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    m = re.search(r"[\d,]+", value)
    if not m:
        return None
    try:
        return int(m.group(0).replace(",", ""))
    except ValueError:
        return None


async def extract(ctx: Any, part: str) -> list[Row]:
    """script-mode extract: ctx is a ScriptCtx (live warmed Page + helpers).
    Wire the /api/item/goods/v1/ sniffer BEFORE the first goto, then drive the
    two-hop nav (root -> result) exactly as the old scrape_jbchip did, parsing
    each captured response with the lifted line-formatting logic."""
    page = ctx.page
    result_url = url(part)
    rows: list[Row] = []
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
                stock = _stock(rec.get("goodsNumber") or rec.get("ty_mall_goods_number"))
                price = rec.get("stepMinPrices") or ""
                if not price:
                    dp = rec.get("discountPrice") or {}
                    if dp:
                        price = str(min(dp.values(), key=lambda x: float(x) if x else 9999))
                price_num = _num(price)
                pluid = rec.get("pluid") or rec.get("ty_mall_goods_id") or ""
                link = f"https://www.jbchip.com/ProductDetail/{pluid}" if pluid else result_url
                model = rec.get("goodsName") or rec.get("pro_name") or rec.get("model")
                brand = rec.get("brandName") or rec.get("brand_name")
                package = rec.get("封装") or rec.get("pack")
                if model or brand or stock is not None or price_num is not None:
                    rows.append(Row(
                        part=part,
                        platform="jbchip",
                        mpn=model or None,
                        brand=brand or None,
                        package=package or None,
                        stock=stock,
                        in_stock=(stock > 0) if stock is not None else None,
                        price_breaks=[make_break(1, rmb=price_num)] if price_num is not None else [],
                        product_url=link,
                    ))
        except Exception:
            pass

    uniq: dict[tuple, Row] = {}
    for row in rows:
        uniq.setdefault((row.mpn, row.brand, row.package, row.stock, row.product_url), row)
    return list(uniq.values()) or [
        Row(part=part, platform="jbchip", product_url=result_url,
            availability_status="no_result", note="（无命中）")
    ]


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
