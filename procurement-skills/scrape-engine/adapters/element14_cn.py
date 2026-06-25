#!/usr/bin/env python3
"""element14-cn (cn.element14.com / 中国直营 e络盟) 本站真源 — mode=script,
拦页面自己发的 GraphQL 库存/阶梯价 XHR + SSR 行表，二者按 publicId join。

重建动机（不再是 SSR body-dump dom 适配器）:
  老版是 _generic 的 mode=dom：把整页 inner_text 拍进 Row.note，结构全丢。
  实采发现 cn.element14.com（实际 301 跳到 www.element14.cn 中国站）的搜索页
  自己朝 `/graphql?operationName=InventoryAndPricesForProducts` 打一发干净 JSON，
  按 publicId 一次带全所有结果的 *库存 + 阶梯价*。所以**不抠 body 文本，拦那发 XHR**。

数据面（STM32F103C8T6 + 无源料实采确认）:
  唯一两个 graphql op：UserInfoGeneral（匿名身份，无用）+ InventoryAndPricesForProducts。
  ⚠ 没有单独的“目录/搜索结果” graphql op —— mpn/厂牌/datasheet/产品页 URL 全部
    SSR 进搜索页 HTML，落在每个 <tr> 行里的 `/<brandSlug>/<mpnSlug>/<desc>/dp/<publicId>`
    链接上。publicId 就是 join 键。

  InventoryAndPricesForProducts -> data.products[]，每个 product：
    publicId                         -> join 键 + 产品编码（element14 order code）
    prices[{minimumQuantity, maximumQuantity, bestPriceValue(含税),
            bestPriceExTaxValue(不含税), bestPriceCurrencyIsoCode(实测 CNY)}]
                                     -> price_breaks（rmb=含税价；CNY 站）
    stock{ totalCount(int), status('IN_STOCK'/…), isOutStock(bool),
           replenishmentLeadTimeInDays, locations[{name,countInStock}] }
                                     -> stock / in_stock / lead_time
    minQuantity                      -> note(moq)

  SSR <tr>（含 /dp/ 链接的行）-> 每行一料：
    dp 链接文本                       -> mpn（展示 MPN，如 STM32F103C8T6TR）
    href 里的 brandSlug               -> brand（如 stmicroelectronics -> STMicroelectronics）
    href 里的 descSlug                -> description（如 mcu-32bit-cortex-m3-72mhz-lqfp）
    href 绝对化                       -> product_url
    行内 datasheet/pdf 链接           -> datasheet

每行 platform 固定 'element14-cn'（本站真源，单一分销商，非聚合器）。

⚠ 反爬：cn.element14.com 中国直营，机房/境内直连可达，**无 PerimeterX/无代理**。
  defense=None（'none' profile，无 warmup 墙）、needs_proxy=False。数据 XHR 在首次
  导航就发，故 script 模式在 goto 前装好嗅探器即可拦到 RESPONSE（不重放、无 token 难题）。
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from contract import Adapter, Row, make_break  # noqa: E402
from engine import q  # noqa: E402

BASE = "https://www.element14.cn"


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


def _pretty_brand(slug: Optional[str]) -> Optional[str]:
    """brandSlug 'stmicroelectronics' / 'texas-instruments' -> 展示厂牌。仅做
    破折号转空格 + 词首大写；已知缩写保留全大写（te/3m/nxp 等）。"""
    if not slug:
        return None
    s = slug.replace("-", " ").strip()
    if not s:
        return None
    keep_upper = {"te", "3m", "nxp", "amd", "st", "ti", "fci", "abb", "nte"}
    words = []
    for w in s.split():
        words.append(w.upper() if w.lower() in keep_upper else (w[:1].upper() + w[1:]))
    return " ".join(words)


def _breaks(prod: dict) -> list:
    """prices[] -> price_breaks。CNY 站：bestPriceValue 是含税单价，挂 rmb；
    bestPriceExTaxValue 是不含税。usd 留空（本站结算货币是 CNY）。"""
    out: list = []
    for pr in prod.get("prices") or []:
        qty = _int(pr.get("minimumQuantity"))
        if qty is None:
            continue
        ccy = (pr.get("bestPriceCurrencyIsoCode") or "").upper()
        val = _float(pr.get("bestPriceValue"))
        rmb = val if ccy == "CNY" else None
        usd = val if ccy == "USD" else None
        out.append(make_break(qty, rmb=rmb, usd=usd))
    return out


def _row(part: str, meta: dict, prod: Optional[dict]) -> Row:
    """一行 = 一条 SSR 行(meta: pid/mpn/brandSlug/descSlug/href/datasheet) join 上
    InventoryAndPrices 里同 publicId 的 prod(库存+阶梯价；可能为 None=未拦到该 pid)。"""
    pid = meta.get("pid")
    stock = lead = None
    in_stock = None
    breaks: list = []
    note_bits = [f"order_code={pid}"] if pid else []
    if prod:
        st = prod.get("stock") or {}
        stock = _int(st.get("totalCount"))
        if st.get("isOutStock") is True:
            in_stock = False
        elif stock is not None:
            in_stock = stock > 0
        elif (st.get("status") or "").upper() == "IN_STOCK":
            in_stock = True
        rlt = _int(st.get("replenishmentLeadTimeInDays"))
        if rlt:
            lead = f"{rlt}d (补货)"
        locs = st.get("locations") or []
        if locs:
            loc = locs[0]
            note_bits.append(f"loc={loc.get('name')}:{_int(loc.get('countInStock'))}")
        breaks = _breaks(prod)
        moq = _int(prod.get("minQuantity"))
        if moq:
            note_bits.append(f"moq={moq}")
    href = meta.get("href")
    return Row(
        part=part,
        platform="element14-cn",
        mpn=meta.get("mpn"),
        brand=_pretty_brand(meta.get("brandSlug")),
        stock=stock,
        in_stock=in_stock,
        price_breaks=breaks,
        lead_time=lead,
        datasheet=meta.get("datasheet"),
        product_url=(BASE + href) if href and href.startswith("/") else href,
        description=(meta.get("descSlug") or "").replace("-", " ").strip() or None,
        note="; ".join(note_bits) or None,
    )


def _inv_index(payloads: list) -> dict:
    """所有 InventoryAndPricesForProducts payload -> {publicId: product}。"""
    idx: dict = {}
    for j in payloads or []:
        if not isinstance(j, dict):
            continue
        for p in (((j.get("data") or {}).get("products")) or []):
            pid = p.get("publicId")
            if pid is not None:
                idx[str(pid)] = p
    return idx


def extract(payload: Any, part: str) -> list[Row]:
    """单 payload 便捷入口（fixture extract 自检用）：只喂一发 InventoryAndPrices
    时，没有 SSR 行表可 join，按 publicId 直出（mpn/brand 缺，order_code 兜底）。
    生产走下面的 script_extract，它 join SSR 行 + XHR。"""
    idx = _inv_index([payload])
    if not idx:
        return []
    return [_row(part, {"pid": pid}, prod) for pid, prod in idx.items()]


def url(part: str) -> str:
    return f"https://cn.element14.com/search?st={q(part)}"


# SSR 行抽取脚本：每个含 /dp/ 链接的 <tr> 抠 pid/mpn/brandSlug/descSlug/href/datasheet。
_DOM_JS = r"""() => {
  const out=[]; const done=new Set();
  document.querySelectorAll('a[href*="/dp/"]').forEach(a=>{
    const href=a.getAttribute('href')||'';
    const m=href.match(/\/([^\/]+)\/([^\/]+)\/([^\/]+)\/dp\/([A-Za-z0-9]+)/);
    if(!m) return;
    const pid=m[4];
    if(done.has(pid)) return;
    done.add(pid);
    let row=a.closest('tr')||a.closest('li')||a.closest('div[class*="product" i]');
    const dsEl=row? row.querySelector('a[href*="datasheet"], a[href$=".pdf"]'):null;
    out.push({
      pid,
      brandSlug:m[1], mpnSlug:m[2], descSlug:m[3],
      href:href,
      mpn:(a.innerText||'').trim().slice(0,60)||m[2].toUpperCase(),
      datasheet: dsEl? dsEl.getAttribute('href'): null
    });
  });
  return out;
}"""


async def script_extract(ctx: Any, part: str) -> list[Row]:
    """script-mode 入口。ctx 是 ScriptCtx（'none' profile，无 warmup，页面未导航）。

    在首次 goto *前* 装好 InventoryAndPricesForProducts 响应嗅探器（该 XHR 在搜索页
    首次导航即发，带全结果的库存+阶梯价）。goto 搜索页 -> 等数据 XHR fire -> 滚动触发
    懒加载 -> 抓 RESPONSE.json（不重放，token/session 由页面自带）。再抠 SSR 行表拿
    mpn/厂牌/产品页 URL/datasheet，按 publicId join 成结构化 Row。"""
    page = ctx.page
    get_inv = ctx.on_response("operationName=InventoryAndPricesForProducts")

    await ctx.goto(url(part))            # 首次导航，数据 XHR 在此 fire
    await page.wait_for_timeout(8000)
    # 滚动触发懒加载（更多结果行 + 其对应的 InventoryAndPrices 续发）
    for _ in range(5):
        try:
            await page.mouse.wheel(0, 800)
        except Exception:
            break
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(3000)

    payloads: list = []
    for r in get_inv():
        try:
            payloads.append(await r.json())
        except Exception:
            pass
    idx = _inv_index(payloads)

    metas: list = []
    try:
        metas = await page.evaluate(_DOM_JS) or []
    except Exception:
        metas = []

    rows: list[Row] = []
    seen: set = set()
    # 主路：SSR 行 join XHR 库存/价
    for meta in metas:
        pid = str(meta.get("pid"))
        if pid in seen:
            continue
        seen.add(pid)
        rows.append(_row(part, meta, idx.get(pid)))
    # 兜底：XHR 里有但 SSR 没出现的 publicId（懒加载错位等），按 order_code 直出
    for pid, prod in idx.items():
        if pid in seen:
            continue
        seen.add(pid)
        rows.append(_row(part, {"pid": pid}, prod))

    if not rows:
        return [Row(part=part, platform="element14-cn",
                    product_url=url(part),
                    note="（无命中 / 未捕获 InventoryAndPricesForProducts）")]
    return rows


ADAPTER = Adapter(
    id="element14-cn",
    tier="more",
    mode="script",
    needs_proxy=False,          # 中国直营，机房/境内直连可达，无代理
    url=url,
    extract=script_extract,
    defense=None,               # 'none' profile — 无反爬墙，无 warmup
    host_key="cn.element14.com",
)
