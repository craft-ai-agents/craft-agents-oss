#!/usr/bin/env python3
"""Render 债权债务对冲协议书 from JSON + INO_SA hedge template."""
from __future__ import annotations

import argparse
import json
import os
import sys

from xlsx_common import load_workbook_keep_all, set_cell


def render(ctx: dict, template: str, out: str) -> str:
    wb = load_workbook_keep_all(template)
    if "对冲协议书" not in wb.sheetnames:
        raise SystemExit(f"缺少 sheet 对冲协议书: {wb.sheetnames}")
    ws = wb["对冲协议书"]
    order = ctx.get("order_no") or ctx.get("po_number") or ""
    set_cell(ws, "A3", f"订单编号：{order}")
    date = ctx.get("order_date") or ctx.get("date") or ""
    set_cell(ws, "G3", f"订单日期：{date}" if date and "日期" not in str(date) else date)
    if ctx.get("party_a"):
        set_cell(ws, "A4", f"甲方:{ctx['party_a']}")
    if ctx.get("party_b"):
        set_cell(ws, "G4", f"乙方：{ctx['party_b']}")
    if ctx.get("contact_a"):
        set_cell(ws, "A5", f"联系人：{ctx['contact_a']}")
    if ctx.get("contact_b"):
        set_cell(ws, "G5", f"联系人：{ctx['contact_b']}")
    if ctx.get("phone_a"):
        set_cell(ws, "A6", f"MB: {ctx['phone_a']}")
    if ctx.get("phone_b"):
        set_cell(ws, "G6", f"MB:{ctx['phone_b']}")
    if ctx.get("address_a"):
        set_cell(ws, "A7", f"公司地址：{ctx['address_a']}")
    if ctx.get("address_b"):
        set_cell(ws, "G7", f"公司地址：{ctx['address_b']}")
    # amount clauses — only if provided (no invention)
    if ctx.get("receivable_cn"):
        set_cell(ws, "A11", ctx["receivable_cn"])
    if ctx.get("payable_cn"):
        set_cell(ws, "A12", ctx["payable_cn"])
    if ctx.get("net_cn"):
        set_cell(ws, "A13", ctx["net_cn"])

    # 采购: headers A1:C2 + D2:K2; data rows start 3. D=型号 E=数量 F=采购价 G=销售价
    purchases = ctx.get("purchase_lines") or []
    if "采购" in wb.sheetnames and purchases:
        pws = wb["采购"]
        for i, it in enumerate(purchases[:20]):
            r = 3 + i
            set_cell(pws, f"D{r}", it.get("part") or it.get("model") or "")
            set_cell(pws, f"E{r}", it.get("qty"))
            set_cell(pws, f"F{r}", it.get("price") or it.get("unit_price"))
            if it.get("sales_price") is not None:
                set_cell(pws, f"G{r}", it["sales_price"])
    # 销售: G=规格型号 H=数量 I=单价, data from row 2
    sales = ctx.get("sales_lines") or []
    if "销售" in wb.sheetnames and sales:
        sws = wb["销售"]
        for i, it in enumerate(sales[:20]):
            r = 2 + i
            set_cell(sws, f"G{r}", it.get("part") or it.get("model") or "")
            set_cell(sws, f"H{r}", it.get("qty"))
            set_cell(sws, f"I{r}", it.get("price") or it.get("unit_price"))

    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--data")
    args = ap.parse_args()
    raw = open(args.data, encoding="utf-8").read() if args.data else sys.stdin.read()
    ctx = json.loads(raw)
    print(render(ctx, args.template, args.out))


if __name__ == "__main__":
    main()
