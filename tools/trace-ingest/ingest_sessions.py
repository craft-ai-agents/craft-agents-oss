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


# ============================================================
# 产线评分(eval-at-ingest):入库时同步跑 code evaluators,分数挂根 span 属性。
# 铁律:谓词只看工具的 name + input(agent 的意图),绝不看 result(世界的回声)——
# 拿 result 判分会把"读过一篇提到 X 的文档"误判成"用了 X"。
# ============================================================

def _intent_text(e):
    """工具意图文本:toolName + toolInput,小写。"""
    name = e.get("toolName") or ""
    try:
        inp = json.dumps(e.get("toolInput") or {}, ensure_ascii=False)
    except (TypeError, ValueError):
        inp = ""
    return (name + " " + inp).lower()


def _is_inventory_intent(t):
    return (("larkdepot" in t and ("+record-search" in t or "+record-list" in t or "query" in t))
            or ("lark-cli" in t and "base" in t and "+record-" in t))


def _is_platform_intent(t):
    """平台 = 真货源渠道。WebSearch/WebFetch 是"认料"(SOP 第 0 步允许在库存前用),
    不算平台——曾把认料计入平台,产线违规数虚高。"""
    return "browserdepot" in t or "procurement-platform-search" in t


def _is_web_intent(name):
    return name in ("websearch", "webfetch")


def evaluate_session(tool_entries):
    """code evaluators:错误率 + 库存先行 + SQL 用量 + web 层失败。返回扁平属性 dict。"""
    calls = errors = inv = plat = web = sql = web_errors = 0
    first_inv_i = first_plat_i = -1
    err_tools = {}
    for i, e in enumerate(tool_entries):
        t = _intent_text(e)
        name = (e.get("toolName") or "").lower()
        calls += 1
        if e.get("isError"):
            errors += 1
            err_tools[e.get("toolName") or "?"] = err_tools.get(e.get("toolName") or "?", 0) + 1
            if name in ("websearch", "webfetch"):
                web_errors += 1
        if _is_inventory_intent(t):
            inv += 1
            if first_inv_i < 0:
                first_inv_i = i
        if _is_platform_intent(t):
            plat += 1
            if first_plat_i < 0:
                first_plat_i = i
        if _is_web_intent(name):
            web += 1
        if "larkdepot" in t and "query" in t and "sql" in t:
            sql += 1
    # 违规口径 = 业务 SOP:上了货源平台(browserdepot 等)却全程没查本地库存。
    # 认料(WebSearch/WebFetch)按 SOP 允许在库存前用,单独计数不算违规。
    violation = plat > 0 and inv == 0
    attrs = {
        "eval.tool_calls": calls,
        "eval.tool_errors": errors,
        "eval.tool_error_rate": round(errors / calls, 4) if calls else 0.0,
        "eval.inventory_calls": inv,
        "eval.platform_calls": plat,
        "eval.web_calls": web,
        "eval.sql_calls": sql,
        # web 层失败(WebSearch/WebFetch isError)——searxng/代理瘫痪的直接信号。
        # 注意:历史会话里 web 失败被包装成 success(已修:失败必 throw),
        # 修复上线前的旧 trace 此值恒 0,不代表当时网络层健康。
        "eval.web_errors": web_errors,
        "eval.violation.platform_without_inventory": violation,
    }
    if err_tools:
        attrs["eval.error_tool_names"] = ",".join(
            f"{k}x{v}" for k, v in sorted(err_tools.items(), key=lambda kv: -kv[1])[:5])
    return attrs


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
    # 产线评分:code evaluators 的结果直接长在 trace 上,Phoenix 里按属性可筛
    # (如 eval.violation.platform_without_inventory == true / eval.tool_error_rate > 0.2)
    for k, v in evaluate_session(tool_entries).items():
        root.set_attribute(k, v)
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


def _load_state(path):
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)


def _quiesced(session_dir, quiesce_min):
    """会话是否已静默(session.jsonl 距上次写入超过 quiesce_min 分钟)。
    半途会话不灌:trace 一旦推给 Phoenix 就没法增补,只灌"已经结束"的会话。"""
    import time
    try:
        mtime = os.path.getmtime(os.path.join(session_dir, "session.jsonl"))
    except OSError:
        return False
    return (time.time() - mtime) >= quiesce_min * 60


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
    ap.add_argument("--state", default="",
                    help="增量模式:状态文件路径。灌过的会话记档不再重灌(trace 不可增补,"
                         "只灌静默期已过的完整会话);不给 = 老行为,全量回灌")
    ap.add_argument("--quiesce-min", type=int, default=30,
                    help="增量模式下,session.jsonl 最后写入距今超过 N 分钟才算会话结束(默认 30)")
    args = ap.parse_args()

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    except ImportError:
        sys.exit("缺依赖。用:uv run --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http python3 ...")

    # 增量模式先探活:Phoenix 不在 → 什么都不灌、状态不动(OTLP 导出失败是静默丢,
    # 靠 force_flush 返回值兜不住,这里前置挡掉最常见的"服务没起"整类)
    if args.state:
        import urllib.error
        import urllib.request
        base = args.endpoint.split("/v1/")[0]
        try:
            urllib.request.urlopen(base, timeout=5)
        except urllib.error.HTTPError:
            pass  # 有 HTTP 响应(哪怕 401)= 服务活着
        except Exception as e:  # noqa: BLE001 — 连接层失败一律视为不可达
            sys.exit(f"Phoenix 不可达({base}: {e}),本班跳过")

    resource = Resource.create({"openinference.project.name": args.project})
    provider = TracerProvider(resource=resource)
    headers = {"authorization": f"Bearer {args.api_key}"} if args.api_key else None
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=args.endpoint, headers=headers)))
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer("craft-trace-ingest")

    dirs = find_session_dirs(args.root)
    state = _load_state(args.state) if args.state else {}
    newly = {}
    tot_sessions = tot_tool = tot_err = tot_llm = 0
    import time as _time
    for d in dirs:
        if args.state:
            if d in state:
                continue  # 已灌过,不重灌(trace 不可增补)
            if not _quiesced(d, args.quiesce_min):
                continue  # 会话可能还在进行,等下一班
        nt, ne, nl = ingest_session(tracer, d)
        if args.state and (nt or nl):
            # 只记非空会话;空会话不记档,等它后续有内容且静默后再灌
            newly[d] = {"ingested_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
                        "tool": nt, "err": ne, "llm": nl}
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

    flushed = provider.force_flush()
    provider.shutdown()
    # 导出确认成功才记档:Phoenix 挂了 → 状态不动,下一班整批重来,不丢 trace。
    if args.state and newly:
        if flushed:
            state.update(newly)
            _save_state(args.state, state)
        else:
            print("!! 导出未确认(Phoenix 不可达?),本批不记档,下一班重灌", file=sys.stderr)
            sys.exit(3)
    rate = f"{100 * (tot_tool - tot_err) / tot_tool:.1f}%" if tot_tool else "n/a"
    print(f"\n灌完:{tot_sessions} 会话 / {tot_tool} 工具调用(成功率 {rate})/ {tot_llm} LLM 回合")
    print(f"看:Phoenix → 项目 {args.project}(端点 {args.endpoint})")


if __name__ == "__main__":
    main()
