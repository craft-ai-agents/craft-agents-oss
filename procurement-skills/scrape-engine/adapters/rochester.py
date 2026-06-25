#!/usr/bin/env python3
"""Rochester Electronics (rocelec.com) adapter — mode=script, direct (no proxy).

Ported from procurement-platform-search-more/scripts/cloak_search.py
(scrape_rochester). Rochester is an EOL/停产 半导体官方授权源 fronted by a
Salesforce Commerce (webruntime) backend. The old scraper drove a 4-hop flow by
hand inside a single warmed page:

    1. goto homepage (rocelec.com/) to seed the Salesforce guest session;
    2. in-page fetch POST product-search -> list of products (id/name/sku/desc/urlName);
    3. for the first 5 product ids, concurrently in-page fetch the product detail
       endpoint (datasheet/stock/mfr) AND the pricing endpoint (first tier unit price);
    4. join details+prices back onto the product list and pipe-join one line/product.

script mode is the right shape: the data comes from same-origin in-page fetch
calls (avoids CORS) that MUST run after the homepage goto seeds the SF session,
and there are multiple concurrent hops. defense=None (the old code did a plain
launch with no anti-bot warmup/retry); needs_proxy=False (old code: direct,
机房 IP 实测可达 — no proxy was used).

This is a body/text-dump style port: the joined pipe-lines go into Row.note,
exactly mirroring the old {"text": "\\n".join(lines)} return. Per the contract,
extraction correctness is NOT re-verified this round — the JS is lifted
byte-faithfully from the old p.evaluate blocks.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402

# --- Rochester / Salesforce Commerce endpoints (lifted verbatim) ---
_ROC_WEBSTORE = "0ZE4w0000008UotGAE"
_ROC_BASE = "https://www.rocelec.com"
_ROC_SEARCH_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                  f"/search/product-search?language=en-US&asGuest=true&htmlEncode=false")
_ROC_PRODUCT_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                   f"/products/{{id}}?language=en-US&asGuest=true&htmlEncode=false")
_ROC_PRICE_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                 f"/pricing/products/{{id}}?language=en-US&asGuest=true&htmlEncode=false")

# old default limit lived in the CLI (limit=5 by default); the old detail/price
# fan-out was hard-capped at the first 5 ids regardless. We keep _LIMIT here so the
# script's [:limit] slices match; tune via env if ever needed.
_LIMIT = int(os.environ.get("ROCHESTER_LIMIT", "5"))


def url(part: str) -> str:
    return f"{_ROC_BASE}/search?q={q(part)}"


async def extract(ctx: Any, part: str) -> list[Row]:
    page = ctx.page
    result_url = url(part)
    limit = _LIMIT
    lines: list[str] = []

    # hop 1: homepage goto to seed the Salesforce guest session, then 2s dwell.
    # ctx.goto swallows nav timeouts (old code wrapped goto in try/except + 2s wait).
    await ctx.goto(_ROC_BASE + "/")
    await page.wait_for_timeout(2000)

    # hop 2: in-page fetch POST product-search (same-origin, avoids CORS).
    # JS lifted byte-faithfully from the old p.evaluate block.
    search_result = await page.evaluate(
        """async (args) => {
            const {searchTerm, pageSize} = args;
            try {
                const r = await fetch('""" + _ROC_SEARCH_EP + """', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
                    body: JSON.stringify({searchTerm, pageSize, page: 0})
                });
                const data = await r.json();
                return {ok: r.status < 300, total: data?.productsPage?.total ?? 0,
                    products: (data?.productsPage?.products ?? []).map(pr => ({
                        id: pr.id, name: pr.name,
                        sku: pr.fields?.StockKeepingUnit?.value ?? pr.name,
                        desc: pr.fields?.Description?.value ?? '',
                        urlName: pr.urlName ?? ''}))};
            } catch(e) { return {ok: false, error: e.message}; }
        }""",
        {"searchTerm": part, "pageSize": min(limit * 2, 20)},
    )
    if not search_result.get("ok") or not search_result.get("products"):
        return [Row(part=part, platform="rochester", product_url=result_url,
                    note="（无命中）")]

    products = search_result["products"][:limit]
    total = search_result.get("total", 0)
    detail_ids = [pr["id"] for pr in products[:5]]

    # hop 3a: concurrent in-page fetch of product detail endpoint (datasheet/stock/mfr).
    details_raw = await page.evaluate(
        """async (ids) => Promise.all(ids.map(async id => {
            const r = await fetch('""" + _ROC_PRODUCT_EP + """'.replace('{id}', id));
            const d = await r.json(); const f = d.fields || {};
            return {id, datasheet: f.DataSheetURL__c ?? null, stock: f.StockingOptions__c ?? null,
                     mfr: f.Manufacturer__c ?? null};
        }))""", detail_ids)
    details = {d["id"]: d for d in (details_raw or [])}

    # hop 3b: concurrent in-page fetch of pricing endpoint (first tier unit price).
    prices_raw = await page.evaluate(
        """async (ids) => Promise.all(ids.map(async id => {
            const r = await fetch('""" + _ROC_PRICE_EP + """'.replace('{id}', id));
            const d = await r.json();
            const t = d?.priceAdjustment?.priceAdjustmentTiers ?? [];
            return {id, price: t.length ? t[0].tierUnitPrice : null};
        }))""", detail_ids)
    prices = {pr["id"]: pr for pr in (prices_raw or [])}

    for prod in products:
        pid = prod["id"]
        det = details.get(pid, {})
        price_val = prices.get(pid, {}).get("price")
        desc = re.sub(r"<[^>]+>", "", prod.get("desc", "")).strip()
        prod_link = det.get("datasheet") or f"{_ROC_BASE}/product/{prod.get('urlName') or pid}"
        row = " | ".join(x for x in [
            prod["sku"] or prod["name"], det.get("mfr") or "",
            desc[:60] if desc else None, det.get("stock") or "Unknown",
            f"${price_val} USD" if price_val else "询价", prod_link] if x)
        lines.append(row)
    if total > limit:
        lines.append(f"（共 {total} 个型号，显示前 {len(products)} 条）")

    return [Row(part=part, platform="rochester", product_url=result_url,
                note="\n".join(lines) if lines else "（无命中）")]


ADAPTER = Adapter(
    id="rochester",
    tier="more",
    mode="script",
    needs_proxy=False,           # old: direct, 机房 IP 实测可达 — no proxy
    url=url,
    extract=extract,
    defense=None,                # old: plain launch, no anti-bot warmup/retry
    host_key="www.rocelec.com",
)
