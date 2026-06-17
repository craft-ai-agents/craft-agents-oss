#!/usr/bin/env python3
"""
扩展货源 API 搜索（element14 + 连可连vanlinkon）。纯标准库，无第三方依赖。
核心四家的 digikey/mouser 走 procurement-platform-search 的 api_search.py，别用这个。

凭证从环境变量读（部署在服务器 /etc/craft-agent.env，systemd 注入）：
  ELEMENT14_API_KEY    element14/Farnell/Newark Product Search API（partner.element14.com 免费注册）
  ELEMENT14_STORE_ID   可选，默认 sg.element14.com
连可连(vanlinkon)无需 key（公开 JSON API，境内直连）。

海外 API 出口走代理：脚本自动读 HTTP_PROXY/HTTPS_PROXY（systemd 已设 mihomo 7899）。

用法：
  python3 api_search.py --part "STM32F103C8T6" --source vanlinkon
  python3 api_search.py --part "STM32F103C8T6" --source element14   # 需 ELEMENT14_API_KEY

输出：归一化 JSON（platform/mpn/manufacturer/description/stock/price/datasheet/url）。
"""
import argparse
import json
import os
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

TIMEOUT = 25


def gen_variants(part):
    """型号变体（保守，仅 0 命中回退用）：原始 → 去连字符 → 去末位封装字母。"""
    p = (part or "").strip()
    out = [p]

    def add(v):
        v = (v or "").strip()
        if v and v not in out:
            out.append(v)

    add(p.replace("-", ""))
    if len(p) >= 5 and p[-1].isalpha():  # 末位字母常是封装/卷带后缀（如 Tape&Reel 的 S）
        add(p[:-1])
    return out


def search_element14(part, limit):
    """element14/Farnell/Newark 官方 Product Search REST API（api.element14.com/catalog/products）。
    需 ELEMENT14_API_KEY（partner.element14.com 免费注册）；store 默认 sg.element14.com。
    注：未实测——拿到 key 后按真实响应校字段名。"""
    key = os.environ.get("ELEMENT14_API_KEY")
    if not key:
        raise RuntimeError("缺 ELEMENT14_API_KEY（partner.element14.com 注册 Product Search API）")
    store_id = os.environ.get("ELEMENT14_STORE_ID", "sg.element14.com")

    def call(term):
        params = {
            "term": term,
            "storeInfo.id": store_id,
            "resultsSettings.offset": 0,
            "resultsSettings.numberOfResults": limit,
            "resultsSettings.responseGroup": "large",
            "callInfo.responseDataFormat": "json",
            "callInfo.apiKey": key,
        }
        url = "https://api.element14.com/catalog/products?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # 先按厂商料号精确搜，0 命中退一般关键词
    products = []
    for term in (f"manuPartNum:{part}", f"any:{part}"):
        data = call(term)
        root = data.get("keywordSearchReturn") or data.get("manufacturerPartNumberSearchReturn") or {}
        products = root.get("products") or []
        if products:
            break

    results = []
    for p in products[:limit]:
        prices = p.get("prices") or []
        datasheets = p.get("datasheets") or []
        stock = p.get("stock") or {}
        results.append({
            "platform": "element14",
            "mpn": p.get("translatedManufacturerPartNumber") or p.get("manufacturerPartNumber"),
            "manufacturer": p.get("brandName"),
            "description": p.get("displayName"),
            "stock": stock.get("level"),
            "price": prices[0].get("cost") if prices else None,
            "datasheet": datasheets[0].get("url") if datasheets else None,
            "url": p.get("productURL"),
            "sku": p.get("sku"),
            "moq": p.get("translatedMinimumOrderQuality"),
            "store": store_id,
        })
    return results


def search_vanlinkon(part, limit):
    """连可连(vanlinkon.com) JSON API：https://api.vanlinkon.com/api/search?keyword=<part>
    该子域无境外 WAF，纯 HTTP 直连，无需浏览器。多仓报盘（自营/代销/RS），含库存/¥价/交期。"""
    url = f"https://api.vanlinkon.com/api/search?keyword={urllib.parse.quote(part, safe='')}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.vanlinkon.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))

    if data.get("status") != "success" or data.get("code") != 200:
        return []

    results = []
    seen = set()
    for wh in data.get("data") or []:
        wh_name = wh.get("name", "")
        for p in wh.get("products") or []:
            model = p.get("model_number") or ""
            key = f"{model}|{wh_name}"
            if key in seen:
                continue
            seen.add(key)
            product_id = p.get("product_id") or ""
            results.append({
                "platform": "vanlinkon",
                "mpn": model,
                "manufacturer": p.get("product_category") or "",
                "description": p.get("specification") or p.get("product_name") or "",
                "stock": p.get("stock") or 0,
                "price": p.get("inventory_price"),
                "currency": "CNY",
                "url": f"https://www.vanlinkon.com/product/{product_id}" if product_id else url,
                "datasheet": None,
                "warehouse": wh_name,
                "delivery_date": p.get("delivery_date") or "",
            })
            if len(results) >= limit:
                return results
    return results


SOURCES = {"element14": search_element14, "vanlinkon": search_vanlinkon}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", required=True)
    ap.add_argument("--source", default="vanlinkon",
                    help="逗号分隔，默认 vanlinkon；element14 需 ELEMENT14_API_KEY")
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    out = {"part": args.part, "results": [], "errors": []}
    names = [s.strip() for s in args.source.split(",") if s.strip()]

    def run(name):
        fn = SOURCES.get(name)
        if not fn:
            return name, None, "未知平台（仅 element14/vanlinkon 有 API）"
        try:
            # 0 命中时自动回退到型号变体；命中后回填实际命中的查询串
            for q in gen_variants(args.part):
                results = fn(q, args.limit)
                if results:
                    if q != args.part:
                        for r in results:
                            r["matched_query"] = q
                    return name, results, None
            return name, [], None
        except urllib.error.HTTPError as e:
            return name, None, f"HTTP {e.code}: {e.read()[:200].decode('utf-8','ignore')}"
        except Exception as e:
            return name, None, str(e)

    with ThreadPoolExecutor(max_workers=max(1, len(names))) as ex:
        for name, results, err in ex.map(run, names):
            if err:
                out["errors"].append({"platform": name, "error": err})
            else:
                out["results"].extend(results)

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
