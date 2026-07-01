#!/usr/bin/env python3
"""ICKey / 云汉芯城 替代料 adapter — mode=xhr, match_xhr='ajax-get-replace-product'.
Ported from legacy core platform scripts/cloak_search.py (scrape_ickey_replace
+ _ickey_replace_line).

云汉原生替代料接口 ajax-get-replace-product —— 给一个型号返回替代/相似料候选.
The old script intercepted the `ajax-get-replace-product` response and pulled
result.replace_products[*]. The engine now does the interception (xhr mode +
match_xhr) and feeds the parsed JSON straight to extract(). 境内直连，无需登录、无需代理.

host_key shared with the `ickey` adapter (search.ickey.cn) so the two 云汉 hits run
站内串行.

Lifted byte-faithfully from _ickey_replace_line: nums/rmb laddered into structured
price_breaks (first 5 tiers), short_desc -> description, t_cate_name_cn_v2 ->
category, data_sheet[0] -> datasheet.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402


def _breaks(prod: dict) -> list:
    """Structured port of _ickey_replace_line's nums/rmb zip (first 5 tiers).
    NOTE: old code only laddered rmb (no usd) for replace rows — preserved as-is."""
    nums = prod.get("nums") or []
    rmb = prod.get("rmb") or []
    out = []
    for i, qty in enumerate(nums[:5]):
        try:
            qi = int(qty)
        except (TypeError, ValueError):
            continue
        out.append(make_break(
            qi,
            rmb=rmb[i] if i < len(rmb) else None,
        ))
    return out


def _row(prod: dict, part: str) -> Row:
    stock = prod.get("stock")
    try:
        stock_i = int(stock) if stock is not None else None
    except (TypeError, ValueError):
        stock_i = None
    ds = prod.get("data_sheet") or []
    return Row(
        part=part,
        platform="ickey-replace",
        mpn=prod.get("pro_name") or prod.get("pro_sno"),
        stock=stock_i,
        in_stock=(stock_i > 0) if stock_i is not None else None,
        price_breaks=_breaks(prod),
        lead_time=prod.get("lead_time_cn"),
        datasheet=ds[0] if ds else None,
        description=prod.get("short_desc"),               # 规格摘要，用于跟原型号对比
        category=prod.get("t_cate_name_cn_v2"),           # 品类
    )


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    seen_keys: set = set()
    for prod in (payload.get("result") or {}).get("replace_products") or []:
        r = _row(prod, part)
        key = (r.mpn, r.stock, r.description)
        if key in seen_keys:      # de-dup like old dict.fromkeys
            continue
        seen_keys.add(key)
        rows.append(r)
    return rows


ADAPTER = Adapter(
    id="ickey-replace",
    tier="core",
    mode="xhr",
    needs_proxy=False,                                  # 境内直连
    match_xhr="ajax-get-replace-product",
    url=lambda part: f"https://search.ickey.cn/?keyword={q(part)}&bom_ab=null",
    extract=extract,
    host_key="search.ickey.cn",                         # 与 ickey 共享 -> 站内串行
)
