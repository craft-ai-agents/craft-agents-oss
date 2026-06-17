#!/usr/bin/env python3
"""
核心无 API 平台采集（master + 云汉ickey，ickey.cn=ICKey/云汉芯城），用 CloakBrowser 真 Chromium 过反爬。

master 是 Akamai Bot Manager（curl 403）、云汉是点击验证码——普通 fetch 和轻量无头
浏览器（lightpanda/obscura）都过不了；只有 CloakBrowser（真 Chromium + C++ 级指纹
伪装）实测能过。Digikey/Mouser 有 API，用 api_search.py，别用这个。

必须用 cloakbrowser 的 venv python 跑：
  cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "CL21A106KAYNNNE"

约束（小内存服务器）：串行启动、用完即关，一次只开一个 Chromium，避免 OOM。

取数方式：
- master：抽 .search-result 商品行文本（干净）。走住宅代理。
- 云汉：搜索页 AJAX 拉数据；直接抓 ajax-get-res-v002 的 JSON 响应（每供应商一条），
  归一化成商品行（厂牌/封装/库存/阶梯价 RMB+USD/交期）。境内直连，无需登录。
- 更多原始分销站/聚合站走另一个 skill：procurement-platform-search-more。
"""
import argparse
import json
import urllib.parse

try:
    from cloakbrowser import launch
except ImportError:
    print(json.dumps({"error": "no cloakbrowser module — 用 cloakbrowser-python 跑本脚本"}, ensure_ascii=False))
    import sys
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


def scrape_master(part, wait, limit):
    url = f"https://www.masterelectronics.com/en/keywordsearch?text={_q(part)}"
    b = launch(headless=True, humanize=True, proxy=MIHOMO)
    try:
        p = b.new_page()
        try:
            p.goto(url, wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(2500)
        rows = []
        for e in p.query_selector_all(".search-result")[:limit]:
            try:
                rows.append(" ".join((e.inner_text() or "").split()))
            except Exception:
                pass
        hits = [r for r in rows if r]
        text = "\n".join(hits) or "（无 .search-result 命中——该平台可能无此料）"
        return {"platform": "master", "url": url, "text": text, "hit": bool(hits)}
    finally:
        b.close()


def _ickey_line(prod):
    nums = prod.get("nums") or []
    rmb = prod.get("rmb") or []
    usd = prod.get("usd") or []
    breaks = []
    for i, q in enumerate(nums[:6]):
        r = f"¥{rmb[i]}" if i < len(rmb) else ""
        u = f"/${usd[i]}" if i < len(usd) else ""
        breaks.append(f"{q}{('@' + r + u) if (r or u) else ''}")
    parts = [
        prod.get("pro_name") or prod.get("pro_sno") or "",
        prod.get("pro_maf") or prod.get("standard_maf") or "",
        f"封装{prod.get('packaging')}" if prod.get("packaging") else "",
        f"库存{prod.get('stock')}",
        prod.get("lead_time_cn") or "",
        ("价 " + " ".join(breaks)) if breaks else "",
    ]
    return " | ".join(x for x in parts if x)


def scrape_ickey(part, wait, limit):
    url = f"https://search.ickey.cn/?keyword={_q(part)}&bom_ab=null"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "ajax-get-res-v002" in r.url:
                try:
                    d = r.json()
                except Exception:
                    return
                for g in (d.get("result") or {}).get("group_products") or []:
                    for prod in g.get("products") or []:
                        lines.append(_ickey_line(prod))

        p.on("response", on_resp)
        try:
            p.goto(url, wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(7000)  # 等各供应商 ajax-get-res-v002 跑完
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        text = "\n".join(uniq) or "（云汉无报价命中）"
        return {"platform": "ickey", "url": url, "text": text, "hit": bool(uniq)}
    finally:
        b.close()


def _ickey_replace_line(prod):
    nums = prod.get("nums") or []
    rmb = prod.get("rmb") or []
    breaks = []
    for i, q in enumerate(nums[:5]):
        r = f"¥{rmb[i]}" if i < len(rmb) else ""
        breaks.append(f"{q}{('@' + r) if r else ''}")
    ds = prod.get("data_sheet") or []
    parts = [
        prod.get("pro_name") or prod.get("pro_sno") or "",
        prod.get("short_desc") or "",                      # 规格摘要，用于跟原型号对比
        prod.get("t_cate_name_cn_v2") or "",               # 品类
        f"库存{prod.get('stock')}",
        prod.get("lead_time_cn") or "",
        ("价 " + " ".join(breaks)) if breaks else "",
        ("datasheet:" + ds[0]) if ds else "",
    ]
    return " | ".join(x for x in parts if x)


def scrape_ickey_replace(part, wait, limit):
    """云汉原生替代料接口 ajax-get-replace-product —— 给一个型号返回替代/相似料候选。"""
    url = f"https://search.ickey.cn/?keyword={_q(part)}&bom_ab=null"
    lines = []
    b = launch(headless=True, humanize=True)
    try:
        p = b.new_page()

        def on_resp(r):
            if "ajax-get-replace-product" in r.url:
                try:
                    d = r.json()
                except Exception:
                    return
                for prod in (d.get("result") or {}).get("replace_products") or []:
                    lines.append(_ickey_replace_line(prod))

        p.on("response", on_resp)
        try:
            p.goto(url, wait_until="networkidle", timeout=wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(7000)
        uniq = list(dict.fromkeys(l for l in lines if l))[:limit]
        text = "\n".join(uniq) or "（云汉无替代料命中）"
        return {"platform": "ickey-replace", "url": url, "text": text, "hit": bool(uniq)}
    finally:
        b.close()


SCRAPERS = {
    "master": scrape_master,
    "ickey": scrape_ickey,
    "ickey-replace": scrape_ickey_replace,  # 给型号找替代/相似料（云汉替代接口）
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", required=True)
    ap.add_argument("--source", default="master,ickey",
                    help="逗号分隔，默认 master,ickey；找替代料用 ickey-replace")
    ap.add_argument("--wait", type=int, default=40, help="单页超时秒")
    ap.add_argument("--limit", type=int, default=20, help="每平台最多返回商品行")
    args = ap.parse_args()

    out = {"part": args.part, "results": [], "errors": []}
    for name in [s.strip() for s in args.source.split(",") if s.strip()]:
        fn = SCRAPERS.get(name)
        if not fn:
            out["errors"].append({"platform": name, "error": f"未知平台（可选：{','.join(SCRAPERS)}）"})
            continue
        try:
            # 0 命中时串行回退到型号变体（用完即关、不并发，避免 OOM）；命中后回填查询串。
            res = None
            for q in gen_variants(args.part):
                res = fn(q, args.wait, args.limit)
                if res.get("hit"):
                    if q != args.part:
                        res["matched_query"] = q
                    break
            out["results"].append(res)
        except Exception as e:
            out["errors"].append({"platform": name, "error": str(e)})

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
