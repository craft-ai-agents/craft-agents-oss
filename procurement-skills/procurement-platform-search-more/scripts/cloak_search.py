#!/usr/bin/env python3
"""
扩展货源采集——核心四家（digikey/mouser/master/ickey）之外的更多原始分销站 + 聚合站，
用 CloakBrowser 真 Chromium 过反爬。核心四家走 procurement-platform-search，别用这个。

货源分两类（见底部 SCRAPERS）：
- 原始直营/专用站：通用渲染站（GENERIC 表，渲染搜索页成文本交 Agent 读）+ 一批专用站
  （SPA/有数据接口的拦 XHR 取结构化数据，技术细节见各函数注释）。
- 聚合站：octopart（多分销商报价聚合）——默认不查，仅按需 --source（聚合数据可能滞后，原始站优先）。

本 skill **不默认全查**：按型号品类用 --source 选源（全开几十站串行会很慢）。

必须用 cloakbrowser 的 venv python 跑：
  cloakbrowser-python .agents/skills/procurement-platform-search-more/scripts/cloak_search.py --part "<型号>" --source future,newark

约束（小内存服务器）：串行启动、用完即关，一次只开一个 Chromium，避免 OOM。
"""
import argparse
import json
import re
import sys
import urllib.parse
from functools import partial

try:
    from cloakbrowser import launch
except ImportError:
    print(json.dumps({"error": "no cloakbrowser module — 用 cloakbrowser-python 跑本脚本"}, ensure_ascii=False))
    sys.exit(1)

MIHOMO = "http://127.0.0.1:7899"


def gen_variants(part):
    """型号变体（保守，仅 0 命中回退用）：原始 → 去连字符 → 去末位封装字母。"""
    p = (part or "").strip()
    out = [p]

    def add(v):
        v = (v or "").strip()
        if v and v not in out:
            out.append(v)

    add(p.replace("-", ""))
    if len(p) >= 5 and p[-1].isalpha():  # 末位字母常是封装/卷带后缀
        add(p[:-1])
    return out


def _q(part):
    return urllib.parse.quote(part, safe="")


def scrape_octopart(part, wait, limit):
    """Octopart —— 多分销商报价聚合（Avnet/Newark/Arrow/DigiKey/Mouser/LCSC 等 70M 料）。
    走住宅代理；报价 SSR 在 [data-testid*=offer] 行里。注意：octopart 网页不给干净的替代
    型号列表（"Alternates" 是同型号的分销商报盘替代），找替代料用 --source ickey-replace。"""
    url = f"https://octopart.com/search?q={_q(part)}"
    b = launch(headless=True, humanize=True, proxy=MIHOMO)
    try:
        p = b.new_page()
        try:
            p.goto(url, wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(6000)
        rows = []
        for e in p.query_selector_all("[data-testid*=offer]")[:limit]:
            try:
                rows.append(" ".join((e.inner_text() or "").split()))
            except Exception:
                pass
        uniq = list(dict.fromkeys(r for r in rows if r))
        text = "\n".join(uniq) or "（octopart 无报价命中）"
        return {"platform": "octopart", "url": url, "text": text, "hit": bool(uniq)}
    finally:
        b.close()


def scrape_octopart_alt(part, wait, limit):
    """Octopart 替代料 —— 部件详情页的 Alternate Parts 对比表（含跨品牌替代 + 价/库存/封装
    逐列对比，SiliconExpert 数据，爬网页即得）。走住宅代理。"""
    b = launch(headless=True, humanize=True, proxy=MIHOMO)
    try:
        p = b.new_page()
        try:
            p.goto(f"https://octopart.com/search?q={_q(part)}", wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(3000)
        detail = None
        for a in p.query_selector_all("a"):
            href = a.get_attribute("href") or ""
            if "/part/" in href:
                detail = href if href.startswith("http") else "https://octopart.com" + href
                break
        if not detail:
            return {"platform": "octopart-alt", "url": "", "text": "（octopart 未找到详情页）", "hit": False}
        try:
            p.goto(detail, wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(4000)
        for y in range(0, 5000, 700):
            p.evaluate(f"window.scrollTo(0,{y})")
            p.wait_for_timeout(500)
        p.wait_for_timeout(2000)
        t = p.inner_text("body")
        i = t.find("Alternate Parts")
        if i < 0:
            return {"platform": "octopart-alt", "url": detail, "text": "（octopart 该型号无替代料区）", "hit": False}
        seg = " ".join(t[i:i + 1400].split())
        return {"platform": "octopart-alt", "url": detail, "text": seg, "hit": True}
    finally:
        b.close()


def scrape_verical(part, wait, limit):
    """Verical (Arrow marketplace): 拦截 parametric POST XHR，归一化（型号|品牌|描述|库存|价格|链接）。
    结果页 URL: https://www.verical.com/s/{part}/
    产品链接:   https://www.verical.com/pd/{mfr_code}-undefined-{mpn_lower}-{partId}
    无需代理，机房 IP 实测可达。CSRF token 由浏览器自动携带，无需手动获取。"""
    q = _q(part)
    result_url = f"https://www.verical.com/s/{q}/"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "rest/search/parametric" not in r.url:
                return
            if "json" not in r.headers.get("content-type", ""):
                return
            try:
                d = r.json()
            except Exception:
                return
            for rec in d.get("records") or []:
                mpn = rec.get("mpn") or ""
                mfr = rec.get("manufacturerName") or rec.get("manufacturerCode") or ""
                qty = rec.get("quantity") or 0
                price = rec.get("lowestPrice")
                desc = rec.get("partDescription") or ""
                part_id = rec.get("partId") or ""
                mfr_slug = (rec.get("manufacturerCode") or "").lower().replace(" ", "-")
                link = f"https://www.verical.com/pd/{mfr_slug}-undefined-{mpn.lower()}-{part_id}"
                row = " | ".join(x for x in [
                    mpn, mfr, desc,
                    f"库存{qty:,}" if qty else "库存0",
                    f"${price:.4f}" if price else "",
                    link,
                ] if x)
                lines.append(row)

        p.on("response", on_resp)
        try:
            p.goto("https://www.verical.com", wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(3000)

        search_el = (p.query_selector('#mat-input-2')
                     or p.query_selector('#mat-input-1')
                     or p.query_selector('input[placeholder*="earch"]'))
        if search_el:
            search_el.click()
            p.wait_for_timeout(300)
            search_el.fill(part)
            p.wait_for_timeout(500)
            search_el.press("Enter")
        else:
            try:
                p.goto(result_url, wait_until="domcontentloaded", timeout=wait * 1000)
            except Exception:
                pass

        try:
            p.wait_for_url("**/s/**", timeout=10000)
        except Exception:
            pass
        p.wait_for_timeout(8000)

        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        return {"platform": "verical", "url": p.url or result_url,
                "text": "\n".join(uniq) or "（Verical 无命中）", "hit": bool(uniq)}
    finally:
        b.close()


def _misumi_line(s):
    cats = s.get("categoryList") or []
    cat = (cats[-1].get("categoryName") if cats else "") or s.get("categoryName") or ""
    mn, mx = s.get("minStandardDaysToShip"), s.get("maxStandardDaysToShip")
    days = ""
    if mn is not None and mx is not None:
        days = f"交期{mx}天" if mn == mx else f"交期{mn}-{mx}天"
    url = s.get("seriesUrl") or ""
    if url.startswith("/"):
        url = "https://www.misumi.com.cn" + url
    parts = [
        s.get("seriesName") or s.get("seriesCode") or "",
        s.get("brandName") or "",
        cat,
        days,
        "现货" if s.get("stockItemFlag") == "1" else "",
        f"起订{s.get('minPiecesPerPackage')}" if s.get("minPiecesPerPackage") else "",
        url,
    ]
    return " | ".join(x for x in parts if x)


def scrape_misumi(part, wait, limit):
    """米思米中国 FA 机械件搜索：关键词→可配置系列。拦 app_search XHR，归一化系列
    （系列名/品牌/品类/交期/现货/起订/链接）。注意：米思米配置到订，价格按规格配置后才有，
    系列级无单价——这是 FA 货源线索，不是 MPN 报价。非机械件关键词通常 0 命中。"""
    url = f"https://www.misumi.com.cn/vona2/result/?Keyword={_q(part)}"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "appsearch/app_search" in r.url and "field=@search" in r.url:
                try:
                    d = r.json()
                except Exception:
                    return
                for s in (d.get("data") or {}).get("seriesList") or []:
                    lines.append(_misumi_line(s))

        p.on("response", on_resp)
        try:
            p.goto(url, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(9000)  # 等 app_search XHR 跑完
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        text = "\n".join(uniq) or "（米思米无系列命中——可能非 FA 机械件关键词）"
        return {"platform": "misumi", "url": url, "text": text, "hit": bool(uniq)}
    finally:
        b.close()


def scrape_misumi_jp(part, wait, limit):
    """米思米日本 FA 机械件搜索：关键词/系列号→可配置系列。拦 /api/v1/series/search XHR，
    顶层直接是 seriesList[]（与中国站不同，无嵌套 data）。归一化：系列名/品牌/品类/交期/现货/起订/链接。
    境内机房 IP 实测可直连；机房 IP 被拦时标 🔒 需住宅代理生产验证。"""
    url = f"https://jp.misumi-ec.com/vona2/result/?Keyword={_q(part)}"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "/api/v1/series/search" not in r.url:
                return
            try:
                d = r.json()
            except Exception:
                return
            for s in d.get("seriesList") or []:
                series_code = s.get("seriesCode") or ""
                series_name = s.get("seriesName") or series_code
                brand_name = s.get("brandName") or ""
                cat = s.get("categoryName") or ""
                if not cat:
                    cat_list = s.get("categoryList") or []
                    if cat_list:
                        cat = cat_list[-1].get("categoryName", "")
                mn, mx = s.get("minStandardDaysToShip"), s.get("maxStandardDaysToShip")
                days = ""
                if mn is not None and mx is not None:
                    days = f"交期{mx}天" if mn == mx else f"交期{mn}-{mx}天"
                stock = "现货" if s.get("stockItemFlag") == "1" else ""
                min_pkg = s.get("minPiecesPerPackage")
                moq = f"起订{min_pkg}个" if min_pkg and min_pkg > 1 else ""
                series_url = (f"https://jp.misumi-ec.com/vona2/detail/{series_code}/"
                              if series_code else "")
                row = " | ".join(x for x in [series_name, brand_name, cat, days, stock, moq, series_url] if x)
                if row:
                    lines.append(row)

        p.on("response", on_resp)
        try:
            p.goto(url, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(9000)
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        text = "\n".join(uniq) or "（米思米 JP 无系列命中——可能非 FA 机械件关键词）"
        return {"platform": "misumi-jp", "url": url, "text": text, "hit": bool(uniq)}
    finally:
        b.close()


def scrape_sager(part, wait, limit):
    """Sager Electronics（电源/连接器/机电）：Oracle Commerce Cloud。产品名/厂商在 SSR
    window.state.searchRepository；库存/价格走 ccstore XHR。注意：Sager 对非核心品类(如通用IC)
    无匹配时会返回默认推荐货，故做相关性校验避免误报命中。"""
    url = f"https://www.sager.com/search?keyword={_q(part)}"
    lines = []
    inv_items = {}
    price_items = {}
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "json" not in r.headers.get("content-type", ""):
                return
            rurl = r.url
            try:
                if "ccstore/v1/inventories" in rurl:
                    for item in r.json().get("items", []):
                        inv_items[item.get("skuNumber", "")] = {
                            loc["locationId"]: loc for loc in item.get("locationInventoryInfo", [])
                        }
                elif "ccstore/v1/prices/skus" in rurl:
                    for item in r.json().get("items", []):
                        if isinstance(item, dict):
                            for sku_id, pdata in item.items():
                                price_items[sku_id] = pdata
            except Exception:
                pass

        p.on("response", on_resp)
        try:
            p.goto(url, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(12000)

        recs_raw = p.evaluate("""() => {
            try {
                const sr = window.state && window.state.searchRepository;
                if (!sr) return '[]';
                const page = Object.values(sr.pages || {})[0];
                return JSON.stringify((page && page.results && page.results.records) || []);
            } catch(e) { return '[]'; }
        }""")
        records = json.loads(recs_raw)

        for rec in records[:limit]:
            attrs = rec.get("attributes", {})

            def ga(key, default=""):
                v = attrs.get(key)
                return v[0] if isinstance(v, list) and v else default

            sku_id = ga("sku.repositoryId")
            route = ga("product.route")
            pdata = price_items.get(sku_id, {})
            list_price = pdata.get("listPrice") or ga("sku.minActivePrice")
            tiers = pdata.get("listVolumePrice", {}).get("bulkPrice", {}).get("levels", [])

            inv_loc = inv_items.get(sku_id, {})
            stock_parts = []
            for loc_id, label in [("inStock", "现货"), ("onOrder", "在途"), ("factoryStock", "工厂库存")]:
                qty = inv_loc.get(loc_id, {}).get("stockLevel", 0) or 0
                if qty:
                    stock_parts.append(f"{label}{qty}")
            if not stock_parts:
                mapped_inv = ga("mappedInventory")
                stock_parts = [mapped_inv] if mapped_inv else [ga("product.stock_status") or "缺货"]

            price_str = f"${list_price}" if list_price else "价格登录可见"
            if tiers:
                price_str = f"${tiers[0].get('price')} (1-{tiers[0].get('levelMaximum')}件起)"

            prod_url = f"https://www.sager.com{route}" if route else url
            line_parts = [x for x in [ga("product.displayName"), ga("product.manufacturer_name"),
                                      price_str, " | ".join(stock_parts),
                                      ga("product.lead_time_message"), prod_url] if x]
            lines.append(" | ".join(line_parts))

        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        norm = re.sub(r"[^a-z0-9]", "", part.lower())
        relevant = [l for l in uniq if norm and norm in re.sub(r"[^a-z0-9]", "", l.lower())]
        if uniq and not relevant:
            return {"platform": "sager", "url": url,
                    "text": "（Sager 无精确匹配，返回的是默认推荐，判无此料）", "hit": False}
        return {"platform": "sager", "url": url,
                "text": "\n".join(relevant) or "（无命中）", "hit": bool(relevant)}
    finally:
        b.close()


# Rochester Electronics —— Salesforce B2B Commerce（LWC SPA），搜索/详情/价格三段 POST
_ROC_WEBSTORE = "0ZE4w0000008UotGAE"
_ROC_BASE = "https://www.rocelec.com"
_ROC_SEARCH_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                  f"/search/product-search?language=en-US&asGuest=true&htmlEncode=false")
_ROC_PRODUCT_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                   f"/products/{{id}}?language=en-US&asGuest=true&htmlEncode=false")
_ROC_PRICE_EP = (f"/webruntime/api/services/data/v67.0/commerce/webstores/{_ROC_WEBSTORE}"
                 f"/pricing/products/{{id}}?language=en-US&asGuest=true&htmlEncode=false")


def scrape_rochester(part, wait, limit):
    """Rochester Electronics（停产/EOL 半导体官方授权源）。先 goto 首页拿 Salesforce session，
    再 POST product-search，前 5 条并发拉详情(厂商/库存/datasheet)+价格(首档量价)。"""
    result_url = f"{_ROC_BASE}/search?q={_q(part)}"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()
        try:
            p.goto(_ROC_BASE + "/", wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(4000)

        search_result = p.evaluate(
            f"""async (args) => {{
                const {{searchTerm, pageSize}} = args;
                try {{
                    const r = await fetch('{_ROC_SEARCH_EP}', {{
                        method: 'POST',
                        headers: {{'Content-Type': 'application/json', 'Accept': 'application/json'}},
                        body: JSON.stringify({{searchTerm, pageSize, page: 0}})
                    }});
                    const data = await r.json();
                    return {{ok: r.status < 300, total: data?.productsPage?.total ?? 0,
                        products: (data?.productsPage?.products ?? []).map(pr => ({{
                            id: pr.id, name: pr.name,
                            sku: pr.fields?.StockKeepingUnit?.value ?? pr.name,
                            desc: pr.fields?.Description?.value ?? '',
                            urlName: pr.urlName ?? ''}}))}};
                }} catch(e) {{ return {{ok: false, error: e.message}}; }}
            }}""",
            {"searchTerm": part, "pageSize": min(limit * 2, 20)},
        )
        if not search_result.get("ok") or not search_result.get("products"):
            return {"platform": "rochester", "url": result_url, "text": "（无命中）", "hit": False}

        products = search_result["products"][:limit]
        total = search_result.get("total", 0)
        detail_ids = [pr["id"] for pr in products[:5]]

        details_raw = p.evaluate(
            f"""async (ids) => Promise.all(ids.map(async id => {{
                const r = await fetch('{_ROC_PRODUCT_EP}'.replace('{{id}}', id));
                const d = await r.json(); const f = d.fields || {{}};
                return {{id, datasheet: f.DataSheetURL__c ?? null, stock: f.StockingOptions__c ?? null,
                         mfr: f.Manufacturer__c ?? null}};
            }}))""", detail_ids)
        details = {d["id"]: d for d in (details_raw or [])}

        prices_raw = p.evaluate(
            f"""async (ids) => Promise.all(ids.map(async id => {{
                const r = await fetch('{_ROC_PRICE_EP}'.replace('{{id}}', id));
                const d = await r.json();
                const t = d?.priceAdjustment?.priceAdjustmentTiers ?? [];
                return {{id, price: t.length ? t[0].tierUnitPrice : null}};
            }}))""", detail_ids)
        prices = {pr["id"]: pr for pr in (prices_raw or [])}

        for prod in products:
            pid = prod["id"]
            det = details.get(pid, {})
            price_val = prices.get(pid, {}).get("price")
            desc = re.sub(r"<[^>]+>", "", prod.get("desc", "")).strip()
            prod_link = det.get("datasheet") or f"{_ROC_BASE}/product/{prod.get('urlName') or pid}"
            row = " | ".join(x for x in [
                prod["sku"] or prod["name"], det.get("mfr") or "",
                desc[:60] if desc else None, det.get("stock") or "Unknown",
                f"${price_val} USD" if price_val else "询价", prod_link] if x)
            lines.append(row)
        if total > limit:
            lines.append(f"（共 {total} 个型号，显示前 {len(products)} 条）")
        return {"platform": "rochester", "url": result_url,
                "text": "\n".join(lines) if lines else "（无命中）", "hit": bool(products)}
    finally:
        b.close()


def scrape_ocpneumatics(part, wait, limit):
    """Orange Coast Pneumatics（美国 SMC 气动元件经销）。
    后端是 Meilisearch（ocp.engine.codicloud.dev），前端为 BigCommerce + Vue "SMC Elite Search"。
    策略：打开搜索页 → 填搜索框 → 拦截 /multi-search 响应（index=ocp_product_index）。
    API key 是公开只读 Bearer token（硬编码在 JS bundle 里）。无需代理，机房 IP 实测可达。"""
    _OCP_BASE = "https://ocpneumatics.com"
    _OCP_INDEX = "ocp_product_index"
    q_enc = urllib.parse.quote(part, safe="")
    result_url = f"{_OCP_BASE}/smc-elite-search/?q={q_enc}"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "engine.codicloud.dev/multi-search" not in r.url:
                return
            try:
                body_bytes = r.request.post_data_buffer
                body_json = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
                queries = body_json.get("queries", [])
                if not any(q.get("indexUid") == _OCP_INDEX and q.get("q", "") for q in queries):
                    return
                resp_json = r.json()
                for result in resp_json.get("results", []):
                    if result.get("indexUid") != _OCP_INDEX:
                        continue
                    for hit in result.get("hits", []):
                        sku = hit.get("product_sku", "")
                        name = hit.get("product_name", "")
                        price = hit.get("calculated_price") or hit.get("price") or 0
                        avail = hit.get("availability", "")
                        inv = hit.get("inventory_level", 0)
                        stock = avail if avail else ("in stock" if inv > 0 else "check availability")
                        rel_url = hit.get("url", "")
                        full_url = _OCP_BASE + rel_url if rel_url.startswith("/") else rel_url
                        row = " | ".join(x for x in [
                            sku, name,
                            f"${price:.2f}" if price else "",
                            stock, full_url,
                        ] if x)
                        lines.append(row)
            except Exception:
                pass

        p.on("response", on_resp)
        try:
            p.goto(f"{_OCP_BASE}/smc-elite-search/", wait_until="domcontentloaded", timeout=30000)
        except Exception:
            pass
        p.wait_for_timeout(4000)
        try:
            p.fill("input[type='search']", part)
            p.keyboard.press("Enter")
        except Exception:
            pass
        p.wait_for_timeout(max(wait * 1000 - 4000, 6000))
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        return {"platform": "ocpneumatics", "url": result_url,
                "text": "\n".join(uniq) or "（OCP 无命中）", "hit": bool(uniq)}
    finally:
        b.close()


def scrape_heilind(part, wait, limit):
    """Heilind Electronics（赫联，连接器/机电互连专家）：Coveo 搜索 API。token 从页面
    window.coveoAccessToken 取，页面内 fetch 调 Coveo（同域避 CORS）。索引无库存/价格(站点设计如此)。"""
    search_url = f"https://www.heilind.com/search#q={_q(part)}&t=All"
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()
        try:
            p.goto("https://www.heilind.com/search", wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(4000)

        token = p.evaluate("() => window.coveoAccessToken")
        org_id = p.evaluate("() => window.coveoOrgID") or "heilindelectronicsincproductiono0ya35k8"
        if not token:
            return {"platform": "heilind", "url": search_url, "text": "（无 token，无法搜索）", "hit": False}

        endpoint = f"https://{org_id}.org.coveo.com/rest/search/v2?organizationId={org_id}"
        payload = {
            "q": part, "searchHub": "HEI_Main_Search", "pipeline": "HEI Main Search",
            "numberOfResults": limit, "tab": "All",
            "fieldsToInclude": ["clickableuri", "ec_category", "ec_brand", "hei_manufacturer",
                                "hei_mnf_part_number", "ec_shortdesc", "hei_series"],
        }
        data = p.evaluate(
            """async ([endpoint, payload, token]) => {
                try {
                    const r = await fetch(endpoint, {method: 'POST',
                        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
                        body: JSON.stringify(payload)});
                    return await r.json();
                } catch(e) { return {_fetch_error: e.toString()}; }
            }""", [endpoint, payload, token])
        if not data or "_fetch_error" in data:
            return {"platform": "heilind", "url": search_url, "text": "（API 错误/无命中）", "hit": False}

        lines = []
        for r in (data.get("results") or [])[:limit]:
            raw = r.get("raw") or {}
            pn = raw.get("hei_mnf_part_number") or r.get("title") or ""
            brand = raw.get("ec_brand") or raw.get("hei_manufacturer") or ""
            uri = raw.get("clickableuri") or ""
            product_url = f"https://www.heilind.com{uri}" if uri.startswith("/") else uri
            cats = raw.get("ec_category") or []
            deepest = max(cats, key=len) if cats else ""
            lines.append(" | ".join(x for x in [pn, brand, deepest, product_url] if x))
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        return {"platform": "heilind", "url": search_url,
                "text": "\n".join(uniq) or "（无命中）", "hit": bool(uniq)}
    finally:
        b.close()


# 反爬拦截特征（命中即判 blocked，不再为变体重试浪费时间）
BLOCK_PAT = re.compile(
    r"(access denied|just a moment|verify you are human|captcha|"
    r"pardon our interruption|are you a robot|challenge validation|"
    r"press\s*&?\s*hold|confirm you are a human|before we continue|"
    r"滑动验证|请完成|forbidden|cf-error|403 error)",
    re.I,
)

# ── 通用「原始站」配置表 ──────────────────────────────────────────────
# 每行 = 站点: (搜索URL模板, 是否需住宅代理)。加新站只加一行 URL，不写选择器。
# 抽取策略：渲染成可见文本直接交给 Agent 读（型号/库存/价格由 Agent 解析）。
# ickey/master/octopart 不在此表——它们走专用 scraper（ickey 拦 XHR、master 抽行）。
GENERIC = {
    # ✅ 已验证可抓（服务端渲染，无需代理）——当前可靠新增货源
    "future":   ("https://www.futureelectronics.com/search?q={q}", False),
    "newark":   ("https://www.newark.com/search?st={q}", False),
    "rs-uk":    ("https://uk.rs-online.com/web/c/?searchTerm={q}", False),   # RS 旧平台，服务端渲染
    "rs-jp":    ("https://jp.rs-online.com/web/c/?searchTerm={q}", False),   # RS 日本区
    "monotaro": ("https://www.monotaro.com/s/?q={q}", False),               # 日本 MRO，带部分电子/IC 料，日文页
    "tme":      ("https://www.tme.eu/en/katalog/?queryPhrase={q}", False),  # 波兰/欧洲分销，参数是 queryPhrase
    "lcsc":     ("https://www.lcsc.com/search?q={q}", False),               # 立创国际站(export)
    "szlcsc":   ("https://so.szlcsc.com/global.html?k={q}", False),         # 立创国内商城(RMB/国内现货)，参数是 k
    "xonelec":  ("https://www.xonelec.com/keywordsearching?kword={q}", False),  # X-ON Electronics(原x-on)，会按地区跳转
    "peigenesis": ("https://www.peigenesis.com/product/search?search={q}", False),  # 连接器专家，按连接器型号搜
    "rs-hk":    ("https://hken.rs-online.com/web/c/?searchTerm={q}", False),    # RS 香港(hken，非hk)
    "corestaff": ("https://www.zaikostore.com/zaikostore/stockList?productName_forFind={q}&pageNumber=1&viewCount=50&headerSearch=1", False),  # CoreStaff 日本(ZaikoStore)
    "darisus":  ("https://shop.darisusgmbh.de/advanced_search_result.php?keywords={q}", False),  # 德国连接器/电子
    "componentonline": ("https://www.componentonline.com/search?search_key={q}", False),  # Component Electronics(美)
    # ⚠️ 反爬（Akamai/403）——住宅 IP 信誉被拉黑，网页路径攻不下，需更干净住宅代理重测。
    # element14 不在此（网页被挡）——改走官方 API：api_search.py --source element14（配 ELEMENT14_API_KEY）。
    "avnet":     ("https://www.avnet.com/shop/us/search/?term={q}", True),
    "arrow":     ("https://www.arrow.com/en/search-result.html?keyword={q}", True),
    # rs-us 不在此表——它是 Magento+DataDome+GroupBy 搜索，走专用 scrape_rs_us（拦 XHR+重试）
    # ❌ 不接（已查实，非架构问题）：
    #  rs-cn   —— RS 无可搜中国 storefront（cn 域 Akamai Invalid URL，www?r=cn 甩首页）。
    #  chip1stop —— 整站 502（Azure 网关挂，被 Arrow 吞并后迁移中），可用后再评估；货源≈arrow。
    #  misumi  —— FA 机械件，关键词→可配置系列，与"MPN→报价"数据模型不符；marketplace 按
    #             MPN 搜主流半导体全 0；且 Nuxt 深 SPA，渲染只得外壳。要接需逆向多步 series API，
    #             另立 scraper/skill，且先确认 FA 机械件是否属本采购场景。待用户决策。
}


def scrape_generic(part, wait, limit, *, site, url_tpl, needs_proxy, max_chars=4000):
    """通用原始站：渲染搜索页→取 body 文本→交给 Agent 读。不写选择器。"""
    url = url_tpl.format(q=_q(part))
    kw = {"headless": True, "humanize": True}
    if needs_proxy:
        kw["proxy"] = MIHOMO
    b = launch(**kw)
    try:
        p = b.new_page()
        try:
            p.goto(url, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(5000)
        try:
            text = " ".join((p.inner_text("body") or "").split())
            final_url = p.url
        except Exception:
            text, final_url = "", url
        blocked = bool(BLOCK_PAT.search(text[:3000]))
        hit = (not blocked) and (part.lower() in text.lower())
        return {
            "platform": site,
            "url": final_url,
            "text": text[:max_chars] or "（空白页/未渲染——可能 SPA 未加载或需代理）",
            "hit": hit,
            "blocked": blocked,
        }
    finally:
        b.close()


def scrape_tti(part, wait, limit):
    """TTI（被动/连接器/机电，sager 源头）：PerimeterX Press&Hold 防护。先访问首页让 PX 种
    cookie（首页不弹验证），再同一上下文跳 part-search（过验证后服务端渲染），渲染成文本交 Agent 读。
    需住宅代理。"""
    search = f"https://www.tti.com/content/ttiinc/en/apps/part-search.html?q={_q(part)}"
    b = launch(headless=True, humanize=True, proxy=MIHOMO)
    try:
        p = b.new_page()
        try:
            p.goto("https://www.tti.com/", wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(7000)  # 等 PerimeterX sensor 种 cookie
        try:
            p.goto(search, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(6000)
        text = " ".join((p.inner_text("body") or "").split())
        blocked = bool(BLOCK_PAT.search(text[:3000]))
        hit = (not blocked) and (part.lower() in text.lower())
        return {
            "platform": "tti", "url": search,
            "text": text[:4000] or "（空白页——PerimeterX 预热可能失败）",
            "hit": hit, "blocked": blocked,
        }
    finally:
        b.close()


def _rsus_line(rec):
    m = rec.get("allMeta") or {}
    attrs = m.get("attributes") or {}

    def at(k):
        v = attrs.get(k) or {}
        t = v.get("text") or v.get("numbers") or []
        return t[0] if t else None

    eid = at("entity_id")
    stock = at("additional_inventory")
    price = (m.get("priceInfo") or {}).get("price")
    parts = [
        at("manufacturer_part_number") or "",
        (m.get("brands") or [""])[0],
        (rec.get("_t") or "")[:60],
        f"库存{stock}" if stock not in (None, "") else "",
        f"${price}" if price else "",
        f"https://us.rs-online.com/web/p/products/{eid}" if eid else "",
    ]
    return " | ".join(str(x) for x in parts if x)


def scrape_rs_us(part, wait, limit):
    """RS 美区（=原 Allied）：Magento + GroupBy 搜索 API + DataDome 反爬。
    拦 groupby/search/endpoint 取 records；DataDome 间歇拦截，goto 重试至 3 次。
    需住宅代理（境外+反爬）——仅生产带 mihomo 时可用。"""
    base = f"https://us.rs-online.com/catalogsearch/result/?q={_q(part)}"
    recs = []
    b = launch(headless=True, humanize=True, proxy=MIHOMO)
    try:
        p = b.new_page()

        def on_resp(r):
            if "groupby/search/endpoint" in r.url and not recs:
                try:
                    recs.extend((r.json() or {}).get("records") or [])
                except Exception:
                    pass

        p.on("response", on_resp)
        for attempt in range(3):
            if recs:
                break
            try:
                p.goto(f"{base}&_a={attempt}", wait_until="domcontentloaded", timeout=wait * 1000)
            except Exception:
                pass
            p.wait_for_timeout(9000)
        lines = [l for l in (_rsus_line(r) for r in recs[:limit]) if l]
        text = "\n".join(lines) or "（rs-us 无命中或 DataDome 持续拦截）"
        return {"platform": "rs-us", "url": base, "text": text, "hit": bool(lines)}
    finally:
        b.close()


def scrape_jbchip(part, wait, limit):
    """京北通宇电子元器件商城（jbchip.com，中国自营+代销）：Vue SPA。必须先 goto 根路径让
    Vue Router 加载完，再 SPA 内跳转触发搜索 XHR /api/item/goods/v1/<token>（token 动态加密只能拦）。"""
    result_url = f"https://www.jbchip.com/ProductDetailSearch?keywords={_q(part)}&searchFieldType=0"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "/api/item/goods/v1/" not in r.url:
                return
            try:
                d = r.json()
                for rec in (d.get("data") or {}).get("records") or []:
                    stock = str(rec.get("goodsNumber") or rec.get("ty_mall_goods_number") or 0)
                    price = rec.get("stepMinPrices") or ""
                    if not price:
                        dp = rec.get("discountPrice") or {}
                        if dp:
                            price = str(min(dp.values(), key=lambda x: float(x) if x else 9999))
                    pluid = rec.get("pluid") or rec.get("ty_mall_goods_id") or ""
                    link = f"https://www.jbchip.com/ProductDetail/{pluid}" if pluid else result_url
                    row = " | ".join(x for x in [
                        rec.get("goodsName") or "", rec.get("brandName") or "",
                        f"库存{stock}", f"¥{price}" if price else "",
                        rec.get("封装") or rec.get("pack") or "", link] if x)
                    if row:
                        lines.append(row)
            except Exception:
                pass

        p.on("response", on_resp)
        try:
            p.goto("https://www.jbchip.com/", wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(8000)  # 等 Vue Router chunk 懒加载
        try:
            p.goto(result_url, wait_until="domcontentloaded", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(9000)
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        return {"platform": "jbchip", "url": result_url,
                "text": "\n".join(uniq) or "（无命中）", "hit": bool(uniq)}
    finally:
        b.close()


SCRAPERS = {
    # ── 聚合站（默认不查，按需 --source；聚合数据可能滞后，原始站优先）──
    "octopart": scrape_octopart,        # 多分销商报价聚合（Avnet/Newark/Arrow/DigiKey/Mouser/LCSC 等）
    "octopart-alt": scrape_octopart_alt,  # octopart 部件详情页的跨品牌替代料对比表
    # ── 原始直营/专用站 ──
    "misumi": scrape_misumi,     # FA 机械件关键词搜索（专用 XHR 拦截，非 MPN 报价）
    "misumi-jp": scrape_misumi_jp,  # 米思米日本，/api/v1/series/search，字段同构，境内直连
    "verical": scrape_verical,  # Arrow Verical marketplace，拦 parametric POST，无需代理
    "sager": scrape_sager,      # 电源/连接器/机电，Oracle Commerce(SSR+ccstore XHR)
    "rochester": scrape_rochester,  # 停产/EOL 半导体授权源，Salesforce B2B 三段 POST
    "heilind": scrape_heilind,  # 连接器/机电专家，Coveo 搜索 API
    "ocpneumatics": scrape_ocpneumatics,  # OC Pneumatics，SMC 气动经销，Meilisearch multi-search
    "jbchip": scrape_jbchip,    # 京北通宇电子商城(中国)，Vue SPA 拦 /api/item/goods/v1
    "rs-us": scrape_rs_us,      # RS美区(=Allied)，GroupBy搜索API+DataDome重试，需住宅代理
    "tti": scrape_tti,          # 被动/连接器/机电(sager源头)，首页预热过 PerimeterX，需住宅代理
}

# 把通用原始站注册进同一张分发表，main() 无需加任何分支
for _site, (_tpl, _proxy) in GENERIC.items():
    SCRAPERS[_site] = partial(scrape_generic, site=_site, url_tpl=_tpl, needs_proxy=_proxy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", required=True)
    ap.add_argument("--source", default="",
                    help="逗号分隔，必填（本 skill 按需选源，不默认全查）。聚合站 octopart 仅按需查。")
    ap.add_argument("--wait", type=int, default=40, help="单页超时秒")
    ap.add_argument("--limit", type=int, default=20, help="每平台最多返回商品行")
    args = ap.parse_args()

    names = [s.strip() for s in args.source.split(",") if s.strip()]
    if not names:
        print(json.dumps({"part": args.part, "results": [], "errors": [
            {"error": "请用 --source 指定货源（按型号品类选），可选：" + ",".join(SCRAPERS)}]},
            ensure_ascii=False, indent=2))
        return

    out = {"part": args.part, "results": [], "errors": []}
    for name in names:
        fn = SCRAPERS.get(name)
        if not fn:
            out["errors"].append({"platform": name, "error": f"未知平台（可选：{','.join(SCRAPERS)}）"})
            continue
        try:
            # 0 命中时串行回退到型号变体（用完即关、不并发，避免 OOM）；命中后回填查询串。
            # 被反爬拦截（blocked）也立即停——再试变体也是同样的拦截，纯浪费。
            res = None
            for q in gen_variants(args.part):
                res = fn(q, args.wait, args.limit)
                if res.get("hit") or res.get("blocked"):
                    if res.get("hit") and q != args.part:
                        res["matched_query"] = q
                    break
            out["results"].append(res)
        except Exception as e:
            out["errors"].append({"platform": name, "error": str(e)})

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
