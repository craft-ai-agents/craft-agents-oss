#!/usr/bin/env python3
"""Verical (Arrow marketplace) adapter — mode=xhr, match_xhr='rest/search/parametric'.
Ported from legacy extended-source cloak_search.py (scrape_verical).

The old script opened https://www.verical.com/s/{part}/ and intercepted the
`rest/search/parametric` POST XHR, reading d["records"][*]. The engine now does
the interception (xhr mode + match_xhr) and feeds the parsed JSON to extract().
机房 IP 实测可达,无需代理. CSRF token 由浏览器自动携带.

Old logic flattened each record into a pipe string; here we keep structured Rows
but lift the same field selection byte-faithfully. The product link is rebuilt
from mfr_slug (manufacturerCode.lower().replace(' ','-')) + mpn.lower() + partId,
exactly as the old code did.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402


def extract(payload: Any, part: str) -> list[Row]:
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    seen: set = set()
    for rec in payload.get("records") or []:
        mpn = rec.get("mpn") or ""
        mfr = rec.get("manufacturerName") or rec.get("manufacturerCode") or ""
        qty = rec.get("quantity") or 0
        price = rec.get("lowestPrice")
        desc = rec.get("partDescription") or ""
        part_id = rec.get("partId") or ""
        mfr_slug = (rec.get("manufacturerCode") or "").lower().replace(" ", "-")
        link = f"https://www.verical.com/pd/{mfr_slug}-undefined-{mpn.lower()}-{part_id}"
        # de-dup like the old dict.fromkeys over the rendered line
        key = (mpn, mfr, desc, qty, price, link)
        if key in seen:
            continue
        seen.add(key)
        rows.append(Row(
            part=part,
            platform="verical",
            mpn=mpn or None,
            brand=mfr or None,
            stock=qty or None,
            in_stock=(qty > 0) if qty else None,
            price_breaks=[make_break(1, usd=price)] if price else [],
            description=desc or None,
            product_url=link,
        ))
    return rows


def _url(part: str) -> str:
    return f"https://www.verical.com/s/{q(part)}/"


ADAPTER = Adapter(
    id="verical",
    tier="more",
    mode="xhr",
    needs_proxy=False,                              # 机房 IP 实测可达,无需代理
    match_xhr="rest/search/parametric",
    url=_url,
    extract=extract,
    host_key="www.verical.com",
)
