#!/usr/bin/env python3
"""Arrow adapter — mode=api via Arrow Pricing & Availability Itemservice v4.

The browser search page is frequently blocked in the local/proxy runtime. Arrow's
documented Search By Token endpoint returns part identity, source inventory, and
tier pricing, so this adapter uses that API as the direct Arrow source. Missing
credentials are reported explicitly, like DigiKey/Mouser.
"""
from __future__ import annotations

import os
import re
from typing import Any, Iterable, Optional

import httpx

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402

TIMEOUT = 15
MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")
ENDPOINT = os.environ.get(
    "ARROW_API_ENDPOINT",
    "http://api.arrow.com/itemservice/v4/en/search/token",
)


def _norm(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", value or "")


def _related_mpn(part: str, mpn: str | None) -> bool:
    p = _norm(part.upper())
    m = _norm((mpn or "").upper())
    return bool(p and m and (p in m or m in p))


def _int(value: Any) -> Optional[int]:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value.replace(",", "")))
        except ValueError:
            return None
    return None


def _float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None
    return None


async def fetch(part: str, limit: int) -> Any:
    login = os.environ.get("ARROW_API_LOGIN")
    key = os.environ.get("ARROW_API_KEY")
    if not login or not key:
        raise RuntimeError("缺 ARROW_API_LOGIN / ARROW_API_KEY")
    params = {
        "login": login,
        "apikey": key,
        "search_token": part,
        "rows": str(min(max(limit, 1), 25)),
        "fmt": "json",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT, proxy=MIHOMO) as client:
        r = await client.get(ENDPOINT, params=params)
        r.raise_for_status()
        payload = r.json()
    msg = _response_error(payload)
    if msg:
        raise RuntimeError(msg)
    return payload


def _response_error(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    root = payload.get("itemserviceresult") or payload
    for area in root.get("transactionArea") or []:
        response = (area or {}).get("response") or {}
        if response.get("success") is False:
            return response.get("returnMsg") or f"Arrow returnCode={response.get('returnCode')}"
    return None


def _part_list(payload: Any) -> Iterable[dict]:
    if not isinstance(payload, dict):
        return []
    root = payload.get("itemserviceresult") or payload
    out: list[dict] = []
    for entry in root.get("data") or []:
        if isinstance(entry, dict):
            out.extend(p for p in (entry.get("PartList") or entry.get("partList") or []) if isinstance(p, dict))
    return out


def _resource_uri(resources: Any, wanted: set[str]) -> Optional[str]:
    if not isinstance(resources, list):
        return None
    for item in resources:
        if not isinstance(item, dict):
            continue
        if (item.get("type") or "").lower() in wanted and item.get("uri"):
            return item.get("uri")
    for item in resources:
        if isinstance(item, dict) and item.get("uri"):
            return item.get("uri")
    return None


def _arrow_source_parts(part_obj: dict) -> Iterable[tuple[dict, dict, dict]]:
    inv = part_obj.get("InvOrg") or part_obj.get("invOrg") or {}

    web_sites = inv.get("webSites") or inv.get("websites") or []
    for web in web_sites:
        if not isinstance(web, dict):
            continue
        code = f"{web.get('code') or ''} {web.get('name') or ''}".lower()
        if "arrow" not in code or "verical" in code:
            continue
        for source in web.get("sources") or []:
            if not isinstance(source, dict):
                continue
            for source_part in source.get("sourceParts") or []:
                if isinstance(source_part, dict):
                    yield web, source, source_part

    # Older docs flatten sources directly under InvOrg. Treat these as Arrow if
    # no web-site wrapper is present.
    for source in inv.get("sources") or []:
        if not isinstance(source, dict):
            continue
        for source_part in source.get("sourceParts") or []:
            if isinstance(source_part, dict):
                yield {}, source, source_part


def _price_breaks(source: dict, source_part: dict) -> list:
    currency = (source.get("currency") or "USD").upper()
    out: list = []
    prices = (source_part.get("Prices") or source_part.get("prices") or {})
    for item in prices.get("resaleList") or prices.get("ResaleList") or []:
        if not isinstance(item, dict):
            continue
        qty = _int(item.get("minQty") or item.get("quantity"))
        price = _float(item.get("price") or item.get("displayPrice"))
        if qty is None or price is None:
            continue
        if currency == "CNY":
            out.append(make_break(qty, rmb=price))
        elif currency == "USD":
            out.append(make_break(qty, usd=price))
    return out


def _stock(source_part: dict) -> Optional[int]:
    total = 0
    seen = False
    for item in source_part.get("Availability") or source_part.get("availability") or []:
        if not isinstance(item, dict):
            continue
        qty = _int(item.get("fohQty") or item.get("quantity"))
        if qty is None:
            continue
        total += qty
        seen = True
    return total if seen else None


def _lead_time(source_part: dict) -> Optional[str]:
    for key in ("shipsIn", "arrowLeadTime"):
        value = source_part.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    mfr = _int(source_part.get("mfrLeadTime"))
    if mfr:
        return f"{mfr}d"
    return None


def extract(payload: Any, part: str) -> list[Row]:
    rows: list[Row] = []
    for part_obj in _part_list(payload):
        mpn = part_obj.get("partNum") or part_obj.get("manufacturerPartNumber")
        if not _related_mpn(part, mpn):
            continue
        manufacturer = part_obj.get("manufacturer") or {}
        base_url = _resource_uri(part_obj.get("resources"), {"cloud_part_detail", "detail"})
        for web, source, source_part in _arrow_source_parts(part_obj):
            stock = _stock(source_part)
            url = (
                _resource_uri(source_part.get("resources"), {"detail", "cloud_part_detail"})
                or base_url
            )
            currency = (source.get("currency") or "USD").upper()
            note_bits = []
            display = source.get("displayName") or web.get("name")
            if display:
                note_bits.append(f"source={display}")
            moq = _int(source_part.get("minimumOrderQuantity"))
            if moq:
                note_bits.append(f"moq={moq}")
            ships_from = source_part.get("shipsFrom")
            if ships_from:
                note_bits.append(f"ships_from={ships_from}")
            if currency not in {"USD", "CNY"}:
                note_bits.append(f"currency={currency}")
            rows.append(Row(
                part=part,
                platform="arrow",
                mpn=mpn,
                brand=manufacturer.get("mfrName") if isinstance(manufacturer, dict) else None,
                package=part_obj.get("packageType") or None,
                stock=stock,
                in_stock=(
                    (stock > 0)
                    if stock is not None
                    else source_part.get("inStock") if isinstance(source_part.get("inStock"), bool) else None
                ),
                price_breaks=_price_breaks(source, source_part),
                lead_time=_lead_time(source_part),
                product_url=url,
                description=part_obj.get("desc"),
                note="; ".join(note_bits) or None,
            ))
    return rows


ADAPTER = Adapter(
    id="arrow",
    tier="more",
    mode="api",
    needs_proxy=True,
    url=lambda part: ENDPOINT,
    extract=extract,
    api_fetch=fetch,
    host_key="api.arrow.com",
)
