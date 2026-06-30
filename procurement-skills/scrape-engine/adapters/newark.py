#!/usr/bin/env python3
"""Newark adapter — mode=api via the official element14/Farnell/Newark Product
Search API.

The Newark web search page is access-sensitive in the local/proxy runtime, but
Newark exposes the same catalog through the official Product Search API. Treat
this like DigiKey/Mouser: direct platform evidence comes from the API, and a
missing key is a credential error rather than a site availability verdict.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402

TIMEOUT = 15
MIHOMO = os.environ.get("MIHOMO_PROXY", "http://127.0.0.1:7899")
ENDPOINT = "https://api.element14.com/catalog/products"


def _api_key() -> Optional[str]:
    for name in ("NEWARK_API_KEY", "ELEMENT14_API_KEY", "FARNELL_API_KEY"):
        value = os.environ.get(name)
        if value:
            return value
    return None


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


def _products(payload: Any) -> list:
    if not isinstance(payload, dict):
        return []
    ret = payload.get("keywordSearchReturn") or {}
    return ret.get("products") or []


def _error_message(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for key in ("fault", "Fault", "error", "Error"):
        value = payload.get(key)
        if value:
            return str(value)
    ret = payload.get("keywordSearchReturn") or {}
    for key in ("error", "errors"):
        value = ret.get(key)
        if value:
            return str(value)
    return None


async def fetch(part: str, limit: int) -> Any:
    """api_fetch: manufacturer-part search first, broad keyword second."""
    key = _api_key()
    if not key:
        raise RuntimeError("缺 NEWARK_API_KEY / ELEMENT14_API_KEY / FARNELL_API_KEY")

    store_id = os.environ.get("NEWARK_STORE_ID", "www.newark.com")
    base_params = {
        "storeInfo.id": store_id,
        "resultsSettings.offset": "0",
        "resultsSettings.numberOfResults": str(limit),
        "resultsSettings.responseGroup": "medium",
        "callInfo.responseDataFormat": "JSON",
        "callInfo.apiKey": key,
    }
    async with httpx.AsyncClient(timeout=TIMEOUT, proxy=MIHOMO) as client:
        last: Any = None
        for term in (f"manuPartNum:{part}", f"any:{part}"):
            params = dict(base_params)
            params["term"] = term
            r = await client.get(ENDPOINT, params=params)
            r.raise_for_status()
            last = r.json()
            msg = _error_message(last)
            if msg:
                raise RuntimeError(msg)
            if _products(last) or term.startswith("any:"):
                return last
        return last or {}


def _datasheet(product: dict) -> Optional[str]:
    sheets = product.get("datasheets") or product.get("dataSheets") or []
    if isinstance(sheets, list) and sheets:
        first = sheets[0] or {}
        if isinstance(first, dict):
            return first.get("url") or first.get("href")
        if isinstance(first, str):
            return first
    return product.get("datasheet") or product.get("datasheetUrl")


def _stock(product: dict) -> Optional[int]:
    stock = product.get("stock") or {}
    if isinstance(stock, dict):
        value = _int(stock.get("level"))
        if value is not None:
            return value
        for item in stock.get("breakdown") or stock.get("regionalBreakdown") or []:
            if isinstance(item, dict):
                value = _int(item.get("inv") or item.get("level"))
                if value is not None:
                    return value
    return _int(product.get("inv") or product.get("stockLevel"))


def _lead_time(product: dict) -> Optional[str]:
    stock = product.get("stock") or {}
    if isinstance(stock, dict):
        value = _int(stock.get("leastLeadTime") or stock.get("leadTime"))
        if value is not None:
            return f"{value}d"
        for item in stock.get("breakdown") or stock.get("regionalBreakdown") or []:
            if isinstance(item, dict):
                value = _int(item.get("lead") or item.get("leastLeadTime"))
                if value is not None:
                    return f"{value}d"
    return None


def _price_breaks(product: dict) -> list:
    out: list = []
    for item in product.get("prices") or []:
        if not isinstance(item, dict):
            continue
        qty = _int(item.get("from") or item.get("quantity") or item.get("min"))
        price = _float(item.get("cost") or item.get("price"))
        if qty is None or price is None:
            continue
        out.append(make_break(qty, usd=price))
    return out


def extract(payload: Any, part: str) -> list[Row]:
    rows: list[Row] = []
    for product in _products(payload):
        if not isinstance(product, dict):
            continue
        stock = _stock(product)
        sku = product.get("sku") or product.get("id")
        note_bits = [f"sku={sku}"] if sku else []
        rows.append(Row(
            part=part,
            platform="newark",
            mpn=(
                product.get("translatedManufacturerPartNumber")
                or product.get("manufacturerPartNumber")
                or product.get("mpn")
            ),
            brand=product.get("brandName") or product.get("vendorName"),
            stock=stock,
            in_stock=(stock > 0) if stock is not None else None,
            price_breaks=_price_breaks(product),
            lead_time=_lead_time(product),
            datasheet=_datasheet(product),
            product_url=(
                product.get("productURL")
                or product.get("productUrl")
                or product.get("productPageUrl")
            ),
            description=product.get("displayName") or product.get("description"),
            category=product.get("categoryName"),
            note="; ".join(note_bits) or None,
        ))
    return rows


ADAPTER = Adapter(
    id="newark",
    tier="more",
    mode="api",
    needs_proxy=True,
    url=lambda part: ENDPOINT,
    extract=extract,
    api_fetch=fetch,
    host_key="api.element14.com",
)
