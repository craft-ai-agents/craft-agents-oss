#!/usr/bin/env python3
"""MISUMI Japan (米思米日本) adapter — mode=xhr, match_xhr='/api/v1/series/search'.
Ported from legacy extended-source cloak_search.py
(scrape_misumi_jp).

FA 机械件搜索：关键词/系列号→可配置系列。旧脚本拦 /api/v1/series/search XHR，
顶层直接是 seriesList[]（与中国站不同，无嵌套 data）。归一化逻辑（系列名/品牌/品类/
交期/现货/起订/链接）逐字搬运。

needs_proxy: 旧注释——境内机房 IP 实测可直连，故此处 needs_proxy=False（direct now）。
NOTE: 机房 IP 被旧脚本标 🔒 需住宅代理生产验证；生产若被拦需切 needs_proxy=True。

旧脚本把每个 series 拼成 pipe 字符串后去重截断。这里保留 pipe 字符串于 note（与旧 text
逐字一致），同时把可直接对应的字段映射到 typed 字段。
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    seen: set = set()
    for s in payload.get("seriesList") or []:
        series_code = s.get("seriesCode") or ""
        series_name = s.get("seriesName") or series_code
        brand_name = s.get("brandName") or ""
        cat = s.get("categoryName") or ""
        if not cat:
            cat_list = s.get("categoryList") or []
            if cat_list:
                cat = cat_list[-1].get("categoryName", "")
        mn, mx = s.get("minStandardDaysToShip"), s.get("maxStandardDaysToShip")
        days = ""
        if mn is not None and mx is not None:
            days = f"交期{mx}天" if mn == mx else f"交期{mn}-{mx}天"
        stock = "现货" if s.get("stockItemFlag") == "1" else ""
        min_pkg = s.get("minPiecesPerPackage")
        moq = f"起订{min_pkg}个" if min_pkg and min_pkg > 1 else ""
        series_url = (f"https://jp.misumi-ec.com/vona2/detail/{series_code}/"
                      if series_code else "")
        row = " | ".join(x for x in [series_name, brand_name, cat, days, stock, moq, series_url] if x)
        if not row:
            continue
        if row in seen:  # de-dup like old dict.fromkeys
            continue
        seen.add(row)
        rows.append(Row(
            part=part,
            platform="misumi-jp",
            mpn=series_name,
            brand=brand_name or None,
            category=cat or None,
            in_stock=(s.get("stockItemFlag") == "1") or None,
            lead_time=days or None,
            product_url=series_url or None,
            note=row,
        ))
    return rows


def url(part: str) -> str:
    return f"https://jp.misumi-ec.com/vona2/result/?Keyword={q(part)}"


ADAPTER = Adapter(
    id="misumi-jp",
    tier="more",
    mode="xhr",
    needs_proxy=False,                          # 境内直连 (direct now); 生产被拦再切 proxy
    match_xhr="/api/v1/series/search",
    url=url,
    extract=extract,
    host_key="jp.misumi-ec.com",
)
