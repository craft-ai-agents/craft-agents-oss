#!/usr/bin/env python3
"""RS 美区（=原 Allied）adapter — mode=xhr, match_xhr='groupby/search/endpoint'.
Ported from legacy extended-source cloak_search.py
(scrape_rs_us + _rsus_line).

Magento + GroupBy 搜索 API + DataDome 反爬。旧脚本拦 `groupby/search/endpoint`
响应取 `.records`；DataDome 间歇拦截，靠 re-goto 重试至 3 次（无首页预热）。引擎
现在负责拦截（xhr mode + match_xhr）并把解析后的 JSON 直接喂给 extract()。
需住宅代理（境外+反爬）——仅生产带 mihomo 时可用。

旧 _rsus_line 把字段拍平成 pipe 串；这里把同样的字段（同一个 at() 取数逻辑）
按字节忠实地搬进 typed Row 字段，不重新挑选、不"改进"。
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from engine import q  # noqa: E402


def _row(rec: dict, part: str) -> Row:
    """Byte-faithful port of _rsus_line's allMeta/attributes plucking."""
    m = rec.get("allMeta") or {}
    attrs = m.get("attributes") or {}

    def at(k):
        v = attrs.get(k) or {}
        t = v.get("text") or v.get("numbers") or []
        return t[0] if t else None

    eid = at("entity_id")
    stock = at("additional_inventory")
    price = (m.get("priceInfo") or {}).get("price")

    # NOTE: old code only stored stock as the string "库存{stock}"; we keep the
    # raw value and coerce to int when possible, else leave None (no re-select).
    try:
        stock_i = int(stock) if stock not in (None, "") else None
    except (TypeError, ValueError):
        stock_i = None

    return Row(
        part=part,
        platform="rs-us",
        mpn=at("manufacturer_part_number") or None,
        brand=(m.get("brands") or [""])[0] or None,
        description=(rec.get("_t") or "")[:60] or None,
        stock=stock_i,
        in_stock=(stock_i > 0) if stock_i is not None else None,
        price_breaks=[make_break(1, usd=price)] if price else [],
        product_url=(f"https://us.rs-online.com/web/p/products/{eid}" if eid else None),
    )


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    # old: (r.json() or {}).get("records") or []
    return [_row(rec, part) for rec in (payload.get("records") or [])]


ADAPTER = Adapter(
    id="rs-us",
    tier="more",
    mode="xhr",
    needs_proxy=True,                                   # 住宅代理（境外+反爬）
    match_xhr="groupby/search/endpoint",
    url=lambda part: f"https://us.rs-online.com/catalogsearch/result/?q={q(part)}",
    extract=extract,
    # DataDome: re-goto retry up to 3, NO homepage warmup. settle 5000ms per old.
    defense=Defense(profile="datadome", warmup_url=None, retries=3,
                    settle_wait_ms=5000),
    host_key="us.rs-online.com",
)
