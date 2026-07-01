#!/usr/bin/env python3
"""Shared factory for the GENERIC SSR-dump adapters — mode=dom, body-text -> note.

Ported byte-faithfully from legacy extended-source cloak_search.py
(scrape_generic + the GENERIC config table). The OLD scrape_generic did, by hand,
per site (url_tpl, needs_proxy):
    1. url = url_tpl.format(q=_q(part))
    2. launch(headless, humanize, [proxy if needs_proxy]); direct sites strip the
       HTTP(S)_PROXY env so Chromium goes machine-direct.
    3. p.goto(url, wait_until="domcontentloaded", timeout=wait*1000)  (swallow)
    4. p.wait_for_timeout(4000)                  — 4s settle (NOT the 6s 'none' default)
    5. text = " ".join((inner_text("body") or "").split())[:max_chars]
    6. blocked = bool(BLOCK_PAT.search(text[:3000]))
       hit = (not blocked) and (part.lower() in text.lower())
    7. return {platform, url, text, hit, blocked}  — RAW text, NOT structured.

Faithful relocation into the 3-layer engine:
    - mode='dom': the engine (L2 navigate) does the single goto + the generic
      BLOCK_PAT check and reports blocked via meta -> Row.blocked. We use the
      'none' profile (single goto, generic BLOCK_PAT, no retry, no warmup) and
      override settle_wait_ms=4000 to match the old 4s wait_for_timeout (the
      'none' default is 6000).
    - NO min_body_len (old code had none — block purely on BLOCK_PAT).
    - block_resources stays profile default (False) — old code did no route
      interception.
    - needs_proxy mirrors the old per-site flag. The old direct=True env-strip is
      the engine's machine-direct bucket (needs_proxy=False); L1 owns that bucket,
      so direct sites simply register needs_proxy=False.

Most generic adapters still fall back to a raw SSR text dump in Row.note. A small
set of high-confidence search-result texts are parsed into Row fields when the
rendered body contains explicit labels such as Availability, Exact Match, 品牌, 库存,
or price. Do not treat mere presence of the query string as in-stock.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402

MAINTENANCE_PAT = re.compile(
    r"(temporarily offline|scheduled maintenance|planned system upgrade|"
    r"site enhancements in progress|currently unavailable|we[’']ll be back soon|"
    r"performing (?:some )?maintenance|back online shortly)",
    re.I,
)
NO_RESULT_PAT = re.compile(
    r"(no\s+(?:matching\s+)?(?:products?|parts?|results?)|0\s+results|"
    r"unable to find items based on your criteria|there are no products|"
    r"sorry,\s+we couldn['’]t find any parts|検索に一致する商品はありません|无命中|無命中)",
    re.I,
)


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


def _stock(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"\d[\d,\s]*", value)
    if not m:
        return None
    try:
        return int(re.sub(r"\D", "", m.group(0)))
    except ValueError:
        return None


def _norm(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _related_mpn(part: str, mpn: str | None) -> bool:
    p = _norm(part)
    m = _norm(mpn)
    if not p or not m:
        return False
    return p in m or m in p or p.lstrip("0") in m.lstrip("0") or m.lstrip("0") in p.lstrip("0")


def _price_breaks(segment: str, *, currency: str = "usd") -> list[dict]:
    breaks: list[dict] = []
    patterns = [
        r"(?P<qty>\d[\d,\s]*\+)\s*(?:\$|USD\s*)?(?P<price>\d+(?:[.,]\d+)?)",
        r"(?P<qty>\d[\d,]*)\s*(?:\$|USD\s*)(?P<price>\d+(?:[.,]\d+)?)",
    ]
    for pat in patterns:
        for m in re.finditer(pat, segment, re.I):
            qty = m.group("qty")
            price = m.group("price")
            qn = _stock(qty)
            if "," in price and "." not in price:
                price_value = price.replace(",", ".")
            else:
                price_value = price.replace(",", "")
            try:
                pn = float(price_value)
            except ValueError:
                continue
            if qn is None:
                continue
            if currency == "rmb":
                breaks.append(make_break(qn, rmb=pn))
            else:
                breaks.append(make_break(qn, usd=pn))
    deduped: list[dict] = []
    seen: set[tuple[int, float | None, float | None]] = set()
    for item in breaks:
        key = (item.get("qty"), item.get("rmb"), item.get("usd"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _brand_tail(text: str) -> tuple[str | None, str]:
    tokens = text.strip().split()
    if not tokens:
        return None, text.strip()
    brand_tokens = [tokens[-1]]
    if len(tokens) >= 2:
        prev = tokens[-2]
        if (
            prev.upper() in {"TE", "ST", "ON", "NXP", "TI", "3M"}
            or (re.search(r"[a-z]", prev) and not re.search(r"\d", prev))
        ):
            brand_tokens.insert(0, prev)
    return " ".join(brand_tokens), " ".join(tokens[:-len(brand_tokens)]).strip()


def _structured_rows(site: str, text: str, part: str, final_url: str) -> list[Row]:
    part_pat = re.escape(part)

    if site == "future":
        rows: list[Row] = []
        for block in re.split(r"\bCompare\s+Datasheet\s+", text, flags=re.I)[1:]:
            head = re.match(
                rf"(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+(?P<brand>\S+)\s+"
                r"(?P<desc>.*?)\s+List\s+Min:",
                block,
                re.I,
            )
            if not head or not _related_mpn(part, head.group("mpn")):
                continue
            price_segment = ""
            pm = re.search(r"Qty\s+Unit\s+Price\s+(?P<prices>.*?)(?:\s+\d[\d,]*\s+(?:Ready to Ship!\s+)?\d+\s+Weeks)", block, re.I)
            if pm:
                price_segment = pm.group("prices")
            stock = None
            lead = None
            sm = re.search(r"\s(?P<stock>\d[\d,]*)\s+(?:Ready to Ship!\s+)?(?P<lead>\d+\s+Weeks)", block, re.I)
            if sm:
                stock = _stock(sm.group("stock"))
                lead = sm.group("lead")
            package = None
            pkg_m = re.search(r"\b(Tray|Reel|Tube|Cut Tape|Tape)\b", block, re.I)
            if pkg_m:
                package = pkg_m.group(1)
            rows.append(Row(
                part=part, platform=site, mpn=head.group("mpn"), brand=head.group("brand"),
                description=head.group("desc").strip() or None,
                package=package, stock=stock,
                in_stock=(stock > 0) if stock is not None else None,
                price_breaks=_price_breaks(price_segment),
                lead_time=lead, product_url=final_url,
            ))
        return rows

    if site == "xonelec":
        search_text = text
        marker = re.search(r"Earliest\s+Ship\s+Date", text, re.I)
        if marker:
            search_text = text[marker.end():]
        m = re.search(
            rf"(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+(?P<body>.*?)\s+Availability\s*:\s*(?P<stock>[\d,]+)"
            rf"(?P<tail>.*?)(?:USD\s*(?P<price>[\d,.]+))",
            search_text,
            re.I,
        )
        if not m:
            return []
        brand, desc = _brand_tail(m.group("body"))
        lead = None
        lm = re.search(r"Ship\s+by\s+(.*)", m.group("tail"), re.I)
        if lm:
            lead = lm.group(1).strip()
        stock = _stock(m.group("stock"))
        price = _num(m.group("price"))
        return [Row(
            part=part, platform=site, mpn=m.group("mpn"), brand=brand,
            description=desc or None, stock=stock,
            in_stock=(stock > 0) if stock is not None else None,
            price_breaks=[make_break(1, usd=price)] if price is not None else [],
            lead_time=lead, product_url=final_url,
        )]

    if site == "lcsc":
        m = re.search(
            rf"Exact Match\s+(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+(?P<body>.*?)\s+\$(?P<price>[\d,.]+)\s+Details",
            text,
            re.I,
        )
        if m:
            body = m.group("body").strip()
            brand = None
            bm = re.search(r"\bRoHS\s+([A-Za-z0-9.+&/-]+)\s*$", body)
            if bm:
                brand = bm.group(1)
                body = body[:bm.start()].strip()
            price = _num(m.group("price"))
            return [Row(
                part=part, platform=site, mpn=m.group("mpn"), brand=brand,
                description=body or None,
                price_breaks=[make_break(1, usd=price)] if price is not None else [],
                product_url=final_url,
            )]
        norm_pat = re.escape(_norm(part))
        rows: list[Row] = []
        for m2 in re.finditer(
            rf"(?P<mpn>{part_pat}|{norm_pat})\s+(?P<sku>C\d+)\s+(?P<brand>[A-Z0-9&.+/-]+)\s+"
            r"(?P<stock>\d[\d,]*)\s+In Stock\s+(?P<prices>.*?)(?:Add Ext\. Price|Full Reel:)",
            text,
            re.I,
        ):
            if not _related_mpn(part, m2.group("mpn")):
                continue
            stock = _stock(m2.group("stock"))
            rows.append(Row(
                part=part, platform=site, mpn=m2.group("mpn"),
                brand=m2.group("brand"), stock=stock,
                in_stock=(stock > 0) if stock is not None else None,
                price_breaks=_price_breaks(m2.group("prices")),
                product_url=final_url, note=m2.group("sku"),
            ))
        return rows

    if site == "tme":
        rows: list[Row] = []
        positions = list(re.finditer(r"Manufacturer part number:\s*(?P<mpn>.*?)\s+Manufacturer:\s*(?P<brand>.*?)\s+Group", text, re.I))
        for idx, m in enumerate(positions):
            mpn = " ".join(m.group("mpn").split())
            if not _related_mpn(part, mpn):
                continue
            before = text[:m.start()]
            after = text[m.end():positions[idx + 1].start() if idx + 1 < len(positions) else len(text)]
            desc = None
            dm = re.search(rf"(?P<title>{re.escape(mpn)}|{part_pat}[A-Z0-9:+/_-]*)\s+(?P<desc>(?:IC:|Dev\.kit:).*?)$", before[-600:], re.I)
            if dm:
                desc = dm.group("desc").strip()
            price_segment = ""
            pm = re.search(r"Net price \[USD/pcs\]\s*(?P<prices>.*?)\s+See price details", after, re.I)
            if pm:
                price_segment = pm.group("prices")
            stock = None
            sm = re.search(r"(?P<stock>\d[\d\s]*)\s+in TME stock", after, re.I)
            if sm:
                stock = int(re.sub(r"\D", "", sm.group("stock")) or "0")
            external = None
            em = re.search(r"(?P<qty>\d[\d\s]*)\s+in an external stock\s+(?P<date>\S+)", after, re.I)
            if em:
                ext_qty = re.sub(r"\D", "", em.group("qty"))
                external = f"external stock {ext_qty} {em.group('date')}"
            rows.append(Row(
                part=part, platform=site, mpn=mpn, brand=" ".join(m.group("brand").split()) or None,
                description=desc, stock=stock,
                in_stock=(stock > 0) if stock is not None else None,
                price_breaks=_price_breaks(price_segment),
                product_url=final_url,
                note=external,
            ))
        return rows

    if site == "szlcsc":
        m = re.search(
            rf"(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+品牌\s+(?P<brand>.*?)\s+封装\s+(?P<package>.*?)\s+类目\s+(?P<category>.*?)\s+编号\s+(?P<sku>\S+)",
            text,
            re.I,
        )
        if not m:
            return []
        return [Row(
            part=part, platform=site, mpn=m.group("mpn"),
            brand=m.group("brand").strip() or None,
            package=m.group("package").strip() or None,
            category=m.group("category").strip() or None,
            product_url=final_url,
            note=f"编号 {m.group('sku')}",
        )]

    if site == "componentonline":
        rows: list[Row] = []
        for m in re.finditer(
            r"(?P<sku>[A-Z]+-\d+)\s+(?P<mpn>[A-Z0-9./_-]+)\s+(?P<brand>[A-Za-z0-9&.+/-]+)\s+"
            r"(?P<desc>.*?)\s+(?P<stock>\d[\d,]*)\s+(?P<prices>(?:\d+\+:\s*\$[\d,.]+\s*)+)More\s+Buy",
            text,
            re.I,
        ):
            if not _related_mpn(part, m.group("mpn")):
                continue
            stock = _stock(m.group("stock"))
            rows.append(Row(
                part=part, platform=site, mpn=m.group("mpn"), brand=m.group("brand"),
                description=m.group("desc").strip() or None,
                stock=stock, in_stock=(stock > 0) if stock is not None else None,
                price_breaks=_price_breaks(m.group("prices").replace(":", "")),
                product_url=final_url, note=m.group("sku"),
            ))
        return rows

    if site == "darisus":
        rows: list[Row] = []
        brand = None
        bm = re.search(r"Filter zurücksetzen\s+Alle Hersteller\s+(?P<brand>.*?)\s+Alle Hersteller", text, re.I)
        if bm:
            brand = bm.group("brand").strip()
        for m in re.finditer(
            r"(?:^|\s)\d+\s+(?P<mpn>[A-Z0-9][A-Z0-9._/+:-]*[A-Z0-9])\s+-\s+"
            r"(?P<desc>.*?)\s+(?P<price>\d+,\d{2})\s+EUR\s+inkl\.",
            text,
            re.I,
        ):
            if not _related_mpn(part, m.group("mpn")):
                continue
            eur = _num(m.group("price").replace(",", "."))
            rows.append(Row(
                part=part, platform=site, mpn=m.group("mpn"),
                brand=brand, description=m.group("desc").strip() or None,
                product_url=final_url,
                note=f"EUR 1+: {eur}" if eur is not None else None,
            ))
        return rows

    if site == "monotaro":
        rows: list[Row] = []
        for m in re.finditer(
            rf"(?P<brand>[A-Za-z][A-Za-z0-9 .+-]*)\s+(?P<desc>.*?)\s+(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+"
            r"(?P<brand_jp>.*?)\s+￥(?P<price>[\d,]+)税込￥(?P<tax_price>[\d,]+)(?P<unit>.*?)\s+"
            r"(?P<lead>当日|翌日以内|翌々日出荷|翌々日以内|3日以内|4日以内|\d+日以内)",
            text,
            re.I,
        ):
            if not _related_mpn(part, m.group("mpn")):
                continue
            price = _stock(m.group("price"))
            tax_text = m.group("tax_price")
            unit = m.group("unit").strip()
            if tax_text.endswith("1") and unit[:1] in {"箱", "袋", "個", "本", "枚"}:
                tax_text = tax_text[:-1]
                unit = "1" + unit
            tax_price = _stock(tax_text)
            note = f"JPY {unit or '1+'}: {price}" if price is not None else None
            if tax_price is not None:
                note = f"{note}; tax incl {tax_price}" if note else f"JPY tax incl {tax_price}"
            rows.append(Row(
                part=part, platform=site, mpn=m.group("mpn"),
                brand=m.group("brand").strip() or None,
                description=m.group("desc").strip() or None,
                lead_time=m.group("lead"), product_url=final_url,
                note=note,
            ))
        return rows

    if site == "corestaff":
        m = re.search(
            rf"(?P<mpn>{part_pat}[A-Z0-9:+/_-]*)\s+(?P<brand>[A-Z0-9._-]+)\s+(?P<stock>[\d,]+)\s+リアルタイム.*?(?:1\s*～\s*¥(?P<price>[\d,.]+))",
            text,
            re.I,
        )
        if not m:
            return []
        lead = None
        lm = re.search(r"(\d{4}/\d{2}/\d{2})\s*当社出荷予定", text)
        if lm:
            lead = lm.group(1) + " 当社出荷予定"
        stock = _stock(m.group("stock"))
        price = _num(m.group("price"))
        return [Row(
            part=part, platform=site, mpn=m.group("mpn"), brand=m.group("brand"),
            stock=stock, in_stock=(stock > 0) if stock is not None else None,
            lead_time=lead, product_url=final_url,
            note=f"JPY 1+: {price}" if price is not None else None,
        )]

    return []


def _availability_status(site: str, final_url: str, text: str) -> str | None:
    if MAINTENANCE_PAT.search(text[:4000]):
        return "maintenance"
    if site == "future" and "error500" in final_url.lower():
        return "maintenance"
    if NO_RESULT_PAT.search(text[:4000]):
        return "no_result"
    return None


def make_generic(site: str, url_tpl: str, needs_proxy: bool, exclusive: bool = False) -> Adapter:
    """Build one GENERIC dom adapter from the old (url_tpl, needs_proxy) row.

    url_tpl uses the OLD literal template verbatim (its own query-param name,
    e.g. tme `queryPhrase`, szlcsc `k`, rs-* `searchTerm`); {q} -> percent-encoded
    part."""

    def url(part: str, _tpl: str = url_tpl) -> str:
        return _tpl.format(q=q(part))

    async def extract(page: Any, part: str, _site: str = site, _url: Callable = url) -> list[Row]:
        # Old: text = " ".join((inner_text("body") or "").split()); sliced [:4000].
        try:
            text = " ".join(((await page.inner_text("body")) or "").split())
        except Exception:
            text = ""
        if (len(text) < 500 or part.lower() not in text.lower()) and _site in {
            "future", "lcsc", "szlcsc", "tme", "xonelec", "componentonline", "monotaro"
        }:
            try:
                await page.wait_for_timeout(4000)
                text = " ".join(((await page.inner_text("body")) or "").split())
            except Exception:
                pass
        try:
            final_url = page.url
        except Exception:
            final_url = _url(part)
        # Mere query echo is not evidence of stock or even product match.
        availability_status = _availability_status(_site, final_url, text)
        structured = _structured_rows(_site, text, part, final_url)
        if structured:
            return structured
        return [Row(
            part=part,
            platform=_site,
            product_url=final_url,
            note=(text[:4000] or "（空白页/未渲染——可能 SPA 未加载或需代理）"),
            in_stock=None,
            availability_status=availability_status,
        )]

    return Adapter(
        id=site,
        tier="more",
        mode="dom",
        needs_proxy=needs_proxy,
        url=url,
        extract=extract,
        # 'none' profile = single goto + generic BLOCK_PAT + no retry/warmup.
        # Override only settle to the old 4s (vs the 6s 'none' default); NO
        # min_body_len, block_resources stays default False.
        defense=Defense(profile="none", settle_wait_ms=4000),
        exclusive=exclusive,
    )
