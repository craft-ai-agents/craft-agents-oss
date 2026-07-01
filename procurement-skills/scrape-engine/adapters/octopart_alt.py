#!/usr/bin/env python3
"""Octopart (= Nexar) 替代料 / SUBSTITUTES — mode=script, ZERO 反爬, 拦 SSR flight.

USE CASE: procurement-alternative-search（替代料）。给一个 MPN, 返回 octopart 给出的
"Similar Parts"(也即"Alternate Parts")候选清单——跨厂牌的功能替代件。

WHY this shape:
  octopart 的"Similar Parts"清单 **不在** 任何 api/v4/internal?operation=<Op> 的 XHR 里。
  实采确认(STM32F103C8T6 的 AlternateParts op 为空、UseSearchQuery 只给 counts.similar_parts
  这个数字、详情页只发 AttributeShortnames / LatestOffers / XrefAdvert 三个 XHR 且都不带清单)。
  真正的替代料清单是 **服务端渲染进 Next.js App-Router 的 RSC flight 流** 里的
  `part.similar_parts` 数组——夹在详情页 HTML 的 `self.__next_f.push([1,"…"])` 分片里。
  所以本适配器:
    ① 先到搜索页拦 UseSearchQuery, 挑 counts.similar_parts 最大的那条结果, 取它的 slug;
    ② goto 详情页 octopart.com<slug>, 等水合, 抓 page.content(), 解 flight 分片,
       bracket-count 切出 `"similar_parts":[…]` 这段 JSON, 每个候选 = 一个 Row。

  每个候选(实采 schema):
    { id, mpn, slug, descriptions:[{text}], best_image:{url},
      median_price_1000:float|null, manufacturer:{name} }
  -> Row(mpn=候选MPN, brand=候选厂牌, datasheet=None, product_url=octopart.com<slug>,
         description=第一条 descriptions.text, note="substitute candidate via octopart …")

反爬(关键, 踩过的坑):
  octopart.com 是 PerimeterX, 但**详情页直连(defense=None / 裸 goto)最稳**。绝对不要加首页
  warmup 预热——那会触发 PX 挑战, 详情页只回 50KB 的 px-captcha 壳子, similar_parts 永远不来。
  PX 是间歇 + 频控的: 同一详情页连打多次会被临时拉黑(回 px-captcha 壳)。所以**串行、一次一个
  浏览器、礼貌**, 并在脚本内对"壳子"重试 1 次。needs_proxy=False(境内/机房直连可达)。
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row  # noqa: E402
from url_utils import q  # noqa: E402

# RSC flight chunk: self.__next_f.push([1,"<js-string>"])
_FLIGHT = re.compile(r'self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)')
# PerimeterX shell signature (the 50KB challenge page that carries no part data)
_PX_SHELL = re.compile(r"px-captcha|please enable javascript", re.I)


def _name_or_str(v: Any) -> Optional[str]:
    if isinstance(v, dict):
        return v.get("name")
    return v if isinstance(v, str) else None


def _decode_flight(html: str) -> str:
    """Concatenate + JS-unescape every __next_f flight chunk into one big string
    (the RSC stream). similar_parts lives in here, not in the hydrated DOM."""
    out: list[str] = []
    for c in _FLIGHT.findall(html):
        try:
            out.append(json.loads('"' + c + '"'))
        except Exception:
            out.append(c)
    return "".join(out)


def _slice_array(s: str, key: str) -> Optional[str]:
    """Return the JSON text of the array that follows `"<key>":` via bracket
    counting (the array contains nested objects/arrays, so a regex won't cut it)."""
    i = s.find(f'"{key}":[')
    if i < 0:
        return None
    start = s.index("[", i)
    depth = 0
    for j in range(start, len(s)):
        ch = s[j]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return s[start:j + 1]
    return None


def _parse_similar(html: str, part: str, src_mpn: Optional[str], src_brand: Optional[str]) -> list[Row]:
    """Detail-page HTML -> Rows, one per `part.similar_parts` candidate."""
    flight = _decode_flight(html)
    arr_txt = _slice_array(flight, "similar_parts")
    if not arr_txt:
        return []
    try:
        arr = json.loads(arr_txt)
    except Exception:
        return []
    rows: list[Row] = []
    seen: set = set()
    for e in arr:
        if not isinstance(e, dict):
            continue
        mpn = e.get("mpn")
        if not mpn or mpn in seen:
            continue
        seen.add(mpn)
        brand = _name_or_str(e.get("manufacturer"))
        slug = e.get("slug")
        desc = None
        d = e.get("descriptions")
        if isinstance(d, list) and d and isinstance(d[0], dict):
            desc = d[0].get("text")
        # note marks provenance + the source part this is a substitute FOR
        of = f" for {src_brand or ''} {src_mpn or part}".rstrip()
        cross = "; cross-brand" if (brand and src_brand and brand != src_brand) else ""
        rows.append(Row(
            part=part,
            platform="octopart-alt",
            mpn=mpn,
            brand=brand,
            product_url=(f"https://octopart.com{slug}" if slug else None),
            description=desc,
            note=f"substitute candidate via octopart{of}{cross}",
        ))
    return rows


def _pick_slug(payload: Any) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """From a UseSearchQuery payload pick the result with the most similar_parts.
    Returns (slug, mpn, brand). Ties broken by first-seen (search relevance order)."""
    if not isinstance(payload, dict):
        return None, None, None
    results = (((payload.get("data") or {}).get("search") or {}).get("results")) or []
    best = None
    best_n = -1
    for res in results:
        p = (res or {}).get("part") or {}
        n = ((p.get("counts") or {}).get("similar_parts")) or 0
        if p.get("slug") and n > best_n:
            best_n = n
            best = p
    if best is None:
        # fall back to first result with a slug even if similar count unknown
        for res in results:
            p = (res or {}).get("part") or {}
            if p.get("slug"):
                best = p
                break
    if best is None:
        return None, None, None
    return best.get("slug"), best.get("mpn"), _name_or_str(best.get("manufacturer"))


def search_url(part: str) -> str:
    return f"https://octopart.com/search?q={q(part)}"


async def script_extract(ctx: Any, part: str) -> list[Row]:
    """① search page -> capture UseSearchQuery -> pick best slug.
       ② detail page -> page.content() -> decode flight -> parse similar_parts.
    No homepage warmup (it trips PX). Sequential, polite; retry once on PX shell."""
    page = ctx.page

    # ---- ① find the canonical part's slug ----
    get_search = ctx.on_response("operation=UseSearchQuery")
    slug = src_mpn = src_brand = None
    for _ in range(2):
        await ctx.goto(search_url(part))
        await page.wait_for_timeout(6000)
        caps = get_search()
        for r in caps:
            try:
                slug, src_mpn, src_brand = _pick_slug(await r.json())
            except Exception:
                continue
            if slug:
                break
        if slug:
            break

    if not slug:
        return [Row(part=part, platform="octopart-alt", product_url=search_url(part),
                    note="substitute candidate via octopart（未捕获 UseSearchQuery / 无 slug，可能被 PX 拦）")]

    # ---- ② detail page: SSR flight carries part.similar_parts ----
    detail = f"https://octopart.com{slug}"
    for _ in range(2):
        await ctx.goto(detail)
        await page.wait_for_timeout(8000)
        # scroll to fire any lazy hydration; data is SSR but be safe
        for _y in range(0, 6000, 600):
            try:
                await page.mouse.wheel(0, 600)
            except Exception:
                pass
            await page.wait_for_timeout(400)
        await page.wait_for_timeout(2000)
        try:
            html = await page.content()
        except Exception:
            html = ""
        if not html or _PX_SHELL.search(html[:60000]) and len(html) < 80000:
            continue  # PX challenge shell — retry once
        rows = _parse_similar(html, part, src_mpn, src_brand)
        if rows:
            return rows
        # page loaded but no similar_parts in flight -> genuinely none
        return [Row(part=part, platform="octopart-alt", mpn=src_mpn, brand=src_brand,
                    product_url=detail,
                    note=f"substitute candidate via octopart: none listed for {src_brand or ''} {src_mpn or part}".rstrip())]

    return [Row(part=part, platform="octopart-alt", product_url=detail,
                note="substitute candidate via octopart（详情页被 PX 拦，返回 px-captcha 壳）")]


ADAPTER = Adapter(
    id="octopart-alt",
    tier="more",
    mode="script",
    needs_proxy=False,                                   # 境内/机房直连可达;PX 拉黑时改 True
    url=search_url,
    extract=script_extract,
    # 详情页裸直连最稳。**绝不加 perimeterx warmup** —— 会触发 PX 挑战, similar_parts 不来。
    defense=None,
    host_key="octopart.com",
)
