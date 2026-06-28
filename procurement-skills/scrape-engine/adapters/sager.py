#!/usr/bin/env python3
"""Sager Electronics (电源/连接器/机电) adapter — mode=script, direct (no proxy).
Ported from legacy extended-source cloak_search.py
(scrape_sager). Byte-faithful relocation of the OLD extraction logic; NOT
re-selected or "improved" this round.

Old scrape_sager did, by hand:
  1. launch(headless=True, humanize=True)  — NO proxy kwarg → machine-direct;
  2. new_page, attach p.on("response", on_resp) capturing TWO ccstore XHR
     families (ccstore/v1/inventories → inv_items keyed by skuNumber;
     ccstore/v1/prices/skus → price_items keyed by sku_id), filtered to
     content-type containing "json";
  3. goto search URL (domcontentloaded) + 5s dwell — the data XHR fire on this
     FIRST navigation, which is exactly why this is a script adapter (we wire
     ctx.on_response BEFORE the first goto);
  4. p.evaluate window.state.searchRepository → first page's results.records;
  5. for each record (up to limit): pull attrs via ga(); join price_items /
     inv_items by sku.repositoryId; build a pipe-joined display line;
  6. dedup, then a RELEVANCE CHECK: normalize part to [a-z0-9] and require it to
     appear in a line — Sager returns default recommendations on no match, so
     lines that don't contain the query are treated as "no此料" (hit=False).

The script-mode engine warms the page (none profile here = no warmup) but does
NOT navigate; this adapter owns the goto so the response sniffers are installed
first. Because this is a body/line scrape joined from in-page XHR JSON, the
result is emitted as RAW lines in Row.note (NOT per-row structured fields) —
faithful to the old {"text": ...} blob. The old hit/relevance verdict is
preserved verbatim in the note text.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.sager.com/search?keyword={q(part)}"


async def extract(ctx: Any, part: str) -> list[Row]:
    page = ctx.page
    search_url = url(part)
    lines: list[str] = []
    inv_items: dict = {}
    price_items: dict = {}
    limit = 8  # old `limit` arg; engine script-mode passes no limit, keep a sane cap

    # Wire the TWO ccstore XHR sniffers BEFORE the first goto (their JSON fires on
    # initial navigation — the whole reason this is a script adapter).
    get_inv = ctx.on_response("ccstore/v1/inventories")
    get_price = ctx.on_response("ccstore/v1/prices/skus")

    # ① first (and only) goto — the search page; data XHR fire here. 5s dwell.
    await ctx.goto(search_url)
    await page.wait_for_timeout(5000)

    # Drain captured responses into inv_items / price_items, mirroring old on_resp
    # (filtered to JSON content-type; per-response .json() failures swallowed).
    for r in get_inv():
        try:
            if "json" not in (r.headers.get("content-type", "") or ""):
                continue
            for item in (await r.json()).get("items", []):
                inv_items[item.get("skuNumber", "")] = {
                    loc["locationId"]: loc for loc in item.get("locationInventoryInfo", [])
                }
        except Exception:
            pass
    for r in get_price():
        try:
            if "json" not in (r.headers.get("content-type", "") or ""):
                continue
            for item in (await r.json()).get("items", []):
                if isinstance(item, dict):
                    for sku_id, pdata in item.items():
                        price_items[sku_id] = pdata
        except Exception:
            pass

    recs_raw = await page.evaluate("""() => {
        try {
            const sr = window.state && window.state.searchRepository;
            if (!sr) return '[]';
            const page = Object.values(sr.pages || {})[0];
            return JSON.stringify((page && page.results && page.results.records) || []);
        } catch(e) { return '[]'; }
    }""")
    records = json.loads(recs_raw)

    for rec in records[:limit]:
        attrs = rec.get("attributes", {})

        def ga(key, default="", _attrs=attrs):
            v = _attrs.get(key)
            return v[0] if isinstance(v, list) and v else default

        sku_id = ga("sku.repositoryId")
        route = ga("product.route")
        pdata = price_items.get(sku_id, {})
        list_price = pdata.get("listPrice") or ga("sku.minActivePrice")
        tiers = pdata.get("listVolumePrice", {}).get("bulkPrice", {}).get("levels", [])

        inv_loc = inv_items.get(sku_id, {})
        stock_parts = []
        for loc_id, label in [("inStock", "现货"), ("onOrder", "在途"), ("factoryStock", "工厂库存")]:
            qty = inv_loc.get(loc_id, {}).get("stockLevel", 0) or 0
            if qty:
                stock_parts.append(f"{label}{qty}")
        if not stock_parts:
            mapped_inv = ga("mappedInventory")
            stock_parts = [mapped_inv] if mapped_inv else [ga("product.stock_status") or "缺货"]

        price_str = f"${list_price}" if list_price else "价格登录可见"
        if tiers:
            price_str = f"${tiers[0].get('price')} (1-{tiers[0].get('levelMaximum')}件起)"

        prod_url = f"https://www.sager.com{route}" if route else search_url
        line_parts = [x for x in [ga("product.displayName"), ga("product.manufacturer_name"),
                                  price_str, " | ".join(stock_parts),
                                  ga("product.lead_time_message"), prod_url] if x]
        lines.append(" | ".join(line_parts))

    uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
    norm = re.sub(r"[^a-z0-9]", "", part.lower())
    relevant = [l for l in uniq if norm and norm in re.sub(r"[^a-z0-9]", "", l.lower())]
    if uniq and not relevant:
        return [Row(part=part, platform="sager", product_url=search_url,
                    note="（Sager 无精确匹配，返回的是默认推荐，判无此料）")]
    return [Row(part=part, platform="sager", product_url=search_url,
                note="\n".join(relevant) or "（无命中）")]


ADAPTER = Adapter(
    id="sager",
    tier="more",
    mode="script",
    needs_proxy=False,                      # old: launch() with NO proxy kwarg → direct
    url=url,
    extract=extract,
    defense=None,                           # old: plain launch, no warmup/PX dance → 'none' profile
    host_key="www.sager.com",
)
