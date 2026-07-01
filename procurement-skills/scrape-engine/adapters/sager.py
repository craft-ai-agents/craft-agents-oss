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
     inv_items by sku.repositoryId; emit structured Row fields;
  6. dedup, then a RELEVANCE CHECK: normalize part to [a-z0-9] and require it to
     appear in a line — Sager returns default recommendations on no match, so
     lines that don't contain the query are treated as "no此料" (hit=False).

The script-mode engine warms the page (none profile here = no warmup) but does
NOT navigate; this adapter owns the goto so the response sniffers are installed
first. The old hit/relevance verdict is preserved, but the captured in-page JSON
is now mapped into typed Row fields instead of a pipe-joined note blob.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.sager.com/search?keyword={q(part)}"


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


def _int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if not isinstance(value, str):
        return None
    digits = re.sub(r"\D", "", value)
    return int(digits) if digits else None


def _price_breaks(pdata: dict, list_price: Any) -> list[dict]:
    tiers = (((pdata.get("listVolumePrice") or {}).get("bulkPrice") or {}).get("levels") or [])
    breaks: list[dict] = []
    for idx, tier in enumerate(tiers):
        if not isinstance(tier, dict):
            continue
        qty = (
            _int(tier.get("levelMinimum"))
            or _int(tier.get("minimumQuantity"))
            or _int(tier.get("quantity"))
            or (1 if idx == 0 else None)
        )
        price = _num(tier.get("price"))
        if qty is None or price is None:
            continue
        breaks.append(make_break(qty, usd=price))
    if breaks:
        return breaks
    price = _num(list_price)
    return [make_break(1, usd=price)] if price is not None else []


async def extract(ctx: Any, part: str) -> list[Row]:
    page = ctx.page
    search_url = url(part)
    rows: list[Row] = []
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

        inv_loc = inv_items.get(sku_id, {})
        in_stock_qty = _int((inv_loc.get("inStock") or {}).get("stockLevel"))
        note_bits: list[str] = []
        for loc_id in ("onOrder", "factoryStock"):
            qty = _int((inv_loc.get(loc_id) or {}).get("stockLevel"))
            if qty:
                note_bits.append(f"{loc_id}={qty}")
        if in_stock_qty is None:
            mapped_inv = ga("mappedInventory")
            stock_status = ga("product.stock_status")
            if mapped_inv:
                note_bits.append(f"mappedInventory={mapped_inv}")
            if stock_status:
                note_bits.append(f"stock_status={stock_status}")
        prod_url = f"https://www.sager.com{route}" if route else search_url
        rows.append(Row(
            part=part,
            platform="sager",
            mpn=ga("product.displayName") or None,
            brand=ga("product.manufacturer_name") or None,
            stock=in_stock_qty,
            in_stock=(in_stock_qty > 0) if in_stock_qty is not None else None,
            price_breaks=_price_breaks(pdata, list_price),
            lead_time=ga("product.lead_time_message") or None,
            product_url=prod_url,
            note="; ".join(note_bits) or None,
        ))

    deduped = list({
        (row.mpn, row.brand, row.stock, row.product_url): row
        for row in rows
        if row.mpn or row.brand or row.stock is not None or row.price_breaks
    }.values())[:limit]
    norm = re.sub(r"[^a-z0-9]", "", part.lower())
    relevant = [
        row for row in deduped
        if norm and norm in re.sub(
            r"[^a-z0-9]", "",
            " ".join(x for x in [row.mpn, row.brand, row.product_url] if x).lower(),
        )
    ]
    if deduped and not relevant:
        return [Row(part=part, platform="sager", product_url=search_url,
                    availability_status="no_result",
                    note="（Sager 无精确匹配，返回的是默认推荐，判无此料）")]
    if not relevant:
        return [Row(part=part, platform="sager", product_url=search_url,
                    availability_status="no_result", note="（无命中）")]
    return relevant


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
