#!/usr/bin/env python3
"""MISUMI 米思米中国 FA 机械件搜索 adapter — mode=xhr, match_xhr='appsearch/app_search'.
Ported from legacy extended-source cloak_search.py
(scrape_misumi + _misumi_line).

The old script intercepted the `appsearch/app_search` XHR (only when the URL also
carried `field=@search`) and walked d['data']['seriesList'][*], flattening each
series into a pipe string via _misumi_line. The engine now does the interception
(xhr mode + match_xhr); extract() receives the parsed JSON of the first matched
response. 境内直连，无需代理.

NOTE: old extract gated on BOTH 'appsearch/app_search' in url AND 'field=@search'
in url. The engine only matches the first substring; the `field=@search` clause is
expressed by appending it to the search URL so the matched XHR carries it. We keep
_misumi_line's exact field selection but emit structured Row fields instead of a
pipe string (lead_time/stock/etc), per the L3 rewrite goal.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402


def _norm(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _related(part: str, value: str | None) -> bool:
    p = _norm(part)
    v = _norm(value)
    if not p or not v:
        return False
    if len(p) < 4 or len(v) < 4:
        return p == v
    return p in v or v in p or p.lstrip("0") in v.lstrip("0") or v.lstrip("0") in p.lstrip("0")


def _row(s: dict, part: str) -> Row:
    # byte-faithful field selection from _misumi_line
    cats = s.get("categoryList") or []
    cat = (cats[-1].get("categoryName") if cats else "") or s.get("categoryName") or ""
    mn, mx = s.get("minStandardDaysToShip"), s.get("maxStandardDaysToShip")
    days = ""
    if mn is not None and mx is not None:
        days = f"交期{mx}天" if mn == mx else f"交期{mn}-{mx}天"
    url = s.get("seriesUrl") or ""
    if url.startswith("/"):
        url = "https://www.misumi.com.cn" + url
    mpn = s.get("seriesName") or s.get("seriesCode") or ""
    # 现货 flag -> in_stock (old line only emitted the literal "现货")
    in_stock = True if s.get("stockItemFlag") == "1" else None
    # 起订 minPiecesPerPackage -> stock (old line: f"起订{...}"; not a stock count,
    # but FA 系列级无单价/无库存计数, this is the only quantity field — NOTE: this is
    # the MOQ, ported as-is into stock per byte-faithful field set).
    moq = s.get("minPiecesPerPackage")
    note_bits = []
    if days:
        note_bits.append(days)
    if moq:
        note_bits.append(f"起订{moq}")
    return Row(
        part=part,
        platform="misumi",
        mpn=mpn,
        brand=s.get("brandName") or None,
        category=cat or None,
        in_stock=in_stock,
        lead_time=days or None,
        product_url=url or None,
        note=" | ".join(note_bits) or None,
    )


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    seen: set = set()
    for s in (payload.get("data") or {}).get("seriesList") or []:
        r = _row(s, part)
        if not (
            _related(part, r.mpn)
            or _related(part, s.get("seriesCode"))
            or _related(part, s.get("partNumber"))
            or _related(part, s.get("brandName"))
        ):
            continue
        key = (r.mpn, r.brand, r.product_url)
        if key in seen:                 # de-dup like old dict.fromkeys
            continue
        seen.add(key)
        rows.append(r)
    return rows


ADAPTER = Adapter(
    id="misumi",
    tier="more",
    mode="xhr",
    needs_proxy=False,                  # 境内直连
    match_xhr="appsearch/app_search",
    url=lambda part: f"https://www.misumi.com.cn/vona2/result/?Keyword={q(part)}&field=@search",
    extract=extract,
    host_key="www.misumi.com.cn",
    exclusive=True,
)
