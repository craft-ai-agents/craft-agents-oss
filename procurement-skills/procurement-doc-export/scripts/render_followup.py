#!/usr/bin/env python3
"""Render followup docs: quotation | takebishi-pi | takebishi-fee.

  uv run --with openpyxl python3 render_followup.py \\
    --kind quotation|takebishi-pi|takebishi-fee \\
    --template .../blank.xlsx --out out.xlsx --data ctx.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from xlsx_common import (
    adjust_item_block,
    load_single_sheet,
    set_cell,
)


def _render_quotation(ctx: dict, template: str, out: str) -> str:
    # blank sheet 样板: items start row 5 (1 slot), total row 6 J6=SUM(J5:J5)
    wb, ws = load_single_sheet(template, "样板")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 12
    total_row = adjust_item_block(
        ws,
        item_start=5,
        default_slots=1,
        n=n,
        total_or_next_row=6,
        max_col=max_col,
    )
    # header
    date = ctx.get("date") or ctx.get("invoice_date") or ""
    set_cell(ws, "B2", f"期日: {date}".strip() if not str(date).startswith("期日") else date)
    # TO block optional
    if ctx.get("to"):
        set_cell(ws, "G3", f"\nTO：\n{ctx['to']}\n")
    if ctx.get("from_block"):
        set_cell(ws, "B3", f"\nFROM:\n{ctx['from_block']}\n")
    for i, it in enumerate(items):
        r = 5 + i
        set_cell(ws, f"B{r}", i + 1)
        set_cell(ws, f"C{r}", it.get("part") or it.get("model") or "")
        set_cell(ws, f"D{r}", it.get("qty"))
        set_cell(ws, f"G{r}", it.get("unit") or "PCS")
        set_cell(ws, f"H{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"I{r}", it.get("dc") or "")
        set_cell(ws, f"J{r}", f"=D{r}*H{r}")
        set_cell(ws, f"K{r}", it.get("lead_time") or it.get("delivery") or "")
    last = 4 + n
    set_cell(ws, f"B{total_row}", "合計（JPY）" if ctx.get("currency", "JPY") == "JPY" else f"合計（{ctx.get('currency','')}）")
    set_cell(ws, f"J{total_row}", f"=SUM(J5:J{last})")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _render_takebishi_pi(ctx: dict, template: str, out: str) -> str:
    # blank 样板 like USD PI: item @17 (1 slot), total @18
    wb, ws = load_single_sheet(template, "样板")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 12
    total_row = adjust_item_block(
        ws, item_start=17, default_slots=1, n=n, total_or_next_row=18, max_col=max_col
    )
    set_cell(ws, "B7", f"Date:{ctx.get('invoice_date') or ctx.get('date') or ''}")
    set_cell(ws, "G7", ctx.get("invoice_no") or "")
    bt = ctx.get("bill_to") or {}
    st = ctx.get("ship_to") or bt
    set_cell(ws, "B9", bt.get("name") or "TAKEBISHI  CORPORATION")
    set_cell(ws, "F9", st.get("name") or bt.get("name") or "TAKEBISHI  CORPORATION")
    if bt.get("address"):
        set_cell(ws, "B10", bt.get("address"))
    if st.get("address"):
        set_cell(ws, "F10", st.get("address"))
    set_cell(ws, "B13", ctx.get("po_number") or "")
    set_cell(ws, "D13", ctx.get("terms") or "")
    set_cell(ws, "E13", ctx.get("ship_date") or "")
    set_cell(ws, "G13", ctx.get("ship_via") or "")
    set_cell(ws, "H13", ctx.get("tracking_no") or "")
    for i, it in enumerate(items):
        r = 17 + i
        set_cell(ws, f"B{r}", i + 1)
        set_cell(ws, f"C{r}", it.get("part") or "")
        set_cell(ws, f"D{r}", it.get("qty"))
        set_cell(ws, f"E{r}", it.get("desc") or "")
        set_cell(ws, f"G{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"H{r}", f"=G{r}*D{r}")
    last = 16 + n
    set_cell(ws, f"D{total_row}", f"=SUM(D17:D{last})")
    set_cell(ws, f"H{total_row}", f"=SUM(H17:H{last})")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _render_takebishi_fee(ctx: dict, template: str, out: str) -> str:
    # sheet 样本: items 19-21 (3 slots), subtotal M23, tax M24, total M25
    wb, ws = load_single_sheet(template, "样本")
    items = ctx.get("items") or []
    n = len(items)
    max_col = ws.max_column or 16
    # insert before 小計 row 23
    subtotal_row = adjust_item_block(
        ws, item_start=19, default_slots=3, n=n, total_or_next_row=23, max_col=max_col
    )
    tax_row = subtotal_row + 1
    total_row = subtotal_row + 2
    date = ctx.get("invoice_date") or ctx.get("date") or ""
    if date and not str(date).startswith("："):
        date = f"：{date}"
    set_cell(ws, "K4", date)
    inv = ctx.get("invoice_no") or ""
    if inv and not str(inv).startswith("："):
        inv = f"：{inv}"
    set_cell(ws, "K5", inv)
    subject = ctx.get("subject") or "電子部品の緊急調達"
    if not str(subject).startswith("件名"):
        subject = f"件名： {subject}"
    set_cell(ws, "A13", subject)
    for i, it in enumerate(items):
        r = 19 + i
        set_cell(ws, f"B{r}", i + 1)
        set_cell(ws, f"C{r}", it.get("part") or it.get("name") or "")
        set_cell(ws, f"F{r}", it.get("qty"))
        set_cell(ws, f"I{r}", it.get("unit") or "PCS")
        set_cell(ws, f"J{r}", it.get("price") or it.get("unit_price"))
        set_cell(ws, f"M{r}", f"=J{r}*F{r}")
    last = 18 + n
    set_cell(ws, f"M{subtotal_row}", f"=SUM(M19:N{last})")
    set_cell(ws, f"M{total_row}", f"=SUM(M{subtotal_row}:N{tax_row})")
    set_cell(ws, "E15", f"=M{total_row}")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


RENDERERS = {
    "quotation": _render_quotation,
    "takebishi-pi": _render_takebishi_pi,
    "takebishi-fee": _render_takebishi_fee,
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
    path = RENDERERS[args.kind](ctx, args.template, args.out)
    print(path)


if __name__ == "__main__":
    main()
