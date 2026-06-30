#!/usr/bin/env python3
"""TTI (德州 TTI Inc, sager 源头) adapter — mode=dom, needs_proxy.

⚠ 2026-06-26 prod 实测:TTI 实际在 **Incapsula/Imperva** 后(`_Incapsula_Resource`、
首页 403、GeoIPLogging/gdprCountryCodes 等后端服务 403),**不是 PerimeterX**。引擎没有
Incapsula profile,下面沿用 perimeterx 只为做首页 warmup 拿到主 HTML;但搜索结果依赖的
后端服务被 Incapsula 403,产品多半渲染不出 → 这个源经常 blocked=False 却无结果。真修需造
Incapsula(reese84/JS 挑战)求解器,成本高、ROI 低;被动/连接器品类优先用 sager(同集团、
直连无反爬、已 script 结构化)。下面是当年照搬旧 PerimeterX 假设的实现,保留备用。

Ported from legacy extended-source cloak_search.py
(scrape_tti) byte-faithfully.

  Old scrape_tti did, by hand:
    1. search = tti.com/.../part-search.html?q=<part>;
    2. launch(proxy=MIHOMO);
    3. warmup goto https://www.tti.com/ + 4s dwell
       (首页不弹验证，让 PX 种 cookie);
    4. goto search URL + 3s dwell (过验证后服务端渲染);
    5. text = body inner_text; blocked = BLOCK_PAT.search(text[:3000]);
       hit = (not blocked) and (part.lower() in text.lower());
    6. returns rendered body text for the agent to read.

  Faithful relocation onto the 3-layer engine:
    - profile='perimeterx' owns warmup/retries/fresh-browser/PX block_pat.
    - warmup_url=https://www.tti.com/ + warmup_wait_ms=4000 (old: 4s homepage dwell).
    - settle_wait_ms=3000 (old: 3s after search goto — NOT avnet's 6s).
    - NO min_body_len override: scrape_tti had no <80-char block clause
      (that clause was avnet-only); inherit profile default (off).
    - block_resources stays the profile default (False = zero route interception),
      mirroring the old code's lack of any route interception.

  NOTE: the old `hit = (not blocked) and (part in text)` part-in-text check is
  not represented as a structured field here — dom-mode body-dump puts RAW text
  in Row.note and leaves structured fields None per the contract. The block flag
  is stamped by the engine from BLOCK_PAT. Ported as-is, no structured parsing.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from engine import q  # noqa: E402


def url(part: str) -> str:
    return f"https://www.tti.com/content/ttiinc/en/apps/part-search.html?q={q(part)}"


def _norm(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _related(part: str, value: str | None) -> bool:
    p = _norm(part)
    v = _norm(value)
    if not p or not v:
        return False
    return p in v or v in p or p.lstrip("0") in v.lstrip("0") or v.lstrip("0") in p.lstrip("0")


def _int(value: str | None) -> int | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    return int(digits) if digits else None


def _float(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def _parse_rows(text: str, part: str, final_url: str) -> list[Row]:
    rows: list[Row] = []
    for block in re.split(r"\bCompare\s+Datasheet\s+", text, flags=re.I)[1:]:
        head = re.search(
            r"Mfr:(?P<mfr>\S+)\s+TTI:(?P<tti>.*?)\s+(?P<brand>Molex|TE Connectivity|Amphenol|"
            r"Hirose|JST|Phoenix Contact|Samtec|Cinch|CUI Devices|Bel|Littelfuse|Vishay)\s+"
            r"(?P<body>.*?)\s+(?P<stock>\d[\d,]*)In Stock\s+Tariff May Apply\s+"
            r"(?P<qty>\d[\d,]*)\s+\$(?P<price>[\d,.]+)",
            block,
            re.I,
        )
        if not head:
            continue
        mpn = head.group("tti").strip()
        mfr = head.group("mfr").strip()
        if not (_related(part, mpn) or _related(part, mfr)):
            continue
        stock = _int(head.group("stock"))
        qty = _int(head.group("qty"))
        price = _float(head.group("price"))
        rows.append(Row(
            part=part,
            platform="tti",
            mpn=mpn or mfr,
            brand=head.group("brand"),
            description=head.group("body").strip() or None,
            stock=stock,
            in_stock=(stock > 0) if stock is not None else None,
            price_breaks=[make_break(qty or 1, usd=price)] if price is not None else [],
            product_url=final_url,
            note=f"Mfr:{mfr}" if mfr and mfr != mpn else None,
        ))
    return rows


async def extract(page: Any, part: str) -> list[Row]:
    """dom-mode extract: payload is the live async Page, already warmed/retried/
    settled by engine.navigate(). Old scrape_tti handed the rendered body text to
    the agent; preserve that exactly — emit ONE Row carrying the rendered text in
    `note` plus the final URL."""
    try:
        text = " ".join((await page.inner_text("body") or "").split())
    except Exception:
        text = ""
    try:
        final_url = page.url
    except Exception:
        final_url = url(part)
    rows = _parse_rows(text, part, final_url)
    if rows:
        return rows
    status = "no_result" if re.search(r"(sorry,\s+we couldn['’]t find any parts|0\s*Results)", text, re.I) else None
    blocked = False
    if not text or final_url.rstrip("/") == "https://www.tti.com":
        blocked = True
    return [Row(part=part, platform="tti", product_url=final_url,
                availability_status=status,
                blocked=blocked,
                note=text[:4000] or "(空白/未到搜索结果页——TTI 在 Incapsula 后、后端被 403，常取不到，不代表无货)")]


ADAPTER = Adapter(
    id="tti",
    tier="more",
    mode="dom",
    needs_proxy=True,                       # 老代码 launch(proxy=MIHOMO)，住宅代理
    url=url,
    extract=extract,
    defense=Defense(
        profile="perimeterx",
        warmup_url="https://www.tti.com/",
        warmup_wait_ms=4000,                # old: 4s after homepage
        settle_wait_ms=3000,                # old: 3s after search goto
    ),
    host_key="www.tti.com",
    exclusive=True,
)
