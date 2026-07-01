#!/usr/bin/env python3
"""连可连 vanlinkon adapter — mode=api, 境内直连(无代理/无浏览器/无 key).

从删掉的 legacy extended-source api_search.py(search_vanlinkon)
港回引擎。连可连是中国连接器商城,api.vanlinkon.com 子域无境外 WAF、纯 HTTP JSON,
多仓报盘(自营/代销/RS)含库存/¥价/交期。

⚠ 强制 trust_env=False:vanlinkon 是境内域,prod 上 HTTP_PROXY 指向 mihomo(海外出口),
若不关会把境内请求误走代理。这里固定直连。

响应:{status:'success', code:200, data:[{name:仓库, products:[{model_number,
  product_id, product_category, specification/product_name, stock, inventory_price,
  delivery_date}]}]}。每个 (仓库×product) 一行,仓库名顶到 Row.platform=f"vanlinkon:{仓库}"。
"""
from __future__ import annotations

import os
import sys
from typing import Any, Optional

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402

TIMEOUT = 12
_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"),
    "Accept": "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.vanlinkon.com/",
}


def _int(v: Any) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _float(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def fetch(part: str, limit: int) -> Any:
    """api_fetch: GET api.vanlinkon.com/api/search, return parsed JSON. trust_env=
    False forces a DIRECT (no-proxy) connection — vanlinkon is a 境内 domain."""
    url = f"https://api.vanlinkon.com/api/search?keyword={q(part)}"
    async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, headers=_HEADERS) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    if payload.get("status") != "success" or payload.get("code") != 200:
        return []
    rows: list[Row] = []
    seen: set = set()
    for wh in payload.get("data") or []:
        wh_name = (wh or {}).get("name") or ""
        for p in wh.get("products") or []:
            if not isinstance(p, dict):
                continue
            model = p.get("model_number") or ""
            pid = p.get("product_id") or ""
            key = (model, wh_name, pid)
            if key in seen:
                continue
            seen.add(key)
            price = _float(p.get("inventory_price"))
            stock = _int(p.get("stock"))
            rows.append(Row(
                part=part,
                platform=f"vanlinkon:{wh_name}" if wh_name else "vanlinkon",
                mpn=model or None,
                brand=p.get("product_category") or None,          # 实测含厂牌(Molex/ST);字段名虽叫 category
                stock=stock,
                in_stock=(stock > 0) if stock is not None else None,
                price_breaks=[make_break(1, rmb=price)] if price is not None else [],
                lead_time=p.get("delivery_date") or None,
                product_url=f"https://www.vanlinkon.com/product/{pid}" if pid else None,
                description=p.get("specification") or p.get("product_name"),
                category=None,                                    # vanlinkon 无独立品类字段
                note=f"via vanlinkon/{wh_name}" if wh_name else "via vanlinkon",
            ))
    return rows


ADAPTER = Adapter(
    id="vanlinkon",
    tier="more",
    mode="api",
    needs_proxy=False,                                   # 境内直连(api_fetch 自己 trust_env=False)
    url=lambda part: f"https://api.vanlinkon.com/api/search?keyword={q(part)}",
    extract=extract,
    api_fetch=fetch,
    host_key="api.vanlinkon.com",
)
