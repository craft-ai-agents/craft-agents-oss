#!/usr/bin/env python3
"""Octopart (= Nexar) 跨分销商比价 — mode=script, intercept the SPA's own JSON API.

WHY this shape (重建,不兼容旧版):
  旧的 octopart / octopart-alt 是浏览器 DOM 抓取(滚动抠 Technical Specifications /
  Alternate Parts 文本),最难、最脆、还把结构化数据拍成文本。而 octopart.com 本身是
  个 SPA,加载时朝自己的内部 API `octopart.com/api/v4/internal?operation=<Op>` 打一组
  干净 JSON 请求。Octopart 现在就是 Nexar——它的官方计费 API 免费档实测只有 ~100 次,
  生产不够用。所以**不走计费 API、也不抠 HTML,而是拦页面自己已经发出的那个请求**:
  零额度、结构化、且带刷新时间戳(比 szlcsc 多)。

数据面(实采确认):
  operation=UseSearchQuery 一发就全有 —— data.search.results[].part:
    part.mpn / part.manufacturer.name(厂牌)/ part.category / part.best_datasheet /
    part.slug / part.sellers[] —— 每个 seller:
      company.name(真分销商,如 'Arrow Electronics')、is_authorized、is_broker、
      offers[]: inventory_level(库存 int)、prices[{quantity,converted_price(USD)}]、
                moq、packaging、sku、updated(刷新时间戳)、click_url(下单链接)
  (LatestOffers 只是 offer-id→live 刷新,UseSearchQuery 的 sellers 里已内含,故不必 join。)

每行把真实分销商顶到 Row.platform=f"octopart:{seller}",agent 看到的是 Arrow/DigiKey/…
的真实在线挂单,不是泛泛的 octopart。

⚠ 反爬:octopart.com 是 PerimeterX。实测从机房/境内 IP 多数能直连 200(PX 间歇),所以
  defense=perimeterx + 首页 warmup 预热 cookie、needs_proxy=False。**生产若 IP 被 PX
  拉黑,把 needs_proxy 改 True 走住宅代理**——但数据面不变(照样拦 UseSearchQuery)。
"""
from __future__ import annotations

import os
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Defense, Row, make_break  # noqa: E402
from url_utils import q  # noqa: E402


def _int(v: Any) -> Optional[int]:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _float(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _name_or_str(v: Any) -> Optional[str]:
    """category/manufacturer may arrive as {'name':..} or a bare string."""
    if isinstance(v, dict):
        return v.get("name")
    return v if isinstance(v, str) else None


def _url_of(v: Any) -> Optional[str]:
    """best_datasheet may be a url string or {'url':..}."""
    if isinstance(v, dict):
        return v.get("url")
    return v if isinstance(v, str) else None


def _breaks(offer: dict) -> list:
    """offer.prices[] -> price_breaks. converted_price is normalized to USD."""
    out: list = []
    for pr in offer.get("prices") or []:
        usd = _float(pr.get("converted_price"))
        if usd is None:
            usd = _float(pr.get("price"))
        if usd is None:
            continue
        out.append(make_break(_int(pr.get("quantity")) or 1, usd=usd))
    return out


def _rows_from_search(payload: Any, part: str, seen: set) -> list[Row]:
    """ONE UseSearchQuery payload -> Rows. Flatten results[].part.sellers[].offers[]
    (one Row per distributor offer). `seen` carries dedup across payloads."""
    if not isinstance(payload, dict):
        return []
    results = (((payload.get("data") or {}).get("search") or {}).get("results")) or []
    rows: list[Row] = []
    for res in results:
        p = (res or {}).get("part") or {}
        mpn = p.get("mpn")
        brand = _name_or_str(p.get("manufacturer"))
        category = _name_or_str(p.get("category"))
        datasheet = _url_of(p.get("best_datasheet"))
        slug = p.get("slug")
        for s in p.get("sellers") or []:
            comp = (s or {}).get("company") or {}
            seller = comp.get("name") or "unknown"
            for off in s.get("offers") or []:
                if not isinstance(off, dict):
                    continue
                stock = _int(off.get("inventory_level"))
                moq = _int(off.get("moq"))
                tags = ["via octopart/" + seller]
                if s.get("is_authorized"):
                    tags.append("authorized")
                if s.get("is_broker"):
                    tags.append("broker")
                if moq is not None:
                    tags.append(f"moq={moq}")
                upd = off.get("updated")
                if upd:
                    tags.append(f"upd={str(upd)[:10]}")
                r = Row(
                    part=part,
                    platform=f"octopart:{seller}",
                    mpn=mpn,
                    brand=brand,
                    package=off.get("packaging"),
                    stock=stock,
                    in_stock=(stock > 0) if stock is not None else None,
                    price_breaks=_breaks(off),
                    datasheet=datasheet,
                    product_url=off.get("click_url") or (f"https://octopart.com{slug}" if slug else None),
                    category=category,
                    note="; ".join(tags),
                )
                key = (r.platform, r.mpn, off.get("id") or r.product_url, r.stock)
                if key in seen:
                    continue
                seen.add(key)
                rows.append(r)
    return rows


def extract(payload: Any, part: str) -> list[Row]:
    """Single-payload entry (fixture-based extract check): one parsed UseSearchQuery
    payload -> Rows. Production goes through script_extract below."""
    return _rows_from_search(payload, part, set())


def url(part: str) -> str:
    return f"https://octopart.com/search?q={q(part)}"


async def script_extract(ctx: Any, part: str) -> list[Row]:
    """script-mode entry. ctx is a ScriptCtx (PerimeterX-warmed Page + helpers).

    Wire an `operation=UseSearchQuery` sniffer BEFORE the first goto (that XHR
    fires on the search navigation and carries the whole cross-distributor
    part.sellers tree). goto the search page; if nothing captured (intermittent
    PX / timing / lazy fire), retry the goto once. Merge every captured payload."""
    page = ctx.page
    get_captured = ctx.on_response("operation=UseSearchQuery")

    for _ in range(2):
        await ctx.goto(url(part))
        await page.wait_for_timeout(6000)
        if get_captured():
            break

    seen: set = set()
    rows: list[Row] = []
    for r in get_captured():
        try:
            rows.extend(_rows_from_search(await r.json(), part, seen))
        except Exception:
            pass

    if not rows:
        return [Row(part=part, platform="octopart",
                    product_url=url(part), note="（无命中 / 未捕获 UseSearchQuery，可能被 PX 拦）")]
    return rows


ADAPTER = Adapter(
    id="octopart",
    tier="more",
    mode="script",
    needs_proxy=False,                                   # 机房/境内多数直连可达;PX 拉黑时改 True
    url=url,
    extract=script_extract,
    # 实测:裸浏览器直奔搜索页最稳;perimeterx 的首页 warmup+fresh-browser 反而触发 PX 挑战
    # 导致 UseSearchQuery 不发。PX 是间歇的,靠 script_extract 内的 2 次 goto 重试兜底。
    # 生产若机器 IP 被 PX 拉黑,再上 needs_proxy=True / 加 warmup。
    defense=None,
    host_key="octopart.com",
)
