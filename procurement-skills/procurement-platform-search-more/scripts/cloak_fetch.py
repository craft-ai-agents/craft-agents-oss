#!/usr/bin/env python3
"""
四家之外的其它分销商（立创/LCSC、其它平台或代理）按需采集：用 CloakBrowser 渲染
任意 URL 返回可见文本。这些站多半也有反爬，别用普通 curl/WebFetch。

仅用于 procurement-platform-search 的“四家之外、用户还想要更多货源”那一步；
四家（Digikey/Mouser/云汉/master）用 api_search.py + cloak_search.py，不要用这个。

必须用 cloakbrowser-python 跑，务必加 2>/dev/null（否则日志污染 JSON）：
  cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_fetch.py "<分销商搜索页URL>" 2>/dev/null

  --proxy           走住宅代理（海外站，如美国分销商）；境内站（立创等）不加
  --selector ".x"   只抽匹配元素文本（找到商品行选择器时用，输出更干净）
  --max-chars N     无选择器时整页文本上限（默认 6000）
"""
import argparse
import json
import sys

try:
    from cloakbrowser import launch
except ImportError:
    print(json.dumps({"error": "no cloakbrowser module — 用 cloakbrowser-python 跑本脚本"}, ensure_ascii=False))
    sys.exit(1)

MIHOMO = "http://127.0.0.1:7899"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--proxy", action="store_true", help="走住宅代理（海外站用）")
    ap.add_argument("--selector", default=None, help="只抽该 CSS 选择器命中的元素文本")
    ap.add_argument("--wait", type=int, default=30, help="页面超时秒")
    ap.add_argument("--max-chars", type=int, default=6000, help="无选择器时文本上限")
    a = ap.parse_args()

    kw = {"headless": True, "humanize": True}
    if a.proxy:
        kw["proxy"] = MIHOMO
    b = launch(**kw)
    try:
        p = b.new_page()
        try:
            p.goto(a.url, wait_until="networkidle", timeout=a.wait * 1000)
        except Exception:
            pass
        p.wait_for_timeout(2500)
        if a.selector:
            els = p.query_selector_all(a.selector)
            rows = []
            for e in els[:30]:
                try:
                    rows.append(" ".join((e.inner_text() or "").split()))
                except Exception:
                    pass
            text = "\n".join(r for r in rows if r) or f"（{a.selector} 无命中）"
        else:
            text = p.inner_text("body")[:a.max_chars]
        print(json.dumps({"url": a.url, "text": text}, ensure_ascii=False))
    finally:
        b.close()


if __name__ == "__main__":
    main()
