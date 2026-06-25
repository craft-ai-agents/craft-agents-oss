#!/usr/bin/env python3
"""Mouser adapter — mode=api. Ported from procurement-platform-search/scripts/
api_search.py (search_mouser), faithfully:

  - single MOUSER_API_KEY in the query string.
  - POST search/keyword with SearchByKeywordRequest {keyword, records}.
  -海外 API 出口走代理: the old script relied on urllib honoring *_PROXY env;
    here we pass MIHOMO explicitly to httpx (same as the digikey adapter).

Field mapping into the structured Row (NO string flattening): the old code took
PriceBreaks[0].Price as a single `price` — lifted as one price_break at qty 1.
NOTE: old `stock` was p.get("Availability"), a free-text string (e.g. "1234 In
Stock"), assigned to a dict field with no int coercion. Row.stock is Optional[int];
to stay byte-faithful we keep the raw value out of the int field and pass it
through only when it is an int, else leave stock None (the old extractor did no
coercion — this is the closest typed-Row mapping; raw string would violate the
int contract).
"""
from __future__ import annotations

import os
import urllib.parse
from typing import Any

import httpx

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402

TIMEOUT = 12
MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")


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
        price = breaks_raw[0].get("Price") if breaks_raw else None
        # NOTE: old `stock` = p.get("Availability") is free-text; keep only if int.
        avail = p.get("Availability")
        stock = avail if isinstance(avail, int) else None
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
