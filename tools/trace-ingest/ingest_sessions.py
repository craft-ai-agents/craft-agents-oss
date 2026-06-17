#!/usr/bin/env python3
"""把 craft-agents 的会话(session.jsonl + .pi-sessions)回灌成 OTel trace,推给 Phoenix。

一条会话 = 一条 trace。每条 trace 下:
  - 根 span(CHAIN):整段会话,挂会话级 token/cost。
  - 每个工具调用 → TOOL span:带 toolName、入参/结果、**isError → span 状态**(tool 成功率就靠这个)。
  - 每个带 usage 的助手回合 → LLM span:input/output/cacheRead token + cost(cache 命中率/成本靠这个)。

只读会话文件,不碰运行中的 agent。设计在**服务器本地**跑(数据不出网),推本地 Phoenix。

用法(服务器上):
  sudo OTEL_ENDPOINT=http://localhost:6006/v1/traces \
    uv run --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http \
    python3 ingest_sessions.py --root /home/craft/sessions --project craft-prod

数据来源(已对真实 DeepSeek 会话核验):
  session.jsonl  type=tool 条目:toolName/toolUseId/toolInput/toolStatus/isError/toolResult/turnId/timestamp
  .pi-sessions/*.jsonl  message.usage:{input,output,cacheRead,cacheWrite,cost:{...,total}}  model/provider
"""
import argparse
import glob
import json
import os
import sys

# OpenInference 语义约定的属性 key(纯字符串,Phoenix 认它来点亮 dashboard,不需要装 openinference 包)
OIK_SPAN_KIND = "openinference.span.kind"
OIK_INPUT = "input.value"
OIK_OUTPUT = "output.value"
OIK_MODEL = "llm.model_name"
OIK_PROVIDER = "llm.provider"
OIK_TOK_PROMPT = "llm.token_count.prompt"
OIK_TOK_COMPLETION = "llm.token_count.completion"
OIK_TOK_TOTAL = "llm.token_count.total"
OIK_TOK_CACHE_READ = "llm.token_count.prompt_details.cache_read"
OIK_TOOL_NAME = "tool.name"


def _ms_to_ns(ms):
    return int(ms) * 1_000_000


def _truncate(v, n=2000):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + f"…(+{len(s) - n})"


def _read_jsonl(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _load_pi_usages(session_dir):
    """从 .pi-sessions 抽出每个带 usage 的回合,带真实时长。

    返回 [(start_ms, end_ms, usage, model, provider)],按 end 排序。
    时长 = 这条带 usage 的消息时间戳 - 上一条消息时间戳(≈ 该回合模型生成耗时)。
    """
    msgs = []  # (ts, message) 全部消息,用来求前一条时间
    for pf in glob.glob(os.path.join(session_dir, ".pi-sessions", "*.jsonl")):
        for d in _read_jsonl(pf):
            m = d.get("message")
            if not isinstance(m, dict):
                continue
            ts = m.get("timestamp") or d.get("timestamp") or 0
            msgs.append((ts, m))
    msgs.sort(key=lambda x: x[0])
    out = []
    for i, (ts, m) in enumerate(msgs):
        if "usage" not in m:
            continue
        prev_ts = msgs[i - 1][0] if i > 0 else ts
        start = prev_ts if prev_ts and prev_ts < ts else ts
        out.append((start, ts, m.get("usage") or {}, m.get("model"), m.get("provider")))
    out.sort(key=lambda x: x[1])
    return out


def _openid_from_path(session_dir):
    """多用户布局 .../user-workspaces/<openid>/sessions/<id> → 抽 openid;非多用户返回 ''。"""
    parts = session_dir.replace("\\", "/").split("/")
    if "user-workspaces" in parts:
        i = parts.index("user-workspaces")
        if i + 1 < len(parts):
            return parts[i + 1]
    return ""


def find_session_dirs(roots):
    """递归找出所有"含 session.jsonl"的目录 —— 兼容 /sessions/<id> 与 user-workspaces/<openid>/sessions/<id> 两种布局。"""
    found = []
    for root in roots:
        for dirpath, _dirnames, filenames in os.walk(root):
            if "session.jsonl" in filenames:
                found.append(dirpath)
    return sorted(set(found))


def ingest_session(tracer, session_dir):
    """把一个会话目录变成一条 trace。返回 (tool_spans, error_spans, llm_spans) 计数。"""
    sj = os.path.join(session_dir, "session.jsonl")
    if not os.path.exists(sj):
        return (0, 0, 0)
    rows = _read_jsonl(sj)
    if not rows:
        return (0, 0, 0)

    header = rows[0] if isinstance(rows[0], dict) and "tokenUsage" in rows[0] else {}
    entries = [r for r in rows if r.get("type") in ("user", "assistant", "tool")]
    if not entries:
        return (0, 0, 0)

    # 空会话(无工具调用、无 LLM 用量)不建 trace —— 纯寒暄没分析价值,免得污染 trace 数
    tool_entries = [e for e in entries if e.get("type") == "tool"]
    pi_usages = _load_pi_usages(session_dir)
    if not tool_entries and not pi_usages:
        return (0, 0, 0)

    name = header.get("name") or os.path.basename(session_dir)
    model = header.get("model") or ""
    tu = header.get("tokenUsage") or {}
    times = [e.get("timestamp") for e in entries if e.get("timestamp")]
    start_ms = min(times) if times else (header.get("createdAt") or 0)
    end_ms = max(times) if times else start_ms
    first_user = next((e.get("content") for e in entries if e.get("type") == "user"), "")
    last_assist = next((e.get("content") for e in reversed(entries)
                        if e.get("type") == "assistant" and not e.get("isIntermediate")), "")

    root = tracer.start_span(name, start_time=_ms_to_ns(start_ms or 1))
    root.set_attribute(OIK_SPAN_KIND, "CHAIN")
    root.set_attribute("session.id", os.path.basename(session_dir))
    root.set_attribute("session.name", name)
    openid = _openid_from_path(session_dir)
    if openid:
        root.set_attribute("user.id", openid)
    if model:
        root.set_attribute(OIK_MODEL, model)
    if first_user:
        root.set_attribute(OIK_INPUT, _truncate(first_user))
    if last_assist:
        root.set_attribute(OIK_OUTPUT, _truncate(last_assist))
    if tu:
        root.set_attribute(OIK_TOK_PROMPT, int(tu.get("inputTokens") or 0))
        root.set_attribute(OIK_TOK_COMPLETION, int(tu.get("outputTokens") or 0))
        root.set_attribute(OIK_TOK_TOTAL, int(tu.get("totalTokens") or 0))
        root.set_attribute(OIK_TOK_CACHE_READ, int(tu.get("cacheReadTokens") or 0))
        if tu.get("costUsd") is not None:
            root.set_attribute("llm.cost.total", float(tu.get("costUsd")))

    from opentelemetry import trace as _t
    parent_ctx = _t.set_span_in_context(root)

    n_tool = n_err = n_llm = 0

    # 工具 span —— 一条 tool 条目一个 span;end 近似取下一条目的时间戳
    for i, e in enumerate(entries):
        if e.get("type") != "tool":
            continue
        ts = e.get("timestamp") or start_ms
        nxt = next((entries[j].get("timestamp") for j in range(i + 1, len(entries))
                    if entries[j].get("timestamp")), ts)
        tname = e.get("toolName") or "tool"
        span = tracer.start_span(f"tool.{tname}", context=parent_ctx, start_time=_ms_to_ns(ts))
        span.set_attribute(OIK_SPAN_KIND, "TOOL")
        span.set_attribute(OIK_TOOL_NAME, tname)
        if e.get("toolIntent"):
            span.set_attribute("tool.intent", _truncate(e["toolIntent"], 300))
        if e.get("toolInput") is not None:
            span.set_attribute(OIK_INPUT, _truncate(e["toolInput"]))
        if e.get("toolResult") is not None:
            span.set_attribute(OIK_OUTPUT, _truncate(e["toolResult"]))
        if e.get("toolStatus"):
            span.set_attribute("tool.status", e["toolStatus"])
        is_err = bool(e.get("isError"))
        from opentelemetry.trace import Status, StatusCode
        span.set_status(Status(StatusCode.ERROR if is_err else StatusCode.OK))
        if is_err:
            span.set_attribute("error", True)
            n_err += 1
        span.end(end_time=_ms_to_ns(max(nxt, ts)))
        n_tool += 1

    # LLM span —— 来自 .pi-sessions 的每个 usage 回合(token/cost/cache + 真实时长)
    for sstart, send, usage, umodel, uprovider in pi_usages:
        span = tracer.start_span("llm.generation", context=parent_ctx, start_time=_ms_to_ns(sstart or start_ms))
        span.set_attribute(OIK_SPAN_KIND, "LLM")
        if umodel:
            span.set_attribute(OIK_MODEL, umodel)
        if uprovider:
            span.set_attribute(OIK_PROVIDER, uprovider)
        inp = int(usage.get("input") or 0)
        cache_read = int(usage.get("cacheRead") or 0)
        # Phoenix 约定:prompt 是含缓存的总输入,cache_read 是其中的子集(各按各的单价算)
        span.set_attribute(OIK_TOK_PROMPT, inp + cache_read)
        span.set_attribute(OIK_TOK_CACHE_READ, cache_read)
        span.set_attribute(OIK_TOK_COMPLETION, int(usage.get("output") or 0))
        span.set_attribute(OIK_TOK_TOTAL, int(usage.get("totalTokens") or 0))
        cost = usage.get("cost") or {}
        if cost.get("total") is not None:
            span.set_attribute("llm.cost.total", float(cost["total"]))
        span.end(end_time=_ms_to_ns(send if send and send > sstart else (sstart or start_ms)))
        n_llm += 1

    root.end(end_time=_ms_to_ns(max(end_ms, start_ms) or 1))
    return (n_tool, n_err, n_llm)


def main():
    ap = argparse.ArgumentParser(description="回灌 craft 会话到 Phoenix(OTLP)")
    ap.add_argument("--root", nargs="+",
                    default=["/home/craft/sessions", "/home/craft/.craft-agent/user-workspaces"],
                    help="会话根目录(可多个);递归找含 session.jsonl 的目录,兼容默认与多用户布局")
    ap.add_argument("--project", default="craft-prod", help="Phoenix 项目名")
    ap.add_argument("--endpoint", default=os.environ.get("OTEL_ENDPOINT", "http://localhost:6006/v1/traces"))
    ap.add_argument("--api-key", default=os.environ.get("PHOENIX_API_KEY", ""),
                    help="开了 PHOENIX_ENABLE_AUTH 时必填(系统 API key);也可走 PHOENIX_API_KEY 环境变量")
    ap.add_argument("--limit", type=int, default=0, help="只灌前 N 个非空会话(0=全部)")
    args = ap.parse_args()

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    except ImportError:
        sys.exit("缺依赖。用:uv run --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http python3 ...")

    resource = Resource.create({"openinference.project.name": args.project})
    provider = TracerProvider(resource=resource)
    headers = {"authorization": f"Bearer {args.api_key}"} if args.api_key else None
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=args.endpoint, headers=headers)))
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer("craft-trace-ingest")

    dirs = find_session_dirs(args.root)
    tot_sessions = tot_tool = tot_err = tot_llm = 0
    for d in dirs:
        nt, ne, nl = ingest_session(tracer, d)
        if nt == 0 and nl == 0:
            continue  # 空会话跳过
        tot_sessions += 1
        tot_tool += nt
        tot_err += ne
        tot_llm += nl
        uid = _openid_from_path(d)
        tag = f" [{uid[:20]}]" if uid else ""
        print(f"  {os.path.basename(d):28} tool={nt} err={ne} llm={nl}{tag}")
        if args.limit and tot_sessions >= args.limit:
            break

    provider.force_flush()
    provider.shutdown()
    rate = f"{100 * (tot_tool - tot_err) / tot_tool:.1f}%" if tot_tool else "n/a"
    print(f"\n灌完:{tot_sessions} 会话 / {tot_tool} 工具调用(成功率 {rate})/ {tot_llm} LLM 回合")
    print(f"看:Phoenix → 项目 {args.project}(端点 {args.endpoint})")


if __name__ == "__main__":
    main()
