import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { CheckCircle2, ChevronDown, CircleAlert, CircleDot, Copy, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentEventLog } from "@/stores/use-agent-store";
import { formatLogJson, formatLogText, type AgentLogContext } from "./agent-event-formatters";
import { AgentScrollToBottom } from "./agent-scroll-to-bottom";

type LogFilter = "all" | "error" | "warning" | "info";
type DisplayLog = AgentEventLog & { count: number; detail: string; displayText: string; level: Exclude<LogFilter, "all">; signature: string; success: boolean };
const SCROLL_BOTTOM_THRESHOLD = 48;

export function AgentLogView({
    logs,
    theme,
    context,
    onClear,
    onCopied,
    onCopyBlocked,
}: {
    logs: AgentEventLog[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    context: AgentLogContext;
    onClear: () => void;
    onCopied: (text: string) => void;
    onCopyBlocked: (text: string) => void;
}) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<"text" | "json">("text");
    const [filter, setFilter] = useState<LogFilter>("all");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const followLogsRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [newLogCount, setNewLogCount] = useState(0);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const displayLogs = useMemo(() => prepareLogs(logs), [logs]);
    const counts = useMemo(
        () => ({
            all: displayLogs.reduce((sum, item) => sum + item.count, 0),
            error: displayLogs.filter((item) => item.level === "error").reduce((sum, item) => sum + item.count, 0),
            warning: displayLogs.filter((item) => item.level === "warning").reduce((sum, item) => sum + item.count, 0),
            info: displayLogs.filter((item) => item.level === "info").reduce((sum, item) => sum + item.count, 0),
        }),
        [displayLogs],
    );
    const visibleLogs = filter === "all" ? displayLogs : displayLogs.filter((item) => item.level === filter);
    const visibleLogCount = visibleLogs.reduce((sum, item) => sum + item.count, 0);
    const previousVisibleCountRef = useRef(visibleLogCount);
    const lastError = [...logs].reverse().find((item) => logLevel(item) === "error");
    const updateScrollState = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        followLogsRef.current = atBottom;
        setShowScrollToBottom(!atBottom);
        if (atBottom) setNewLogCount(0);
    }, []);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (!list) return;
        followLogsRef.current = true;
        list.scrollTo({ top: list.scrollHeight, behavior });
        setShowScrollToBottom(false);
        setNewLogCount(0);
    }, []);
    const handleLastLogToggle = useCallback((open: boolean) => {
        if (!open) {
            requestAnimationFrame(updateScrollState);
            return;
        }
        if (!followLogsRef.current) return;
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom("auto")));
    }, [scrollToBottom, updateScrollState]);
    useEffect(() => {
        if (mode !== "text") return;
        const frame = requestAnimationFrame(() => scrollToBottom("auto"));
        return () => cancelAnimationFrame(frame);
    }, [filter, mode, scrollToBottom]);
    useEffect(() => {
        const previousCount = previousVisibleCountRef.current;
        const addedCount = Math.max(0, visibleLogCount - previousCount);
        previousVisibleCountRef.current = visibleLogCount;
        if (mode !== "text") return;
        if (visibleLogCount < previousCount) setNewLogCount(0);
        const frame = requestAnimationFrame(() => {
            if (followLogsRef.current) scrollToBottom("auto");
            else {
                if (addedCount) setNewLogCount((count) => count + addedCount);
                updateScrollState();
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [mode, scrollToBottom, updateScrollState, visibleLogCount]);
    const copy = async (value = content, tip = t("agent.logs.copied")) => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked(t(mode === "json" ? "agent.logs.selectedManual" : "agent.logs.copyFailed"));
    };
    const connectionLabel = t(context.connected ? "agent.events.online" : context.enabled ? "agent.events.connecting" : "agent.events.disabled");
    return (
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
            <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold leading-6">{t("agent.logs.title")}</div>
                    <Segmented
                        size="small"
                        value={mode}
                        onChange={(value) => setMode(value as "text" | "json")}
                        options={[
                            { label: t("agent.logs.diagnostics"), value: "text" },
                            { label: t("agent.logs.rawJson"), value: "json" },
                        ]}
                    />
                </div>

                <div className="border-y py-2.5" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-start gap-2.5">
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${context.connected ? "bg-emerald-500" : context.enabled ? "bg-amber-500" : "bg-current opacity-30"}`} />
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2 text-sm">
                                <span className="font-medium">{connectionLabel}</span>
                                <span className="truncate" style={{ color: theme.node.muted }}>
                                    {context.activity}
                                </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] leading-4" style={{ color: theme.node.faint }} title={context.endpoint}>
                                {context.endpoint}
                            </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] leading-4" style={{ color: theme.node.muted }}>
                            <div>{t("agent.logs.messages", { count: context.messages })}</div>
                            <div>{context.pendingTool ? t("agent.logs.tool", { tool: context.pendingTool }) : t("agent.logs.noPendingTool")}</div>
                        </div>
                    </div>
                </div>

                {mode === "text" ? (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <Segmented
                                size="small"
                                value={filter}
                                onChange={(value) => setFilter(value as LogFilter)}
                                options={[
                                    { label: t("agent.logs.all", { count: counts.all }), value: "all" },
                                    { label: t("agent.logs.errors", { count: counts.error }), value: "error" },
                                    { label: t("agent.logs.warnings", { count: counts.warning }), value: "warning" },
                                    { label: t("agent.logs.info", { count: counts.info }), value: "info" },
                                ]}
                            />
                            <LogActions logs={logs} lastError={lastError} onClear={onClear} onCopy={(value, tip) => void copy(value, tip)} context={context} />
                        </div>
                        <div className="relative min-h-0 flex-1">
                            <div ref={listRef} tabIndex={0} aria-label={t("agent.logs.list")} className="thin-scrollbar h-full overflow-y-auto border-y focus-visible:outline-none" style={{ borderColor: theme.node.stroke }} onScroll={updateScrollState}>
                                {visibleLogs.map((item, index) => (
                                    <LogRow key={item.id} item={item} theme={theme} onToggle={index === visibleLogs.length - 1 ? handleLastLogToggle : undefined} />
                                ))}
                                {!visibleLogs.length ? (
                                    <div className="px-3 py-10 text-center text-sm" style={{ color: theme.node.muted }}>
                                        {t(logs.length ? "agent.logs.noFiltered" : "agent.logs.empty")}
                                    </div>
                                ) : null}
                            </div>
                            {showScrollToBottom ? (
                                <AgentScrollToBottom
                                    theme={theme}
                                    title={newLogCount ? t("agent.logs.new", { count: newLogCount }) : t("agent.logs.latest")}
                                    ariaLabel={newLogCount ? t("agent.logs.newLabel", { count: newLogCount }) : t("agent.logs.latest")}
                                    className="!bottom-52"
                                    onClick={() => scrollToBottom()}
                                />
                            ) : null}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                {t("agent.logs.fullData", { count: logs.length })}
                            </span>
                            <LogActions logs={logs} lastError={lastError} onClear={onClear} onCopy={(value, tip) => void copy(value, tip)} context={context} />
                        </div>
                        <textarea
                            ref={textareaRef}
                            readOnly
                            value={content}
                            className="thin-scrollbar min-h-0 flex-1 resize-none rounded-md border bg-transparent p-3 font-mono text-xs leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onFocus={(event) => event.currentTarget.select()}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function LogActions({ logs, lastError, context, onClear, onCopy }: { logs: AgentEventLog[]; lastError?: AgentEventLog; context: AgentLogContext; onClear: () => void; onCopy: (value?: string, tip?: string) => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip title={t("agent.logs.copyAll")}>
                <Button type="text" size="small" shape="circle" aria-label={t("agent.logs.copyAll")} icon={<Copy className="size-3.5" />} onClick={() => onCopy()} />
            </Tooltip>
            <Tooltip title={t("agent.logs.copyLastError")}>
                <Button type="text" size="small" shape="circle" aria-label={t("agent.logs.copyLastError")} disabled={!lastError} icon={<CircleAlert className="size-3.5" />} onClick={() => lastError && onCopy(formatLogText([lastError], context), t("agent.logs.lastErrorCopied"))} />
            </Tooltip>
            <Tooltip title={t("agent.logs.clear")}>
                <Button danger type="text" size="small" shape="circle" aria-label={t("agent.logs.clear")} disabled={!logs.length} icon={<Trash2 className="size-3.5" />} onClick={onClear} />
            </Tooltip>
        </div>
    );
}

function LogRow({ item, theme, onToggle }: { item: DisplayLog; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onToggle?: (open: boolean) => void }) {
    const { t } = useTranslation();
    const tone = item.level === "error" ? "text-red-600 dark:text-red-400" : item.level === "warning" ? "text-amber-600 dark:text-amber-400" : item.success ? "text-emerald-600 dark:text-emerald-400" : "";
    const Icon = item.level === "error" ? CircleAlert : item.level === "warning" ? TriangleAlert : item.success ? CheckCircle2 : CircleDot;
    return (
        <details className="group border-b last:border-b-0" style={{ borderColor: theme.node.stroke }} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
            <summary className="cursor-pointer list-none px-1 py-2.5 transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current/20 dark:hover:bg-white/10 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start gap-2.5">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} style={tone ? undefined : { color: theme.node.muted }} />
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 font-mono text-[10px] leading-5" style={{ color: theme.node.faint }}>
                                {item.time}
                            </span>
                            <span className="truncate text-sm font-medium leading-5">{item.title}</span>
                            {item.count > 1 ? (
                                <span className="shrink-0 text-[10px] leading-4" style={{ color: theme.node.muted }}>
                                    {t("agent.logs.repeated", { count: item.count })}
                                </span>
                            ) : null}
                        </div>
                        {item.displayText !== item.title ? (
                            <div className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5" style={{ color: theme.node.muted }}>
                                {item.displayText}
                            </div>
                        ) : null}
                    </div>
                    <ChevronDown className="mt-1 size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.faint }} />
                </div>
            </summary>
            <div className="pb-3 pl-[34px] pr-2">
                <div className="mb-1 text-[10px] font-medium" style={{ color: theme.node.faint }}>
                    {t("agent.logs.details")}
                </div>
                <pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2.5 font-mono text-[11px] leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}>
                    {item.detail}
                </pre>
            </div>
        </details>
    );
}

function prepareLogs(logs: AgentEventLog[]) {
    return logs.flatMap(expandLog).reduce<DisplayLog[]>((result, item) => {
        const previous = result.at(-1);
        if (previous && previous.signature === item.signature) {
            previous.count += 1;
            previous.time = item.time;
            previous.detail = item.detail;
            return result;
        }
        result.push(item);
        return result;
    }, []);
}

function expandLog(item: AgentEventLog): DisplayLog[] {
    const entries = parseJsonEntries(item.raw ?? item.text);
    return (entries.length ? entries : [undefined]).map((entry, index) => {
        const displayText = compactLogText(entry === undefined ? item.text : logSummary(entry)) || item.title;
        const level = logLevel(item, entry);
        const title = entry === undefined ? item.title : logTitle(item.title, entry);
        return {
            ...item,
            id: entries.length > 1 ? `${item.id}-${index}` : item.id,
            time: logTime(item.time, entry),
            title,
            text: displayText,
            raw: entry ?? item.raw,
            count: 1,
            detail: entry === undefined ? stripAnsi(safeString(item.raw ?? item.text)) || item.text : safeJson(entry),
            displayText,
            level,
            signature: `${level}\n${title}\n${logSignature(displayText)}`,
            success: level === "info" && /完成|成功|已连接|已就绪|收到回复/.test(`${title}\n${displayText}`),
        };
    });
}

function logLevel(item: AgentEventLog, entry?: unknown): DisplayLog["level"] {
    const entries = entry === undefined ? parseJsonEntries(item.raw ?? item.text) : [entry];
    const structured = entries.find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown> | undefined;
    if (structured?.type === "mcp.startup") {
        if (structured.status === "failed") return "error";
        if (structured.status === "cancelled") return "warning";
        return "info";
    }
    const declared = entries.map(declaredLogLevel).filter(Boolean);
    if (declared.includes("error")) return "error";
    if (declared.includes("warning")) return "warning";
    if (declared.includes("info")) return "info";
    const text = `${item.title}\n${item.text}\n${safeString(item.raw)}`;
    if (/错误|失败|异常|中断|断开|拒绝|\berror\b|\bfailed\b|\bfatal\b|exception/i.test(text)) return "error";
    if (/警告|重试|未找到|不可用|\bwarn(?:ing)?\b|deprecated|missing|unavailable/i.test(text)) return "warning";
    return "info";
}

function declaredLogLevel(value: unknown): DisplayLog["level"] | "" {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const level = String((value as Record<string, unknown>).level || "").toLowerCase();
    if (["error", "fatal"].includes(level)) return "error";
    if (["warn", "warning"].includes(level)) return "warning";
    if (["info", "debug", "trace"].includes(level)) return "info";
    return "";
}

function logTitle(fallback: string, value: unknown) {
    if (fallback !== "日志" && fallback !== "Log" || !value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const target = String((value as Record<string, unknown>).target || "").toLowerCase();
    if (target.includes("skill")) return i18n.t("agent.logs.skillLoading");
    if (target.includes("plugin")) return i18n.t("agent.logs.plugin");
    if (target.includes("mcp") || target.includes("rmcp")) return "MCP";
    if (target.includes("shell")) return i18n.t("agent.logs.terminal");
    if (target.includes("state_db")) return i18n.t("agent.logs.conversationStorage");
    return "Codex";
}

function logTime(fallback: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const timestamp = (value as Record<string, unknown>).timestamp;
    if (typeof timestamp !== "string") return fallback;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleTimeString();
}

function parseJsonEntries(value: unknown): unknown[] {
    if (value && typeof value === "object") return [value];
    if (typeof value !== "string") return [];
    const text = stripAnsi(value).trim();
    if (!text) return [];
    try {
        return [JSON.parse(text)];
    } catch {
        const entries: unknown[] = [];
        let start = -1;
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (start < 0) {
                if (character !== "{" && character !== "[") continue;
                start = index;
                depth = 1;
                continue;
            }
            if (quoted) {
                if (escaped) escaped = false;
                else if (character === "\\") escaped = true;
                else if (character === '"') quoted = false;
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === "{" || character === "[") depth += 1;
            else if (character === "}" || character === "]") depth -= 1;
            if (depth !== 0) continue;
            try {
                entries.push(JSON.parse(text.slice(start, index + 1)));
            } catch {
                // Ignore non-JSON fragments and continue scanning the stderr chunk.
            }
            start = -1;
        }
        return entries;
    }
}

function logSummary(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(logSummary).filter(Boolean).slice(0, 3).join(" · ");
    if (!value || typeof value !== "object") return String(value ?? "");
    const record = value as Record<string, unknown>;
    const fields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields) ? (record.fields as Record<string, unknown>) : null;
    if (fields) {
        for (const key of ["message", "msg", "reason", "summary", "text", "error"]) {
            if (fields[key] === undefined) continue;
            const summary = logSummary(fields[key]);
            if (summary) return summary;
        }
    }
    for (const key of ["message", "msg", "reason", "summary", "text", "error"]) {
        if (record[key] === undefined) continue;
        const summary = logSummary(record[key]);
        if (summary) return summary;
    }
    return [record.method, record.type, record.tool, record.path, record.url].filter((item) => typeof item === "string" && item).join(" · ") || safeJson(value);
}

function compactLogText(value: string) {
    return stripAnsi(value).replace(/\s+/g, " ").trim();
}

function logSignature(value: string) {
    return value
        .replace(/[a-z]:\\[^\r\n]*?skill\.md/gi, "<SKILL.md>")
        .replace(/file:\/\/\/[^\s"']+/gi, "<路径>")
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<ID>");
}

function stripAnsi(value: string) {
    return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function safeString(value: unknown) {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return safeJson(value);
}

function safeJson(value: unknown) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
