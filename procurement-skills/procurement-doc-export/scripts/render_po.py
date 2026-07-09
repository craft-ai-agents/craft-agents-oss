#!/usr/bin/env python3
"""Render purchase orders: far | sz-ino-contract-zh | ino-contract-en.

Context switches:
  tax_mode: inclusive | exclusive  (sz-ino-contract-zh)
  ship_to_mode: japan | shenzhen   (ino-contract-en)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from xlsx_common import adjust_item_block, load_single_sheet, set_cell


def _render_far(ctx: dict, template: str, out: str) -> str:
    wb, ws = load_single_sheet(template, "第1页")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 12
    # items 11-12 (2 slots), subtotal 13
    total_row = adjust_item_block(
        ws, item_start=11, default_slots=2, n=n, total_or_next_row=13, max_col=max_col
    )
    # Labels H*:I*; values live in J*:L* merges (not I*).
    set_cell(ws, "D5", ctx.get("po_number") or "")
    set_cell(ws, "J5", ctx.get("po_date") or ctx.get("date") or "")
    if ctx.get("buyer_name"):
        set_cell(ws, "D6", ctx["buyer_name"])
    set_cell(ws, "J6", ctx.get("supplier_name") or "")
    if ctx.get("buyer_contact"):
        set_cell(ws, "D7", ctx["buyer_contact"])
    set_cell(ws, "J7", ctx.get("supplier_contact") or "")
    if ctx.get("buyer_phone"):
        set_cell(ws, "D8", ctx["buyer_phone"])
    set_cell(ws, "J8", ctx.get("supplier_phone") or "")
    if ctx.get("ship_address"):
        set_cell(ws, "D9", ctx["ship_address"])
    set_cell(ws, "J9", ctx.get("supplier_address") or "")
    for i, it in enumerate(items):
        r = 11 + i
        set_cell(ws, f"B{r}", i + 1)
        set_cell(ws, f"C{r}", it.get("brand") or "")
        set_cell(ws, f"D{r}", it.get("part") or it.get("model") or "")
        set_cell(ws, f"E{r}", it.get("unit") or "PCS")
        set_cell(ws, f"F{r}", it.get("qty"))
        set_cell(ws, f"G{r}", it.get("batch") or it.get("dc") or "")
        set_cell(ws, f"I{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"K{r}", f"=F{r}*I{r}")
        set_cell(ws, f"L{r}", it.get("delivery") or it.get("lead_time") or "")
    last = 10 + n
    set_cell(ws, f"K{total_row}", f"=SUM(K11:K{last})")
    set_cell(ws, f"E{total_row + 1}", f"=K{total_row}")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _render_sz_zh(ctx: dict, template: str, out: str) -> str:
    wb, ws = load_single_sheet(template, "Sheet1")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 12
    # items 10-11 (2), 合计 A12
    total_row = adjust_item_block(
        ws, item_start=10, default_slots=2, n=n, total_or_next_row=12, max_col=max_col
    )
    po = ctx.get("po_number") or ""
    set_cell(ws, "A3", f"订单编号：{po}" if po and not str(po).startswith("订单") else po)
    date = ctx.get("po_date") or ctx.get("date") or ""
    set_cell(ws, "E3", f"订单日期：{date}" if date and "日期" not in str(date) else date)
    set_cell(ws, "E4", f"乙方（供货方）：{ctx.get('supplier_name') or ''}")
    set_cell(ws, "E5", f"联系人：{ctx.get('supplier_contact') or ''}")
    set_cell(ws, "E6", f"MB：{ctx.get('supplier_phone') or ''}")
    set_cell(ws, "E7", f"公司地址：{ctx.get('supplier_address') or ''}")
    tax_mode = (ctx.get("tax_mode") or "inclusive").lower()
    if tax_mode in ("exclusive", "未税", "ex"):
        set_cell(ws, "A14", "税率：未税")
        set_cell(ws, "G9", "单价(未税)")
    else:
        set_cell(ws, "A14", "税率：13%增值税（含税）")
        set_cell(ws, "G9", "单价(含税)")
    for i, it in enumerate(items):
        r = 10 + i
        set_cell(ws, f"A{r}", i + 1)
        set_cell(ws, f"B{r}", it.get("brand") or "")
        set_cell(ws, f"C{r}", it.get("part") or it.get("model") or "")
        set_cell(ws, f"D{r}", it.get("unit") or "PCS")
        set_cell(ws, f"E{r}", it.get("qty"))
        set_cell(ws, f"F{r}", it.get("batch") or it.get("dc") or "")
        set_cell(ws, f"G{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"H{r}", f"=E{r}*G{r}")
        set_cell(ws, f"I{r}", it.get("delivery") or "")
        set_cell(ws, f"J{r}", it.get("note") or "")
    last = 9 + n
    # 合计 row: leave label; amount if formula cell known — set H total if present
    set_cell(ws, f"H{total_row}", f"=SUM(H10:H{last})")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


# Default addresses measured from samples (blank already has Shenzhen buyer ship-to)
_JAPAN_SHIP = "Ino Electronics Co.,Ltd. / Japan warehouse (set per business)"
_JAPAN_BILL = "Ino Electronics Co.,Ltd."
_SZ_SHIP = "Shenzhen Ino Electronic Technology Co., Ltd."
_FAR_BILL = "F.A.R Pacific Holdings Limited"


def _render_ino_en(ctx: dict, template: str, out: str) -> str:
    wb, ws = load_single_sheet(template, "Sheet1")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 12
    # items 14-15 (2), total labels row 16
    total_row = adjust_item_block(
        ws, item_start=14, default_slots=2, n=n, total_or_next_row=16, max_col=max_col
    )
    set_cell(ws, "A8", ctx.get("currency") or "USD")
    set_cell(ws, "B8", ctx.get("po_sent_by") or "")
    set_cell(ws, "C8", ctx.get("po_number") or "")
    set_cell(ws, "D8", ctx.get("ship_via") or "")
    set_cell(ws, "F8", ctx.get("terms") or "")
    set_cell(ws, "G8", ctx.get("delivery_date") or "")
    set_cell(ws, "A10", f"Supplier:\n{ctx.get('supplier_name') or ''}\n{ctx.get('supplier_address') or ''}")
    mode = (ctx.get("ship_to_mode") or "shenzhen").lower()
    if mode in ("japan", "jp", "日本"):
        ship = ctx.get("ship_to") or _JAPAN_SHIP
        bill = ctx.get("bill_to") or _JAPAN_BILL
        set_cell(ws, "D1", ctx.get("buyer_header") or "Ino Electronics Co., Ltd.")
    else:
        ship = ctx.get("ship_to") or _SZ_SHIP
        bill = ctx.get("bill_to") or _FAR_BILL
        set_cell(ws, "D1", ctx.get("buyer_header") or "Shenzhen Ino Electronics Technology Co., Ltd.")
    set_cell(ws, "C10", f"Ship to:\n{ship}")
    set_cell(ws, "F10", f"Bill to:\n{bill}")
    if ctx.get("contact"):
        set_cell(ws, "D2", f"Contact Person: {ctx['contact']}")
    if ctx.get("tel"):
        set_cell(ws, "G2", f"Tel: {ctx['tel']}")
    if ctx.get("email"):
        set_cell(ws, "D3", f"E-mail: {ctx['email']}")
    for i, it in enumerate(items):
        r = 14 + i
        set_cell(ws, f"A{r}", i + 1)
        set_cell(ws, f"B{r}", it.get("part") or "")
        set_cell(ws, f"C{r}", it.get("desc") or "")
        set_cell(ws, f"D{r}", it.get("qty"))
        set_cell(ws, f"E{r}", it.get("dc") or it.get("batch") or "")
        set_cell(ws, f"F{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"G{r}", f"=D{r}*F{r}")
    last = 13 + n
    set_cell(ws, f"F{total_row}", "Total USD:")
    set_cell(ws, f"G{total_row}", f"=SUM(G14:G{last})")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


RENDERERS = {
    "far": _render_far,
    "sz-ino-contract-zh": _render_sz_zh,
    "ino-contract-en": _render_ino_en,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True, choices=sorted(RENDERERS))
    ap.add_argument("--template", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--data")
    args = ap.parse_args()
    raw = open(args.data, encoding="utf-8").read() if args.data else sys.stdin.read()
    ctx = json.loads(raw)
    print(RENDERERS[args.kind](ctx, args.template, args.out))


if __name__ == "__main__":
    main()
