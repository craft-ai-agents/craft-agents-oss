#!/usr/bin/env python3
"""Mouser adapter — mode=api. Ported from legacy core platform scripts/
api_search.py (search_mouser), faithfully:

  - single MOUSER_API_KEY in the query string.
  - POST search/keyword with SearchByKeywordRequest {keyword, records}.
  -海外 API 出口走代理: the old script relied on urllib honoring *_PROXY env;
    here we pass MIHOMO explicitly to httpx (same as the digikey adapter).

Field mapping into the structured Row (NO string flattening): PriceBreaks[0].Price
is parsed into one price break at qty 1. Availability is often free text such as
"1,234 In Stock"; keep the original text in note and coerce the leading quantity
into Row.stock when present.
"""
from __future__ import annotations

import os
import re
import urllib.parse
from typing import Any

import httpx

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402

TIMEOUT = 12
MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")


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


def _stock(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    m = re.search(r"([\d,]+)\s*(?:In\s+Stock|Stock|Available)", value, re.I)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


async def fetch(part: str, limit: int) -> Any:
    """api_fetch: returns the parsed keyword-search JSON dict (the 'payload')."""
    key = os.environ.get("MOUSER_API_KEY")
    if not key:
        raise RuntimeError("缺 MOUSER_API_KEY")
    url = "https://api.mouser.com/api/v1/search/keyword?apiKey=" + urllib.parse.quote(key)
    # mihomo proxy for the overseas API egress (old script used *_PROXY env).
    async with httpx.AsyncClient(timeout=TIMEOUT, proxy=MIHOMO) as client:
        r = await client.post(
            url,
            json={"SearchByKeywordRequest": {"keyword": part, "records": limit}},
            headers={"Content-Type": "application/json"},
        )
        r.raise_for_status()
        out = r.json()
    errs = out.get("Errors") or []
    if errs:
        raise RuntimeError("; ".join(e.get("Message", str(e)) for e in errs))
    return out


def extract(payload: Any, part: str) -> list[Row]:
    rows: list[Row] = []
    limit = len((payload.get("SearchResults") or {}).get("Parts") or [])
    for p in ((payload.get("SearchResults") or {}).get("Parts") or [])[:limit]:
        breaks_raw = p.get("PriceBreaks") or []
        price = _num(breaks_raw[0].get("Price")) if breaks_raw else None
        avail = p.get("Availability")
        stock = _stock(avail)
        rows.append(Row(
            part=part,
            platform="mouser",
            mpn=p.get("ManufacturerPartNumber"),
            brand=p.get("Manufacturer"),
            description=p.get("Description"),
            stock=stock,
            price_breaks=[make_break(1, usd=price)] if price is not None else [],
            datasheet=p.get("DataSheetUrl"),
            product_url=p.get("ProductDetailUrl"),
            in_stock=(stock > 0) if stock is not None else None,
            note=avail if isinstance(avail, str) else None,
        ))
    return rows


ADAPTER = Adapter(
    id="mouser",
    tier="core",
    mode="api",
    needs_proxy=True,                      # overseas egress via mihomo
    url=lambda part: "https://api.mouser.com/api/v1/search/keyword",
    extract=extract,
    api_fetch=fetch,
    host_key="api.mouser.com",
)
