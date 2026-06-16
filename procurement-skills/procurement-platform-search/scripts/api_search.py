#!/usr/bin/env python3
"""
平台 API 搜索（Digikey + Mouser）。纯标准库，无第三方依赖。

凭证从环境变量读（部署在服务器 /etc/craft-agent.env，systemd 注入，agent 的
Bash 子进程继承）：
  DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET   Digikey API（OAuth2 client_credentials）
  MOUSER_API_KEY                              Mouser API（单 key）

海外 API 出口走代理：脚本自动读 HTTP_PROXY/HTTPS_PROXY（systemd 已设 mihomo 7899）。

用法：
  python3 api_search.py --part "STM32F103C8T6"                 # Digikey + Mouser
  python3 api_search.py --part "STM32F103C8T6" --source digikey
  python3 api_search.py --part "STM32F103C8T6" --limit 5

输出：归一化 JSON（platform/mpn/manufacturer/description/stock/price/datasheet/url），
失败项写进 errors，不抛栈，方便 agent 直接读。
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
    """型号变体（保守，仅 0 命中回退用）：原始 → 去连字符 → 去末位封装字母。
    命中后由调用方回填实际命中的查询串，避免把"去 S"当成完全等价。"""
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


def _post(url, data, headers):
    body = data if isinstance(data, bytes) else data.encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    # urlopen 默认按 *_PROXY 环境变量走代理
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def digikey_token(client_id, client_secret):
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    })
    out = _post(
        "https://api.digikey.com/v1/oauth2/token",
        data,
        {"Content-Type": "application/x-www-form-urlencoded"},
    )
    return out["access_token"]


def search_digikey(part, limit):
    cid = os.environ.get("DIGIKEY_CLIENT_ID")
    secret = os.environ.get("DIGIKEY_CLIENT_SECRET")
    if not cid or not secret:
        raise RuntimeError("缺 DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET")
    token = digikey_token(cid, secret)
    out = _post(
        "https://api.digikey.com/products/v4/search/keyword",
        json.dumps({"Keywords": part, "Limit": limit}),
        {
            "Authorization": "Bearer " + token,
            "X-DIGIKEY-Client-Id": cid,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    results = []
    for p in (out.get("Products") or [])[:limit]:
        price = None
        if p.get("UnitPrice") not in (None, 0):
            price = p.get("UnitPrice")
        results.append({
            "platform": "digikey",
            "mpn": p.get("ManufacturerProductNumber"),
            "manufacturer": (p.get("Manufacturer") or {}).get("Name"),
            "description": (p.get("Description") or {}).get("ProductDescription"),
            "stock": p.get("QuantityAvailable"),
            "price": price,
            "datasheet": p.get("DatasheetUrl"),
            "url": p.get("ProductUrl"),
        })
    return results


def search_mouser(part, limit):
    key = os.environ.get("MOUSER_API_KEY")
    if not key:
        raise RuntimeError("缺 MOUSER_API_KEY")
    url = "https://api.mouser.com/api/v1/search/keyword?apiKey=" + urllib.parse.quote(key)
    out = _post(
        url,
        json.dumps({"SearchByKeywordRequest": {"keyword": part, "records": limit}}),
        {"Content-Type": "application/json"},
    )
    errs = out.get("Errors") or []
    if errs:
        raise RuntimeError("; ".join(e.get("Message", str(e)) for e in errs))
    results = []
    for p in ((out.get("SearchResults") or {}).get("Parts") or [])[:limit]:
        breaks = p.get("PriceBreaks") or []
        price = breaks[0].get("Price") if breaks else None
        results.append({
            "platform": "mouser",
            "mpn": p.get("ManufacturerPartNumber"),
            "manufacturer": p.get("Manufacturer"),
            "description": p.get("Description"),
            "stock": p.get("Availability"),
            "price": price,
            "datasheet": p.get("DataSheetUrl"),
            "url": p.get("ProductDetailUrl"),
        })
    return results


def search_vanlinkon(part, limit):
    """
    连可连(vanlinkon.com) JSON API 搜索。
    端点：https://api.vanlinkon.com/api/search?keyword=<part>
    该子域名无境外 H2 WAF 限制，纯 HTTP 直接访问，不需要浏览器。
    返回归一化结果列表（与 digikey/mouser 同格式）。
    """
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
    warehouses = data.get("data") or []
    for wh in warehouses:
        wh_name = wh.get("name", "")
        for p in wh.get("products") or []:
            model = p.get("model_number") or ""
            key = f"{model}|{wh_name}"
            if key in seen:
                continue
            seen.add(key)

            brand = p.get("product_category") or ""
            stock = p.get("stock") or 0
            price = p.get("inventory_price")
            product_id = p.get("product_id") or ""
            delivery = p.get("delivery_date") or ""
            spec = p.get("specification") or ""

            results.append({
                "platform": "vanlinkon",
                "mpn": model,
                "manufacturer": brand,
                "description": spec or p.get("product_name") or "",
                "stock": stock,
                "price": price,
                "currency": "CNY",
                "url": (
                    f"https://www.vanlinkon.com/product/{product_id}"
                    if product_id else url
                ),
                "datasheet": None,
                "warehouse": wh_name,
                "delivery_date": delivery,
            })
            if len(results) >= limit:
                return results
    return results


SOURCES = {"digikey": search_digikey, "mouser": search_mouser, "vanlinkon": search_vanlinkon}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", required=True)
    ap.add_argument("--source", default="digikey,mouser",
                    help="逗号分隔，默认 digikey,mouser；国内平台加 vanlinkon")
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    out = {"part": args.part, "results": [], "errors": []}
    names = [s.strip() for s in args.source.split(",") if s.strip()]

    def run(name):
        fn = SOURCES.get(name)
        if not fn:
            return name, None, "未知平台（仅 digikey/mouser/vanlinkon 有 API）"
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

    # 多平台并发查询
    with ThreadPoolExecutor(max_workers=max(1, len(names))) as ex:
        for name, results, err in ex.map(run, names):
            if err:
                out["errors"].append({"platform": name, "error": err})
            else:
                out["results"].extend(results)

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
