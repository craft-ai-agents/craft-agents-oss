#!/usr/bin/env python3
"""端到端入口：TaskBar / agent 提交的 doc-export payload → 可编辑 xlsx。

Payload 形状（与 apps/webui .../doc-form-payload.ts 一致）::

  {
    "template": "見積書",
    "context": { ... render context ... },
    "mode": "render" | "feishu_order"   # 可选，默认 render
  }

用法::

  uv run --with openpyxl python3 render_from_form.py \\
    --data payload.json --out /tmp/out.xlsx

  # 或 stdin
  cat payload.json | uv run --with openpyxl python3 render_from_form.py --out out.xlsx

  # 仅打印 markdown 预览（不写 xlsx）
  ... render_from_form.py --data payload.json --preview-only

成功时 stdout 最后一行 = 输出 xlsx 绝对路径。
美金 PI + feishu_order：尝试 build_pi_context.py --order；失败则明确退出。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPTS.parent
TEMPLATES = SKILL_ROOT / "templates"

# template 正式名 → (blank 相对 skill 根, 调用方式)
# call: ("followup", kind) | ("po", kind) | ("shipping", kind) | ("jp",) | ("pi",) | ("hedge",)
ROUTES: dict[str, tuple[str, tuple]] = {
    "美金请款发票 PI": (
        "美金请款发票模板PI.xlsx",
        ("pi",),
    ),
    "日本請求書（イノ間）": (
        "followup/jp-ino-invoice/blank.xlsx",
        ("jp",),
    ),
    "見積書": (
        "followup/quotation/blank.xlsx",
        ("followup", "quotation"),
    ),
    "竹菱 PI": (
        "followup/takebishi-pi/blank.xlsx",
        ("followup", "takebishi-pi"),
    ),
    "取扱手数料": (
        "followup/takebishi-fee/blank.xlsx",
        ("followup", "takebishi-fee"),
    ),
    "FAR 采购订单": (
        "purchase-order/far/blank.xlsx",
        ("po", "far"),
    ),
    "深圳印诺采购合同（中文）": (
        "purchase-order/sz-ino-contract-zh/blank.xlsx",
        ("po", "sz-ino-contract-zh"),
    ),
    "印诺英文采购合同": (
        "purchase-order/ino-contract-en/blank.xlsx",
        ("po", "ino-contract-en"),
    ),
    "不报关出口资料": (
        "shipping-customs/no-declaration/blank.xlsx",
        ("shipping", "no-declaration"),
    ),
    "出口报关": (
        "shipping-customs/export-declaration/blank.xlsx",
        ("shipping", "export-declaration"),
    ),
    "进口报关": (
        "shipping-customs/import-declaration/blank.xlsx",
        ("shipping", "import-declaration"),
    ),
    "国内送货单": (
        "shipping-customs/domestic-delivery/blank.xlsx",
        ("shipping", "domestic-delivery"),
    ),
    "对冲结算书": (
        "INO_SA_应收应付双凯杰对冲结算书模板.xlsx",
        ("hedge",),
    ),
}


def _preview_md(template: str, ctx: dict, mode: str) -> str:
    lines = [f"**模板：** {template}", f"**模式：** {mode}"]
    items = ctx.get("items") or ctx.get("purchase_lines") or []
    if items:
        lines += ["", "| # | 型号 | 数量 | 单价 |", "|---|------|------|------|"]
        for i, it in enumerate(items):
            part = it.get("part") or it.get("model") or ""
            qty = it.get("qty", "")
            price = (
                it.get("price")
                or it.get("unit_price")
                or it.get("unit_price_jpy")
                or it.get("unit_price_usd")
                or it.get("unit_price_rmb")
                or ""
            )
            lines.append(f"| {i + 1} | {part} | {qty} | {price} |")
    for k in (
        "po_number",
        "invoice_no",
        "order_no",
        "supplier_name",
        "party_b",
        "receiver_company",
        "to",
        "currency_set",
        "tax_mode",
        "ship_to_mode",
    ):
        if ctx.get(k) not in (None, ""):
            lines.append(f"- {k}: {ctx[k]}")
    return "\n".join(lines)


def _run_feishu_pi(order: str, out: str) -> str:
    build = SCRIPTS / "build_pi_context.py"
    render = SCRIPTS / "render_pi.py"
    blank = TEMPLATES / "美金请款发票模板PI.xlsx"
    if not blank.exists():
        raise SystemExit(f"模板不存在：{blank}")
    # build context
    proc = subprocess.run(
        [sys.executable, str(build), "--order", order],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(
            f"飞书拉单失败（order={order}）。stderr:\n{proc.stderr}\n"
            "请手填货品明细后重试，或检查 lark-cli 授权。"
        )
    ctx_text = proc.stdout
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write(ctx_text)
        data_path = f.name
    try:
        r2 = subprocess.run(
            [
                "uv",
                "run",
                "--with",
                "openpyxl",
                "python3",
                str(render),
                "--template",
                str(blank),
                "--out",
                out,
                "--data",
                data_path,
            ],
            capture_output=True,
            text=True,
            cwd=str(SCRIPTS),
        )
        if r2.returncode != 0:
            raise SystemExit(f"render_pi 失败：\n{r2.stdout}\n{r2.stderr}")
        path = r2.stdout.strip().splitlines()[-1]
        return path
    finally:
        try:
            os.unlink(data_path)
        except OSError:
            pass


def _dispatch(template: str, ctx: dict, blank: Path, out: str) -> str:
    """Call shipped render entrypoints (import when available, else uv subprocess)."""
    if not blank.exists():
        raise SystemExit(f"模板不存在（本地/服务器 only）：{blank}")

    _, call = ROUTES[template]
    kind0 = call[0]

    # Prefer in-process imports (same as unit tests) — no nested uv.
    sys.path.insert(0, str(SCRIPTS))
    try:
        if kind0 == "jp":
            import render_jp_invoice as m

            return m.render(ctx, str(blank), out)

        if kind0 == "followup":
            import render_followup as m

            return m.RENDERERS[call[1]](ctx, str(blank), out)

        if kind0 == "po":
            import render_po as m

            return m.RENDERERS[call[1]](ctx, str(blank), out)

        if kind0 == "shipping":
            import render_shipping as m

            return m.RENDERERS[call[1]](ctx, str(blank), out)

        if kind0 == "hedge":
            import render_hedge as m

            return m.render(ctx, str(blank), out)

        if kind0 == "pi":
            return _subprocess_script(
                SCRIPTS / "render_pi.py",
                ["--template", str(blank), "--out", out],
                ctx,
            )
    finally:
        if str(SCRIPTS) in sys.path:
            try:
                sys.path.remove(str(SCRIPTS))
            except ValueError:
                pass

    raise SystemExit(f"未知路由：{call}")


def _subprocess_script(script: Path, args: list[str], ctx: dict) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(ctx, f, ensure_ascii=False)
        data_path = f.name
    try:
        full = [
            "uv",
            "run",
            "--with",
            "openpyxl",
            "python3",
            str(script),
            *args,
            "--data",
            data_path,
        ]
        proc = subprocess.run(full, capture_output=True, text=True, cwd=str(SCRIPTS))
        if proc.returncode != 0:
            raise SystemExit(f"render 失败：\n{proc.stdout}\n{proc.stderr}")
        lines = [ln for ln in proc.stdout.strip().splitlines() if ln.strip()]
        return lines[-1] if lines else out_from_args(args)
    finally:
        try:
            os.unlink(data_path)
        except OSError:
            pass


def out_from_args(args: list[str]) -> str:
    if "--out" in args:
        i = args.index("--out")
        if i + 1 < len(args):
            return args[i + 1]
    return ""


def render_payload(payload: dict, out: str | None, preview_only: bool) -> str:
    template = payload.get("template") or ""
    ctx = payload.get("context") or {}
    mode = payload.get("mode") or "render"

    if template not in ROUTES:
        raise SystemExit(f"未知模板「{template}」。已知：{list(ROUTES)}")

    if preview_only:
        print(_preview_md(template, ctx, mode))
        return ""

    blank_rel, _ = ROUTES[template]
    blank = TEMPLATES / blank_rel

    if not out:
        safe = template.replace("/", "_").replace(" ", "_")[:40]
        out = str(Path.cwd() / f"doc_{safe}.xlsx")

    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)

    if mode == "feishu_order" or (
        template == "美金请款发票 PI" and not ctx.get("items") and (ctx.get("order") or ctx.get("source"))
    ):
        order = str(ctx.get("order") or ctx.get("source") or "")
        if not order:
            raise SystemExit("美金 PI 飞书模式需要 context.order / source")
        path = _run_feishu_pi(order, out)
        print(path)
        return path

    # Ensure items exist when required by most templates
    if template not in ("美金请款发票 PI",) and not (
        ctx.get("items") or ctx.get("purchase_lines")
    ):
        # allow empty only for weird cases — most need items
        if template not in ():
            pass  # render scripts raise themselves

    path = _dispatch(template, ctx, blank, out)
    print(path)
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description="doc-export form payload → xlsx")
    ap.add_argument("--data", help="payload JSON 文件；省略则读 stdin")
    ap.add_argument("--out", help="输出 xlsx 路径")
    ap.add_argument("--preview-only", action="store_true", help="只打 markdown 预览")
    args = ap.parse_args()

    raw = open(args.data, encoding="utf-8").read() if args.data else sys.stdin.read()
    if not raw.strip():
        raise SystemExit("空 payload")
    payload = json.loads(raw)
    # 兼容：若顶层直接是 context + 缺 template，报错
    if "template" not in payload and "context" not in payload:
        raise SystemExit('payload 须含 "template" 与 "context"')
    render_payload(payload, args.out, args.preview_only)


if __name__ == "__main__":
    main()
