#!/usr/bin/env python3
"""OC Pneumatics (Orange Coast Pneumatics, 美国 SMC 气动元件经销) — mode=script.
Ported from legacy extended-source cloak_search.py
(scrape_ocpneumatics), lifted byte-faithfully.

OLD strategy (preserved as-is):
  后端是 Meilisearch (ocp.engine.codicloud.dev), 前端 BigCommerce + Vue "SMC Elite Search".
  打开搜索页 -> 填 input[type=search] + Enter 触发 /multi-search xhr ->
  拦截响应, 检查 request.post_data_buffer 的 queries[].indexUid == ocp_product_index,
  再从响应 results[].hits[] 抽 sku/name/price/availability/inventory_level/url.
  API key 是公开只读 Bearer token (硬编码在 JS bundle 里). 无需代理, 机房 IP 实测可达.

Script-mode relocation: the engine hands a WARMED page but does NOT navigate. We
wire a response sniffer for "engine.codicloud.dev/multi-search" BEFORE the first
goto (the xhr can fire on render), goto the search shell, then fill+Enter to
trigger the meilisearch multi-search, wait, and parse every captured response the
old way. The Meilisearch hits are mapped into structured Row fields.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402

_OCP_BASE = "https://ocpneumatics.com"
_OCP_INDEX = "ocp_product_index"


def url(part: str) -> str:
    return f"{_OCP_BASE}/smc-elite-search/?q={q(part)}"


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


def _norm(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _related(part: str, sku: str | None, name: str | None) -> bool:
    query = _norm(part)
    if not query:
        return False
    haystack = _norm(" ".join(x for x in [sku, name] if x))
    if not haystack:
        return False
    return query in haystack or haystack in query


async def extract(ctx: Any, part: str) -> list[Row]:
    page = ctx.page
    result_url = url(part)
    rows: list[Row] = []

    # Wire the /multi-search sniffer BEFORE the first goto (xhr may fire early).
    get_responses = ctx.on_response("engine.codicloud.dev/multi-search")

    # OLD: goto search shell (swallow timeout) -> 2s -> fill+Enter -> 4s.
    try:
        await ctx.goto(f"{_OCP_BASE}/smc-elite-search/")
    except Exception:
        pass
    await page.wait_for_timeout(2000)
    try:
        await page.fill("input[type='search']", part)
        await page.keyboard.press("Enter")
    except Exception:
        pass
    await page.wait_for_timeout(4000)

    # OLD on_resp logic, lifted byte-faithfully. r.json() is awaited (async API);
    # request.post_data_buffer stays a sync property (bytes) as in old code.
    for r in get_responses():
        try:
            body_bytes = r.request.post_data_buffer
            body_json = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            queries = body_json.get("queries", [])
            if not any(qq.get("indexUid") == _OCP_INDEX and qq.get("q", "") for qq in queries):
                continue
            resp_json = await r.json()
            for result in resp_json.get("results", []):
                if result.get("indexUid") != _OCP_INDEX:
                    continue
                for hit in result.get("hits", []):
                    sku = hit.get("product_sku", "")
                    name = hit.get("product_name", "")
                    if not _related(part, sku, name):
                        continue
                    price = _num(hit.get("calculated_price") or hit.get("price"))
                    avail = hit.get("availability", "")
                    inv = _int(hit.get("inventory_level"))
                    rel_url = hit.get("url", "")
                    full_url = _OCP_BASE + rel_url if rel_url.startswith("/") else rel_url
                    rows.append(Row(
                        part=part,
                        platform="ocpneumatics",
                        mpn=sku or None,
                        description=name or None,
                        stock=inv,
                        in_stock=(inv > 0) if inv is not None else None,
                        price_breaks=[make_break(1, usd=price)] if price is not None else [],
                        product_url=full_url or result_url,
                        note=avail or None,
                    ))
        except Exception:
            pass

    uniq = list({
        (row.mpn, row.description, row.stock, row.product_url): row
        for row in rows
        if row.mpn or row.description or row.stock is not None or row.price_breaks
    }.values())
    if not uniq:
        return [Row(part=part, platform="ocpneumatics", product_url=result_url,
                    availability_status="no_result", note="（OCP 无命中）")]
    return uniq


ADAPTER = Adapter(
    id="ocpneumatics",
    tier="more",
    mode="script",
    needs_proxy=False,                       # 无需代理, 机房 IP 实测可达
    url=url,
    extract=extract,
    defense=Defense(profile="none"),         # 无反爬, 仅需触发 meilisearch xhr
    host_key="ocpneumatics.com",
)
