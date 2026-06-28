#!/usr/bin/env python3
"""Digikey adapter — mode=api. Ported from legacy core platform scripts/
api_search.py (search_digikey + digikey_token), faithfully:

  - OAuth2 client_credentials token from DIGIKEY_CLIENT_ID / _SECRET.
  - POST products/v4/search/keyword with Keywords + Limit.
  -海外 API 出口走代理: the old script relied on urllib honoring *_PROXY env;
    here we pass MIHOMO explicitly to httpx so the engine doesn't have to fiddle
    with env. Same exit, same destination.

Field mapping into the structured Row (NO string flattening): UnitPrice becomes
a single price_break at qty 1 (the API's keyword search returns unit price, not
the full break ladder — faithful to what the old code extracted).
"""
from __future__ import annotations

import os
from typing import Any

import httpx

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402

TIMEOUT = 12
MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")


async def _token(client: httpx.AsyncClient, cid: str, secret: str) -> str:
    r = await client.post(
        "https://api.digikey.com/v1/oauth2/token",
        data={"grant_type": "client_credentials", "client_id": cid, "client_secret": secret},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def fetch(part: str, limit: int) -> Any:
    """api_fetch: returns the parsed keyword-search JSON dict (the 'payload').

    We return the parsed dict rather than a raw Response so extract() stays pure
    and testable. The two-leg OAuth flow is mechanics and lives here, off the
    engine's hot path."""
    cid = os.environ.get("DIGIKEY_CLIENT_ID")
    secret = os.environ.get("DIGIKEY_CLIENT_SECRET")
    if not cid or not secret:
        raise RuntimeError("缺 DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET")
    # mihomo proxy for the overseas API egress (old script used *_PROXY env).
    async with httpx.AsyncClient(timeout=TIMEOUT, proxy=MIHOMO) as client:
        token = await _token(client, cid, secret)
        r = await client.post(
            "https://api.digikey.com/products/v4/search/keyword",
            json={"Keywords": part, "Limit": limit},
            headers={
                "Authorization": "Bearer " + token,
                "X-DIGIKEY-Client-Id": cid,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        r.raise_for_status()
        return r.json()


def extract(payload: Any, part: str) -> list[Row]:
    rows: list[Row] = []
    for p in (payload.get("Products") or []):
        unit = p.get("UnitPrice")
        breaks = [make_break(1, usd=unit)] if unit not in (None, 0) else []
        qty = p.get("QuantityAvailable")
        rows.append(Row(
            part=part,
            platform="digikey",
            mpn=p.get("ManufacturerProductNumber"),
            brand=(p.get("Manufacturer") or {}).get("Name"),
            description=(p.get("Description") or {}).get("ProductDescription"),
            stock=qty if isinstance(qty, int) else None,
            in_stock=(qty > 0) if isinstance(qty, int) else None,
            price_breaks=breaks,
            datasheet=p.get("DatasheetUrl"),
            product_url=p.get("ProductUrl"),
        ))
    return rows


ADAPTER = Adapter(
    id="digikey",
    tier="core",
    mode="api",
    needs_proxy=True,                      # overseas egress via mihomo
    url=lambda part: "https://api.digikey.com/products/v4/search/keyword",
    extract=extract,
    api_fetch=fetch,
    host_key="api.digikey.com",
)
