#!/usr/bin/env python3
"""订单编号 → 美金请款发票 PI 的 context JSON（喂给 render_pi.py）。

读飞书「客户订单审批」表里某个客户订单编号的所有货品行，配上客户固定抬头（customers.json），
组装成 render_pi.py 要的 JSON 打到 stdout。

用法：
  python3 build_pi_context.py --order 8828984 > ctx.json
  # 或直接接管道：
  python3 build_pi_context.py --order 8828984 | uv run --with openpyxl python3 render_pi.py \
      --template templates/美金请款发票模板PI.xlsx --out "PI_8828984.xlsx"

依赖：本机 lark-cli 已用 user 身份登录且有 base 读权限（--as user）。
取数策略：拉全表再按订单编号在本地过滤（飞书 filter-json 形状不稳，全量过滤最省心）。
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

BASE_TOKEN = "EWoFbgsDxaBA8LsLxWrce74tnPc"        # 紧急调度客户需求项目管理表20251011
ORDER_TABLE = "tbldjCzwLk7qBWuv"                   # 客户订单审批
FIELDS = ["客户订单编号", "客户全称", "下单型号", "物料名称", "数量", "单价", "币种", "计量单位", "交易条件", "订单日期"]


def _lark_records(base_token, table_id, fields, limit=200, offset=0):
    cmd = ["lark-cli", "--format", "json", "base", "+record-list", "--as", "user",
           "--base-token", base_token, "--table-id", table_id,
           "--limit", str(limit), "--offset", str(offset)]
    for f in fields:
        cmd += ["--field-id", f]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try:
        d = json.loads(out)
    except json.JSONDecodeError:
        sys.exit("lark-cli 返回非 JSON（可能未登录/无权限）。先确认 `lark-cli auth status`。")
    if not d.get("ok", False):
        sys.exit(f"读飞书表失败：{json.dumps(d.get('error', d), ensure_ascii=False)[:200]}")
    data = d.get("data", {}) or {}
    return data.get("data") or [], data.get("fields") or [], data.get("has_more", False)


def _scalar(v):
    if isinstance(v, list):
        return v[0] if v else ""
    return "" if v is None else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--order", required=True, help="客户订单编号")
    ap.add_argument("--customers", default=None, help="customers.json 路径（默认取本 skill 根目录）")
    ap.add_argument("--date", default=None, help="发票日期 YYYYMMDD（默认今天）")
    ap.add_argument("--base-token", default=BASE_TOKEN)
    ap.add_argument("--table-id", default=ORDER_TABLE)
    args = ap.parse_args()

    # 拉全表（分页）
    rows, cols, off = [], None, 0
    while True:
        batch, cols, more = _lark_records(args.base_token, args.table_id, FIELDS, offset=off)
        rows += batch
        if not more or not batch:
            break
        off += len(batch)
    idx = {c: i for i, c in enumerate(cols)}

    def g(r, name):
        return _scalar(r[idx[name]]) if name in idx else ""

    order_rows = [r for r in rows if str(g(r, "客户订单编号")).strip() == args.order]
    if not order_rows:
        sys.exit(f"订单编号「{args.order}」在「客户订单审批」里没找到货品行。")

    cur = str(g(order_rows[0], "币种")).upper()
    if cur and cur != "USD":
        sys.exit(
            f"订单「{args.order}」币种是 {cur}，不是 USD —— 美金 PI 只处理 USD 单；"
            f"JPY 单请用日本請求書：scripts/render_jp_invoice.py + templates/followup/jp-ino-invoice/blank.xlsx"
            f"（见 SKILL.md「已实现：日本請求書」）。"
        )

    # 客户抬头
    cust_full = str(g(order_rows[0], "客户全称"))
    cust_path = args.customers or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "customers.json")
    cust_map = json.load(open(cust_path, encoding="utf-8")).get("customers", {}) if os.path.exists(cust_path) else {}
    bill_to, contact = None, cust_full
    for key, info in cust_map.items():
        if key and key in cust_full:
            bill_to = dict(info)
            contact = cust_full.replace(key, "").strip()  # 余下部分当联系人
            break
    if bill_to is None:
        bill_to = {"name": cust_full, "address": "", "tel": "", "_warn": "未在 customers.json 命中该客户，地址/电话为空，需补"}
    # 把联系人拼进 tel（日式：「075-... 高倉様」）
    tel = bill_to.get("tel", "")
    if contact:
        tel = (tel + " " if tel else "") + contact + "様"
    bill_to = {"name": bill_to.get("name", ""), "address": bill_to.get("address", ""), "tel": tel}

    items = []
    for r in order_rows:
        items.append({
            "part": str(g(r, "下单型号")).strip(),
            "qty": g(r, "数量"),
            "desc": str(g(r, "物料名称")).strip(),
            "price": g(r, "单价"),
        })

    date = args.date or datetime.date.today().strftime("%Y%m%d")
    ctx = {
        "invoice_no": args.order,
        "invoice_date": date,
        "bill_to": bill_to,
        "ship_to": bill_to,
        "po_number": args.order,
        "terms": str(g(order_rows[0], "交易条件")),
        "ship_via": "",
        "items": items,
    }
    if "_warn" in str(cust_map):
        pass
    json.dump(ctx, sys.stdout, ensure_ascii=False, indent=2)
    print()
    if not bill_to["address"]:
        sys.stderr.write(f"⚠ 客户「{cust_full}」未在 customers.json 命中，Bill To 地址/电话为空，需补对照表。\n")


if __name__ == "__main__":
    main()
