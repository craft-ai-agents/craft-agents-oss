#!/usr/bin/env python3
"""Heilind Electronics (赫联，连接器/机电互连专家) adapter — mode=script, direct.
Ported from legacy extended-source cloak_search.py
(scrape_heilind), byte-faithfully.

  Old scrape_heilind did, by hand:
    1. launch(headless=True, humanize=True)  — NO proxy kwarg => machine-direct;
    2. goto https://www.heilind.com/search (domcontentloaded) + 2s dwell
       (lets the Coveo SPA boot and publish window.coveoAccessToken);
    3. read token = window.coveoAccessToken, org_id = window.coveoOrgID
       (fallback org id 'heilindelectronicsincproductiono0ya35k8');
       no token => return a no-hit sentinel;
    4. in-page fetch POST to {org}.org.coveo.com/rest/search/v2 (same-origin
       authed fetch avoids CORS) with the Coveo Main Search payload;
    5. parse data["results"], pull hei_mnf_part_number / ec_brand /
       hei_manufacturer / clickableuri / ec_category (deepest = longest cat),
       dedup, cap at limit.
    The old index carries NO stock/price (site design), so those fields stay None.

This is a script adapter hitting a real in-page JSON API, so it CAN fill typed
Rows (mpn/brand/category/product_url) — per the contract's heilind/sager note,
the mode does not force a body dump. Extraction logic lifted verbatim; only the
final-shape (dict text join -> typed Row) is re-targeted to the contract Row.

needs_proxy=False / defense=None: the old code launched with NO proxy and hit no
anti-bot wall (no warmup_url, no BLOCK_PAT path), so the 'none' profile + direct
bucket match the old behavior exactly. host_key=www.heilind.com.
"""
from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from engine import q  # noqa: E402

# NOTE: limit is not threaded through the script-mode extract signature; the old
# code used `limit` for numberOfResults + the result cap. Preserve the old
# numeric behavior with the same default the runner historically passed (20).
_LIMIT = 20


def url(part: str) -> str:
    # Old search_url (used only as the reported page URL).
    return f"https://www.heilind.com/search#q={q(part)}&t=All"


async def extract(ctx: Any, part: str) -> list[Row]:
    page = ctx.page
    search_url = url(part)

    # Old: goto the search page (domcontentloaded), swallow nav errors, dwell 2s
    # so the Coveo SPA publishes window.coveoAccessToken.
    await ctx.goto("https://www.heilind.com/search")
    await page.wait_for_timeout(2000)

    token = await page.evaluate("() => window.coveoAccessToken")
    org_id = await page.evaluate("() => window.coveoOrgID") \
        or "heilindelectronicsincproductiono0ya35k8"
    if not token:
        return [Row(part=part, platform="heilind", product_url=search_url,
                    blocked=True, note="（无 token，无法搜索）")]

    endpoint = f"https://{org_id}.org.coveo.com/rest/search/v2?organizationId={org_id}"
    payload = {
        "q": part, "searchHub": "HEI_Main_Search", "pipeline": "HEI Main Search",
        "numberOfResults": _LIMIT, "tab": "All",
        "fieldsToInclude": ["clickableuri", "ec_category", "ec_brand", "hei_manufacturer",
                            "hei_mnf_part_number", "ec_shortdesc", "hei_series"],
    }
    data = await page.evaluate(
        """async ([endpoint, payload, token]) => {
            try {
                const r = await fetch(endpoint, {method: 'POST',
                    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
                    body: JSON.stringify(payload)});
                return await r.json();
            } catch(e) { return {_fetch_error: e.toString()}; }
        }""", [endpoint, payload, token])
    if not data or "_fetch_error" in data:
        return [Row(part=part, platform="heilind", product_url=search_url,
                    availability_status="no_result", note="（API 错误/无命中）")]

    rows: list[Row] = []
    seen: set[str] = set()
    for r in (data.get("results") or [])[:_LIMIT]:
        raw = r.get("raw") or {}
        pn = raw.get("hei_mnf_part_number") or r.get("title") or ""
        brand = raw.get("ec_brand") or raw.get("hei_manufacturer") or ""
        uri = raw.get("clickableuri") or ""
        product_url = f"https://www.heilind.com{uri}" if uri.startswith("/") else uri
        cats = raw.get("ec_category") or []
        deepest = max(cats, key=len) if cats else ""
        # Old built a " | "-joined dedup line; keep the SAME dedup key (the joined
        # line) but emit typed fields instead of flattening into note.
        line = " | ".join(x for x in [pn, brand, deepest, product_url] if x)
        if not line or line in seen:
            continue
        seen.add(line)
        rows.append(Row(
            part=part, platform="heilind",
            mpn=pn or None, brand=brand or None,
            category=deepest or None, product_url=product_url or None,
        ))
        if len(rows) >= _LIMIT:
            break
    if not rows:
        return [Row(part=part, platform="heilind", product_url=search_url,
                    availability_status="no_result", note="（无命中）")]
    return rows


ADAPTER = Adapter(
    id="heilind",
    tier="more",
    mode="script",
    needs_proxy=False,          # old launch() had NO proxy kwarg => machine-direct
    url=url,
    extract=extract,
    defense=None,               # 'none' profile: old code hit no anti-bot wall
    host_key="www.heilind.com",
)
