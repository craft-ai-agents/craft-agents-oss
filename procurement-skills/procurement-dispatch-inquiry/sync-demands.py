#!/usr/bin/env python3
"""Mirror recently-assigned demands from 库②(real master, read-only) into
库①(write-in base, "紧急调度3.0 副本") so the dispatch-inquiry automation has
real work to do.

库②stays untouched — this only reads it. Idempotency lives entirely on the
库①side via the "源需求ID" field (库②record_id) as the larkdepot upsert key,
so re-running with an overlapping lookback window never creates duplicates.

This script NEVER mutates field schema (no auto-adding select options) — an
earlier version did, using a paginated-but-truncated option list as if it were
complete, and a full-PUT field-update silently wiped 226 of 277 real options
off a select field before anyone noticed. Schema changes are a human-in-the-loop
action now: a select value with no matching option is left blank and logged,
not force-added.

Usage: sync-demands.py [--since-days N]  (default 3)
"""

import argparse
import datetime
import json
import subprocess
import sys

B2 = "EWoFbgsDxaBA8LsLxWrce74tnPc"
DT2 = "tblwZsfI8q8Yozx7"
B3 = "LclTbYAOia6es1sdFbacDCgKnld"
DT3 = "tbljxle9qkfUO0vV"

# 库②字段 -> 库①字段, both are plain text/number/select unless noted.
FIELD_MAP = {
    "客户需求型号": "客户需求型号",
    "数量": "数量",
    "品牌": "品牌",
    "单位": "单位",
    "询价性质": "询价性质",
    "客户需求日期": "客户需求日期",
    "备注（特殊要求）": "备注（特殊要求）",
    "客户名称": "客户名称",
    "需求链接": "需求链接",
}
SELECT_FIELDS = {"品牌", "单位", "询价性质", "客户名称"}  # 库①侧字段名,值必须已在选项池里
SRC_ID_FIELD = "辅助-记录ID"  # 库②的formula字段,镜像记录自己的record_id


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{r.stderr or r.stdout}")
    return r.stdout


def fetch_source_demands(since_date):
    """since_date is the first day to include; datetime fields only support the
    bare > operator (no >=), so the actual cutoff is the day before, exclusive."""
    field_ids = []
    for f in list(FIELD_MAP.keys()) + [SRC_ID_FIELD]:
        field_ids += ["--field-id", f]
    exclusive_before = since_date - datetime.timedelta(days=1)
    out = run([
        "lark-cli", "base", "+record-list",
        "--base-token", B2, "--table-id", DT2, "--as", "user",
        "--filter-json", json.dumps({
            "logic": "and",
            "conditions": [
                ["分配状态", "is", "已分配"],
                ["客户需求日期", ">", f"ExactDate({exclusive_before.isoformat()})"],
            ],
        }),
        *field_ids,
        "--limit", "200", "--format", "json",
    ])
    d = json.loads(out)["data"]
    cols = d["fields"]
    return [dict(zip(cols, row)) for row in d["data"]]


def full_option_set(field_name):
    """+field-search-options paginates (default page 30, max 200) — must walk
    every page via --offset. +field-get's inline `options` array is ALSO
    silently truncated (~50) and must never be treated as the complete pool."""
    names, offset = set(), 0
    while True:
        out = run([
            "lark-cli", "base", "+field-search-options", "--base-token", B3, "--table-id", DT3,
            "--field-id", field_name, "--as", "user",
            "--limit", "200", "--offset", str(offset), "--format", "json",
        ])
        d = json.loads(out)["data"]
        page = d["options"]
        names.update(o["name"] for o in page)
        if len(names) >= d["total"] or not page:
            return names
        offset += 200


def normalize_value(v):
    """record-list renders select/link cells as a 1-item list; text/number/date
    fields come through as plain scalars. Collapse both to a plain scalar."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-days", type=int, default=3)
    args = ap.parse_args()

    since = datetime.date.today() - datetime.timedelta(days=args.since_days)
    rows = fetch_source_demands(since)
    print(f"库②候选(分配状态=已分配,{since.isoformat()}起): {len(rows)} 条", file=sys.stderr)

    option_cache = {f: full_option_set(f) for f in SELECT_FIELDS}

    synced, skipped, dropped_fields = 0, 0, 0
    for row in rows:
        mpn = row.get("客户需求型号")
        if not mpn:
            continue
        src_id = row.get(SRC_ID_FIELD) or ""
        if not src_id:
            print(f"  跳过(拿不到源record_id,无法幂等去重): {mpn}", file=sys.stderr)
            skipped += 1
            continue

        fields = {"客户需求型号": mpn, "分配状态": "已分配", "源需求ID": src_id}
        for src_f, dst_f in FIELD_MAP.items():
            if src_f == "客户需求型号":
                continue
            v = normalize_value(row.get(src_f))
            if v in (None, ""):
                continue
            if dst_f in SELECT_FIELDS and v not in option_cache[dst_f]:
                print(f"  [{mpn}] {dst_f}={v!r} 不在选项池里,该字段留空(需要人工去库①手动加选项)",
                      file=sys.stderr)
                dropped_fields += 1
                continue
            fields[dst_f] = v

        out = run([
            "larkdepot", "upsert", "--app", B3, "--table", DT3,
            "--key", "源需求ID", "--json", json.dumps(fields, ensure_ascii=False),
        ])
        try:
            action = json.loads(out).get("data", {}).get("action", "?")
        except json.JSONDecodeError:
            action = out.strip()
        print(f"  {action:8s} {mpn}", file=sys.stderr)
        if action == "created":
            synced += 1

    print(f"完成: 新同步 {synced} 条, 跳过 {skipped} 条, 因选项缺失而留空的字段 {dropped_fields} 处",
          file=sys.stderr)


if __name__ == "__main__":
    main()
