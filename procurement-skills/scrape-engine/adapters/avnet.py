#!/usr/bin/env python3
"""Avnet (安富利) adapter — mode=script, needs_proxy, PerimeterX.

Avnet's results page is a React app: the product grid is rendered client-side
from JSON XHR to apigw.avnet.com, so a DOM body-dump only captured the page
chrome (nav/header) and missed the products entirely. We intercept the three
data XHR instead and join them into STRUCTURED rows:

  - .../api/application/product/search      → Data.Products[]: MPN, brand, MOQ
                                              (QtyMin), and ERPPartNumber = the
                                              SAP material number used to join.
  - .../api/inventory/amer/getinventory     → data[]: sapMaterialNumber → qty.
  - .../api/pricing/amer/getWebResalePricing→ data.text[]: sapMaterialId →
                                              quantityPricingVO[] price ladder.

script-mode because the data spans MULTIPLE XHR that fire on the search
navigation — we wire ctx.on_response() sniffers BEFORE the goto (the engine has
already run the PerimeterX homepage warmup; the adapter owns the goto). Join key
is the SAP material number (ERPPartNumber == sapMaterialNumber == sapMaterialId).
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.avnet.com/americas/products/c/search?search={q(part)}"


def _num(v: Any):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


async def extract(ctx: Any, part: str) -> list[Row]:
    """script-mode: ctx is a warmed ScriptCtx (PX cookie already seeded). Wire the
    three data sniffers, do the one search goto, then join Products × inventory ×
    pricing by SAP material number into structured Rows."""
    page = ctx.page
    search_url = url(part)

    # Wire BEFORE the goto — these fire on the search navigation.
    get_prod = ctx.on_response("application/product/search")
    get_inv = ctx.on_response("getinventory")
    get_price = ctx.on_response("getWebResalePricing")

    await ctx.goto(search_url)
    await page.wait_for_timeout(9000)  # React mounts + fires the data XHR

    # --- products (identity + MOQ + SAP join key) ---
    products: list = []
    prod_seen = False
    for r in get_prod():
        prod_seen = True
        try:
            data = (await r.json()).get("Data") or {}
            ps = data.get("Products") or []
            if ps:
                products = ps
                break
        except Exception:
            pass

    if not prod_seen:
        # The product XHR never fired → PX block or page never rendered.
        return [Row(part=part, platform="avnet", product_url=search_url, blocked=True,
                    note="(avnet 未取到产品数据——可能被反爬拦/未渲染，不代表无货)")]

    # --- inventory: sap -> summed available qty ---
    inv: dict[str, int] = {}
    for r in get_inv():
        try:
            for it in ((await r.json()).get("data") or []):
                sap = it.get("sapMaterialNumber")
                qty = _num(it.get("availableQuantity"))
                if sap and qty is not None:
                    inv[sap] = inv.get(sap, 0) + qty
        except Exception:
            pass

    # --- pricing: sap -> [(qty, usd)] ---
    price: dict[str, list] = {}
    for r in get_price():
        try:
            txt = (((await r.json()).get("data") or {}).get("text")) or []
            for it in txt:
                sap = it.get("sapMaterialId")
                if not sap:
                    continue
                price[sap] = [
                    make_break(_num(pv.get("quantity")) or 0, usd=pv.get("resale"))
                    for pv in (it.get("quantityPricingVO") or [])
                    if pv.get("resale") is not None
                ]
        except Exception:
            pass

    rows: list[Row] = []
    for p in products:
        sap = p.get("ERPPartNumber")
        mpn = p.get("ManufacturerPartNumber") or p.get("ERPMFRPartNumber")
        stock = inv.get(sap)
        moq = _num(p.get("QtyMin"))
        rows.append(Row(
            part=part,
            platform="avnet",
            mpn=mpn,
            brand=p.get("ERPManufacturerName") or p.get("VariantMFRName"),
            stock=stock,
            in_stock=(stock > 0) if isinstance(stock, int) else None,
            price_breaks=price.get(sap, []),
            product_url=search_url,
            description=f"MOQ {moq}" if moq else None,
        ))

    if not rows:
        return [Row(part=part, platform="avnet", product_url=search_url,
                    note="（avnet 无此料——product/search 返回 0 个产品）")]
    return rows


ADAPTER = Adapter(
    id="avnet",
    tier="more",
    mode="script",
    needs_proxy=True,                       # 走住宅代理（PX 直连必挡）
    url=url,
    extract=extract,
    # PerimeterX profile owns warmup/retries/fresh-browser. In script mode the
    # engine runs ONLY the warmup (seed PX cookie), then this adapter owns the goto.
    defense=Defense(
        profile="perimeterx",
        warmup_url="https://www.avnet.com/americas/",
    ),
    host_key="www.avnet.com",
)
