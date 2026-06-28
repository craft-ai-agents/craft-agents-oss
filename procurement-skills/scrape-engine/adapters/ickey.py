#!/usr/bin/env python3
"""ICKey / 云汉芯城 adapter — mode=xhr, match_xhr='ajax-get-res-v002'.
Ported from legacy core platform scripts/cloak_search.py (scrape_ickey +
_ickey_line).

The site renders results via an AJAX call; the old script intercepted the
`ajax-get-res-v002` response and pulled result.group_products[*].products[*].
The engine now does the interception (xhr mode + match_xhr) and feeds the parsed
JSON straight to extract(). 境内直连，无需登录、无需代理.

Crucially: the old _ickey_line flattened nums/rmb/usd into a pipe string. Here we
keep the qty/rmb/usd ladder as structured price_breaks — the whole reason for the
rewrite.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from engine import q  # noqa: E402


def _breaks(prod: dict) -> list:
    """Structured port of _ickey_line's nums/rmb/usd zip (first 6 tiers)."""
    nums = prod.get("nums") or []
    rmb = prod.get("rmb") or []
    usd = prod.get("usd") or []
    out = []
    for i, qty in enumerate(nums[:6]):
        try:
            qi = int(qty)
        except (TypeError, ValueError):
            continue
        out.append(make_break(
            qi,
            rmb=rmb[i] if i < len(rmb) else None,
            usd=usd[i] if i < len(usd) else None,
        ))
    return out


def _row(prod: dict, part: str) -> Row:
    stock = prod.get("stock")
    try:
        stock_i = int(stock) if stock is not None else None
    except (TypeError, ValueError):
        stock_i = None
    return Row(
        part=part,
        platform="ickey",
        mpn=prod.get("pro_name") or prod.get("pro_sno"),
        brand=prod.get("pro_maf") or prod.get("standard_maf"),
        package=prod.get("packaging"),
        stock=stock_i,
        in_stock=(stock_i > 0) if stock_i is not None else None,
        price_breaks=_breaks(prod),
        lead_time=prod.get("lead_time_cn"),
    )


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    seen_keys: set = set()
    for g in (payload.get("result") or {}).get("group_products") or []:
        for prod in g.get("products") or []:
            r = _row(prod, part)
            key = (r.mpn, r.brand, r.stock)
            if key in seen_keys:      # de-dup like old dict.fromkeys
                continue
            seen_keys.add(key)
            rows.append(r)
    return rows


ADAPTER = Adapter(
    id="ickey",
    tier="core",
    mode="xhr",
    needs_proxy=False,                                  # 境内直连
    match_xhr="ajax-get-res-v002",
    url=lambda part: f"https://search.ickey.cn/?keyword={q(part)}&bom_ab=null",
    extract=extract,
    host_key="search.ickey.cn",
)
