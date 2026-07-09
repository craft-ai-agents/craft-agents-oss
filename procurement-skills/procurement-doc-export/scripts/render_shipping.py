#!/usr/bin/env python3
"""Render shipping-customs packs.

Kinds: no-declaration | export-declaration | import-declaration | domestic-delivery

Export: fill 汇总 + one currency sheet group (cny|usd|jpy1039) from context.currency_set.
Never invent HS / weights — leave blank if missing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from xlsx_common import load_workbook_keep_all, set_cell


def _fill_no_decl_summary(ws, ctx: dict) -> None:
    """汇总 sheet on no-declaration blank (Sold to / PO / part layout)."""
    sold = ctx.get("sold_to") or {}
    seller = ctx.get("seller") or {}
    ship = ctx.get("ship_to") or {}
    bill = ctx.get("bill_to") or {}
    if sold.get("company"):
        set_cell(ws, "C1", sold["company"])
    if sold.get("address"):
        set_cell(ws, "C2", sold["address"])
    if seller.get("company"):
        set_cell(ws, "C4", seller["company"])
    if seller.get("address"):
        set_cell(ws, "C5", seller["address"])
    if ship.get("name"):
        set_cell(ws, "C7", ship["name"])
    if ship.get("phone"):
        set_cell(ws, "C8", ship["phone"])
    if bill.get("block"):
        set_cell(ws, "C9", bill["block"])
    if ctx.get("date_y"):
        set_cell(ws, "B18", ctx["date_y"])
    if ctx.get("date_m"):
        set_cell(ws, "C18", ctx["date_m"])
    if ctx.get("date_d"):
        set_cell(ws, "D18", ctx["date_d"])
    if ctx.get("po_number"):
        set_cell(ws, "B20", ctx["po_number"])
    if ctx.get("brand"):
        set_cell(ws, "B21", ctx["brand"])
    if ctx.get("part") or ctx.get("model"):
        set_cell(ws, "B22", ctx.get("part") or ctx.get("model"))
    if ctx.get("description_en"):
        set_cell(ws, "B23", ctx["description_en"])
    if ctx.get("material_en"):
        set_cell(ws, "B24", ctx["material_en"])
    if ctx.get("hs_code") is not None and ctx.get("hs_code") != "":
        set_cell(ws, "B25", ctx["hs_code"])
    if ctx.get("cartons") is not None:
        set_cell(ws, "B26", ctx["cartons"])
    items = ctx.get("items") or []
    if items:
        it0 = items[0]
        if it0.get("part"):
            set_cell(ws, "B22", it0["part"])
        if it0.get("brand"):
            set_cell(ws, "B21", it0["brand"])
        if it0.get("desc"):
            set_cell(ws, "B23", it0["desc"])
        if it0.get("hs_code") is not None:
            set_cell(ws, "B25", it0["hs_code"])


def _fill_export_summary(ws, ctx: dict) -> None:
    """汇总 sheet on export-declaration blank (A/B label-value rows)."""
    # B9 型号, B10 HS, B11 品牌, B13 名称英, B15 数量, B18 单价, B21 币种
    if ctx.get("transport"):
        set_cell(ws, "B1", ctx["transport"])
    if ctx.get("freight") is not None:
        set_cell(ws, "B2", ctx["freight"])
    if ctx.get("ship_date") or ctx.get("date"):
        set_cell(ws, "B3", ctx.get("ship_date") or ctx.get("date"))
    if ctx.get("trade_country"):
        set_cell(ws, "B4", ctx["trade_country"])
    if ctx.get("trade_country_en"):
        set_cell(ws, "C4", ctx["trade_country_en"])
    if ctx.get("part") or ctx.get("model"):
        set_cell(ws, "B9", ctx.get("part") or ctx.get("model"))
    if ctx.get("hs_code") is not None and ctx.get("hs_code") != "":
        set_cell(ws, "B10", ctx["hs_code"])
    if ctx.get("brand"):
        set_cell(ws, "B11", ctx["brand"])
    if ctx.get("description_en"):
        set_cell(ws, "B13", ctx["description_en"])
    if ctx.get("description_cn"):
        set_cell(ws, "B14", ctx["description_cn"])
    if ctx.get("qty") is not None:
        set_cell(ws, "B15", ctx["qty"])
    if ctx.get("unit"):
        set_cell(ws, "B16", ctx["unit"])
    if ctx.get("price") is not None:
        set_cell(ws, "B18", ctx["price"])
    if ctx.get("currency"):
        set_cell(ws, "B21", ctx["currency"])
    if ctx.get("origin"):
        set_cell(ws, "B22", ctx["origin"])
    items = ctx.get("items") or []
    if items:
        it0 = items[0]
        if it0.get("part"):
            set_cell(ws, "B9", it0["part"])
        if it0.get("hs_code") is not None:
            set_cell(ws, "B10", it0["hs_code"])
        if it0.get("brand"):
            set_cell(ws, "B11", it0["brand"])
        if it0.get("desc"):
            set_cell(ws, "B13", it0["desc"])
        if it0.get("qty") is not None:
            set_cell(ws, "B15", it0["qty"])
        if it0.get("price") is not None:
            set_cell(ws, "B18", it0["price"])
    sold = ctx.get("sold_to") or {}
    if sold.get("company"):
        set_cell(ws, "D24", sold["company"])
    if sold.get("address"):
        set_cell(ws, "D25", sold["address"])
    seller = ctx.get("seller") or {}
    if seller.get("company"):
        set_cell(ws, "D27", seller["company"])
    if seller.get("address"):
        set_cell(ws, "D28", seller["address"])


def _render_no_decl(ctx: dict, template: str, out: str) -> str:
    wb = load_workbook_keep_all(template)
    if "汇总" in wb.sheetnames:
        _fill_no_decl_summary(wb["汇总"], ctx)
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _export_sheet_names(currency_set: str) -> list[str]:
    """Return sheet names in the selected currency pack (must match workbook exactly)."""
    c = (currency_set or "cny").lower()
    if c in ("usd", "美元", "us"):
        return [
            "汇总",
            "（美元）出口报关单 ",
            "（美）出口合同 ",
            "（美）出口发票 ",
            "（美）出口装箱单 ",
            "（美）出口申报要素 ",
            "（美）packinglist",
        ]
    if c in ("1039", "jpy1039"):
        return ["汇总", "1039发票", "1039申报要素", "1039出口货物确认函"]
    # default CNY / 日元套 uses unprefixed export sheets
    return [
        "汇总",
        "出口报关单",
        "出口合同",
        "出口发票",
        "出口装箱单",
        "出口申报要素",
        "packinglist",
    ]


def _item0(ctx: dict) -> dict:
    items = ctx.get("items") or []
    return items[0] if items else {}


def _goods_line(ctx: dict) -> tuple[str, object, object, object]:
    """part, qty, price, hs from context (top-level or items[0])."""
    it = _item0(ctx)
    part = it.get("part") or ctx.get("part") or ctx.get("model") or ""
    qty = it.get("qty") if it.get("qty") is not None else ctx.get("qty")
    price = it.get("price") if it.get("price") is not None else ctx.get("price")
    hs = it.get("hs_code") if it.get("hs_code") is not None else ctx.get("hs_code")
    desc = it.get("desc") or ctx.get("description_en") or ctx.get("description_cn") or ""
    line = f"{desc}\n型号：{part}".strip() if desc else (f"型号：{part}" if part else "")
    return line or part, qty, price, hs


def _fill_export_currency_sheets(wb, currency_set: str, ctx: dict) -> str:
    """Write goods line onto the selected currency pack's primary business sheet(s).

    Returns the sheet name used as the primary readback target (for tests/docs).
    Measured on export-declaration blank — not sample formulas.
    """
    c = (currency_set or "cny").lower()
    line, qty, price, hs = _goods_line(ctx)
    missing = [n for n in _export_sheet_names(c) if n not in wb.sheetnames]
    if missing:
        # Hard fail only if 汇总 itself missing; partial packs warn via SystemExit on empty set
        if "汇总" not in wb.sheetnames:
            raise SystemExit(f"export blank 缺少 汇总；missing={missing}")

    if c in ("usd", "美元", "us"):
        # USD pack: 装箱单 is the source for invoice formulas (B13/D13).
        primary = "（美）出口装箱单 "
        if primary not in wb.sheetnames:
            raise SystemExit(f"export blank 缺少美元套 sheet {primary!r}")
        ws = wb[primary]
        if line:
            set_cell(ws, "B13", line)
        if qty is not None:
            set_cell(ws, "D13", f"{qty}个" if not isinstance(qty, str) else qty)
        pl = "（美）packinglist"
        if pl in wb.sheetnames and line:
            set_cell(wb[pl], "B13", line)
            if qty is not None:
                set_cell(wb[pl], "D13", f"{qty}pcs" if not isinstance(qty, str) else qty)
        return primary

    if c in ("1039", "jpy1039"):
        primary = "1039发票"
        if primary not in wb.sheetnames:
            raise SystemExit(f"export blank 缺少 1039 sheet {primary!r}")
        ws = wb[primary]
        part = _item0(ctx).get("part") or ctx.get("part") or ""
        if part:
            set_cell(ws, "E17", part)
        if hs is not None and hs != "":
            set_cell(ws, "D17", hs)
        if qty is not None:
            # qty lives near goods row; blank uses free text in H/I — leave weight blank
            pass
        return primary

    # CNY / default JPY-unprefixed pack: blank 出口发票/合同 goods row has no 汇总 formulas
    primary = "出口发票"
    if primary not in wb.sheetnames:
        raise SystemExit(f"export blank 缺少 {primary!r}")
    inv = wb[primary]
    if line:
        set_cell(inv, "B16", line)
    if qty is not None:
        unit = (_item0(ctx).get("unit") or ctx.get("unit") or "个")
        set_cell(inv, "C16", f"{qty}{unit}" if not isinstance(qty, str) else qty)
    if price is not None:
        set_cell(inv, "D16", price)
    if "出口合同" in wb.sheetnames:
        ct = wb["出口合同"]
        part = _item0(ctx).get("part") or ctx.get("part") or ""
        if line or part:
            set_cell(ct, "B17", line or part)
        if qty is not None:
            set_cell(ct, "D17", qty)
        if price is not None:
            set_cell(ct, "E17", price)
    if "出口装箱单" in wb.sheetnames and line:
        set_cell(wb["出口装箱单"], "B13", line)
        if qty is not None:
            set_cell(wb["出口装箱单"], "D13", qty)
    return primary


def _render_export(ctx: dict, template: str, out: str) -> str:
    wb = load_workbook_keep_all(template)
    currency_set = ctx.get("currency_set") or "cny"
    if "汇总" in wb.sheetnames:
        _fill_export_summary(wb["汇总"], ctx)
        set_cell(wb["汇总"], "A35", f"currency_set={currency_set}")
    primary = _fill_export_currency_sheets(wb, currency_set, ctx)
    # Stamp which business sheet was filled (free cell on 汇总)
    if "汇总" in wb.sheetnames:
        set_cell(wb["汇总"], "A36", f"primary_sheet={primary}")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _render_import(ctx: dict, template: str, out: str) -> str:
    wb = load_workbook_keep_all(template)
    # sheet names may have trailing spaces
    summary_name = next((n for n in wb.sheetnames if n.strip() == "汇总"), None)
    if summary_name:
        ws = wb[summary_name]
        seller = ctx.get("seller") or {}
        if seller.get("company"):
            set_cell(ws, "C1", seller["company"])
        if seller.get("contact"):
            set_cell(ws, "C2", seller["contact"])
        if seller.get("address"):
            set_cell(ws, "C3", seller["address"])
        if seller.get("phone"):
            set_cell(ws, "C4", seller["phone"])
        if ctx.get("contract_no"):
            set_cell(ws, "B7", ctx["contract_no"])
        if ctx.get("hs_code") is not None:
            set_cell(ws, "B8", ctx["hs_code"])
        if ctx.get("brand_cn"):
            set_cell(ws, "B9", ctx["brand_cn"])
        if ctx.get("brand_en"):
            set_cell(ws, "B10", ctx["brand_en"])
        if ctx.get("part"):
            set_cell(ws, "B11", ctx["part"])
        if ctx.get("description_en"):
            set_cell(ws, "B12", ctx["description_en"])
        if ctx.get("description_cn"):
            set_cell(ws, "B13", ctx["description_cn"])
        if ctx.get("origin_cn"):
            set_cell(ws, "B14", ctx["origin_cn"])
        if ctx.get("qty") is not None:
            set_cell(ws, "B15", ctx["qty"])
        if ctx.get("unit"):
            set_cell(ws, "B16", ctx["unit"])
        if ctx.get("price") is not None:
            set_cell(ws, "B17", ctx["price"])
        if ctx.get("currency"):
            set_cell(ws, "B18", ctx["currency"])
        items = ctx.get("items") or []
        if items:
            it = items[0]
            if it.get("part"):
                set_cell(ws, "B11", it["part"])
            if it.get("qty") is not None:
                set_cell(ws, "B15", it["qty"])
            if it.get("price") is not None:
                set_cell(ws, "B17", it["price"])
            if it.get("hs_code") is not None:
                set_cell(ws, "B8", it["hs_code"])
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


def _render_domestic(ctx: dict, template: str, out: str) -> str:
    wb = load_workbook_keep_all(template)
    sheet = "送货单" if "送货单" in wb.sheetnames else wb.sheetnames[0]
    ws = wb[sheet]
    set_cell(ws, "C3", ctx.get("receiver_company") or "")
    set_cell(ws, "G3", ctx.get("ship_date") or ctx.get("date") or "")
    set_cell(ws, "C4", ctx.get("receiver_address") or "")
    set_cell(ws, "G4", ctx.get("shipper_company") or "深圳市印诺电子科技有限公司")
    set_cell(ws, "C5", ctx.get("receiver_contact") or "")
    set_cell(ws, "G5", ctx.get("shipper_contact") or "")
    items = ctx.get("items") or []
    # blank has 3 item rows 7-9
    for i, it in enumerate(items[:10]):
        r = 7 + i
        set_cell(ws, f"B{r}", i + 1)
        set_cell(ws, f"C{r}", it.get("part") or it.get("model") or "")
        set_cell(ws, f"E{r}", it.get("qty_display") or it.get("qty") or "")
        set_cell(ws, f"F{r}", it.get("unit") or it.get("package") or "")
        set_cell(ws, f"G{r}", it.get("note") or "")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    wb.save(out)
    return out


RENDERERS = {
    "no-declaration": _render_no_decl,
    "export-declaration": _render_export,
    "import-declaration": _render_import,
    "domestic-delivery": _render_domestic,
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
