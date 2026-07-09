#!/usr/bin/env python3
"""Mirror TODAY's newly-assigned demands from 库②(real master, read-only) into
库①(write-in base, "紧急调度3.0 副本") so the dispatch-inquiry automation has
real work to do.

Deliberately narrow: only today's assignments, not a rolling multi-day window.
库②has years of "已分配" history that was never meant to become 库①backlog —
an earlier version used a 3-day rolling window (once even run manually with
--since-days 30), and it silently vacuumed thousands of old already-assigned
records into 库①, most of them long past being anyone's actual next action.
库①should hold roughly a day's worth of live queue (~10-20 items), not a
multi-thousand-row backlog that swamps the per-tick cron automation.

库②stays untouched — this only reads it. Idempotency lives entirely on the
库①side via the "源需求ID" field (库②record_id) as the larkdepot upsert key,
so re-running the same day never creates duplicates.

This script NEVER mutates field schema (no auto-adding select options) — an
earlier version did, using a paginated-but-truncated option list as if it were
complete, and a full-PUT field-update silently wiped 226 of 277 real options
off a select field before anyone noticed. Schema changes are a human-in-the-loop
action now: a select value with no matching option is left blank and logged,
not force-added.

Usage: sync-demands.py [--since-days N]  (default 0 = today only)
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


def fetch_source_demands(target_date):
    """target_date is the single calendar day to sync (default: today). Bounded
    on BOTH ends — datetime fields only support bare >/< (no >=/<=). ExactDate(D)
    is midnight at the start of D, so "> ExactDate(target_date)" already covers
    every timestamp on target_date itself (anything after 00:00:00) — the lower
    bound must be target_date, NOT target_date-1 (that would swallow all of the
    previous day too, since "> midnight of day-1" matches almost the entire
    previous day). Upper bound target_date+1 excludes the following day.

    Two real off-by-ones happened building this: (1) an open-ended lower-bound-
    only version that pulled in everything from a cutoff through now regardless
    of date, and (2) a first "closed range" fix that still used target_date-1 as
    the lower bound, which silently re-included the entire previous day. Both
    were caught by directly checking a real record's 客户需求日期 after a sync
    run rather than trusting the "N 条" candidate count alone."""
    field_ids = []
    for f in list(FIELD_MAP.keys()) + [SRC_ID_FIELD]:
        field_ids += ["--field-id", f]
    day_after = target_date + datetime.timedelta(days=1)
    out = run([
        "lark-cli", "base", "+record-list",
        "--base-token", B2, "--table-id", DT2, "--as", "user",
        "--filter-json", json.dumps({
            "logic": "and",
            "conditions": [
                ["分配状态", "is", "已分配"],
                ["客户需求日期", ">", f"ExactDate({target_date.isoformat()})"],
                ["客户需求日期", "<", f"ExactDate({day_after.isoformat()})"],
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
    ap.add_argument("--since-days", type=int, default=0, help="which day to sync: 0=today, 1=yesterday, ...")
    args = ap.parse_args()

    target_date = datetime.date.today() - datetime.timedelta(days=args.since_days)
    rows = fetch_source_demands(target_date)
    print(f"库②候选(分配状态=已分配,客户需求日期={target_date.isoformat()}): {len(rows)} 条", file=sys.stderr)

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
