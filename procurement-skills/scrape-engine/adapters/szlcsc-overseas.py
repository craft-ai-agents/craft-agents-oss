#!/usr/bin/env python3
"""SZLCSC 海外/全球比价 (so.szlcsc.com/global) META-AGGREGATOR — mode=script,
direct (no proxy).

立创商城的 global.html 是一个跨分销商比价聚合页：一次搜索把同一料号在 te /
rochester / waldom / digikey / mouser / arrow / future / avnet_* / tti / sager /
heilind / verical / rscomponents / element14 / tme … 等几十家"本站真源"分销商上的
在线库存与阶梯价聚合回来。

抓取面：页面加载后先打 `overseas/global/search`(combined)，随后再为每个分销商各打
一发 `overseas/search/<provider>`。combined 端点只回那几家"即时"provider
(te/rochester/waldom，多数 total=0)；digikey/future/mouser 等 *真分销商* 的库存与
阶梯价全部走各自的 per-provider XHR。

⚠ 为什么必须是 mode=script 而不是 mode=xhr：xhr 模式只喂给 extract() 第一个命中
match_xhr 的 payload(即 combined 那发)，结构性地丢掉了 per-provider 的全部真数据
——这个聚合器的全部意义(跨分销商真实在线库存)就此蒸发，只剩 waldom 一家。所以本
适配器以 script 模式自己装一个广谱嗅探器 (`overseas/`，同时命中 combined 与
`overseas/search/<provider>`)，把页面 SPA 自动打出的 *每一发* overseas 响应全部
收集，再把它们的 result[].products[] 合并摊平。schema 三方(combined / per-provider)
完全一致：{code,msg,result:[{provider,total,products:[{...}]}],ok}，所以同一套
_row/_rows_from_payload 映射对每一发都成立。

每一行都把 *真实来源分销商* 顶到 Row.platform=f"szlcsc:{provider}" 上，让 agent
知道这是 waldom/digikey/… 的在线挂单，而不是泛泛的 szlcsc 自营。境内直连，无反爬。

字段映射(见 _fixtures/szlcsc-overseas/ 实采):
  productCodeManufacturer        -> mpn          (干净料号;Highlight 版含 <SPAN> HTML，弃用)
  productGradePlateName          -> brand        (英文厂牌;brandName 是中文带注释版)
  stockNumber                    -> stock:int
  tieredPrices[{countStart,price,rmbPrice}] -> price_breaks (price=USD, rmbPrice=RMB)
  dataSheetUrl                   -> datasheet
  productDesc                    -> description
  encapsulationModel / packaging -> package
  selfStandard                   -> category     (立创归一封装/品类，如 LQFP-48(7x7))
  minBuyNumber                   -> note(moq)     (Row 无 moq 字段，挂 note)
  productCode (C-码)             -> product_url   (detailUrl 恒为 null)
"""
from __future__ import annotations

import os
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from engine import q  # noqa: E402


def _int(v: Any) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _breaks(prod: dict) -> list:
    """tieredPrices[] -> price_breaks. price 是 USD，rmbPrice 是 RMB(多数为 null)。
    单价(只有一档)自然就是一个 break。"""
    out: list = []
    for t in prod.get("tieredPrices") or []:
        qty = _int(t.get("countStart"))
        if qty is None:
            continue
        out.append(make_break(qty, rmb=_float(t.get("rmbPrice")), usd=_float(t.get("price"))))
    return out


def _product_url(prod: dict) -> Optional[str]:
    code = prod.get("productCode")
    if code:
        return f"https://www.szlcsc.com/global/product/{code}.html"
    return None


def _row(prod: dict, provider: str, part: str) -> Row:
    stock = _int(prod.get("stockNumber"))
    moq = _int(prod.get("minBuyNumber"))
    note = f"via szlcsc/{provider}"
    if moq is not None:
        note += f"; moq={moq}"
    return Row(
        part=part,
        platform=f"szlcsc:{provider}",
        mpn=prod.get("productCodeManufacturer") or prod.get("productCodeProvider"),
        brand=prod.get("productGradePlateName") or prod.get("brandName"),
        package=prod.get("encapsulationModel") or prod.get("packaging"),
        stock=stock,
        in_stock=(stock > 0) if stock is not None else None,
        price_breaks=_breaks(prod),
        lead_time=prod.get("deliveryTimeWayDays"),
        datasheet=prod.get("dataSheetUrl") or None,
        product_url=_product_url(prod),
        description=prod.get("productDesc"),
        category=prod.get("selfStandard"),
        note=note,
    )


def _rows_from_payload(payload: Any, part: str, seen: set) -> list[Row]:
    """ONE overseas payload {code,msg,result:[{provider,total,products:[...]}],ok}
    -> Rows. Flattens every provider's products[] (一品一行), skipping empties.

    `seen` is supplied by the caller so dedup carries ACROSS payloads (combined +
    every per-provider发 share one set — the same C-code arriving in two responses
    must not double). Dedup key INCLUDES product_url (the C-code): distinct C-codes
    are distinct catalog entries / product pages and must NEVER be merged. The old
    key omitted it and silently collapsed e.g. C17393620+C99277 (same mpn/stock/
    tier-1 USD, different product page) into one row."""
    if not isinstance(payload, dict):
        return []
    rows: list[Row] = []
    for entry in payload.get("result") or []:
        if not isinstance(entry, dict):
            continue
        provider = entry.get("provider") or "unknown"
        for prod in entry.get("products") or []:
            if not isinstance(prod, dict):
                continue
            r = _row(prod, provider, part)
            key = (r.platform, r.product_url, r.mpn, r.stock,
                   r.price_breaks[0].get("usd") if r.price_breaks else None)
            if key in seen:
                continue
            seen.add(key)
            rows.append(r)
    return rows


def extract_payloads(payloads: list, part: str) -> list[Row]:
    """Merge a LIST of overseas payloads (combined + every per-provider发) into one
    Row list, deduping across all of them. This is the real aggregation the
    cross-distributor compare needs — feeding only the combined发 (old xhr mode)
    drops every distributor except waldom."""
    seen: set = set()
    rows: list[Row] = []
    for p in payloads or []:
        rows.extend(_rows_from_payload(p, part, seen))
    return rows


def extract(payload: Any, part: str) -> list[Row]:
    """Single-payload convenience (and the fixture-based extract check entry):
    accepts ONE parsed overseas payload (combined OR a per-provider发) and flattens
    it. Production goes through the script-mode `script_extract` below, which
    aggregates EVERY captured overseas response via extract_payloads()."""
    return _rows_from_payload(payload, part, set())


def url(part: str) -> str:
    return f"https://so.szlcsc.com/global.html?k={q(part)}"


async def script_extract(ctx: Any, part: str) -> list[Row]:
    """script-mode entry: ctx is a ScriptCtx (warmed Page + helpers).

    Wire a BROAD `overseas/` sniffer BEFORE the first goto so it catches BOTH the
    combined `overseas/global/search`发 AND every per-provider `overseas/search/
    <provider>`发 the SPA fires as it loads. Then goto the global page once, dwell
    while the per-provider XHRs fan out, and merge every captured payload. This is
    the reachability fix: the per-provider distributor data (digikey/future/mouser
    real stock + ladders) is structurally invisible to plain xhr mode, which only
    ever feeds extract() the first (combined) response."""
    page = ctx.page
    get_captured = ctx.on_response("overseas/")

    await ctx.goto(url(part))
    # the combined发 returns fast; the per-provider发 fan out after it. Dwell long
    # enough for them, then settle until the overseas XHR stream goes quiet-ish.
    await page.wait_for_timeout(6000)

    payloads: list = []
    for r in get_captured():
        try:
            payloads.append(await r.json())
        except Exception:
            pass

    rows = extract_payloads(payloads, part)
    if not rows:
        return [Row(part=part, platform="szlcsc-overseas",
                    product_url=url(part), note="（无命中 / 无 overseas 响应）")]
    return rows


ADAPTER = Adapter(
    id="szlcsc-overseas",
    tier="more",
    mode="script",
    needs_proxy=False,                                   # 境内直连，无反爬
    url=url,
    extract=script_extract,
    defense=None,                                        # 'none' profile — no warmup wall
    host_key="so.szlcsc.com",
)
