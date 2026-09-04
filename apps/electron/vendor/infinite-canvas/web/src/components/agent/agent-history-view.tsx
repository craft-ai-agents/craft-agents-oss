import { useState } from "react";
import { Button, Checkbox } from "antd";
import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentThreadSummary } from "@/stores/use-agent-store";

export function AgentHistoryView({
    theme,
    threads,
    activeThreadId,
    workspacePath,
    loading,
    busy,
    connected,
    onRefresh,
    onNewThread,
    onResumeThread,
    onDeleteThreads,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loading: boolean;
    busy: boolean;
    connected: boolean;
    onRefresh: () => void;
    onNewThread: () => void;
    onResumeThread: (threadId: string) => void;
    onDeleteThreads: (threadIds: string[]) => void;
}) {
    const { i18n, t } = useTranslation();
    const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
    const selectedThreads = threads.filter((thread) => selectedIds.has(thread.id));
    const allSelected = Boolean(threads.length) && selectedThreads.length === threads.length;
    const canResume = connected && !loading && !busy;
    const toggleThread = (threadId: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            next.has(threadId) ? next.delete(threadId) : next.add(threadId);
            return next;
        });
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">{t("agent.history.workspace")}</span>
                    <span className="min-w-0 truncate" title={workspacePath}>
                        {workspacePath || t("agent.history.defaultWorkspace")}
                    </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? <Checkbox checked={allSelected} indeterminate={Boolean(selectedThreads.length) && !allSelected} disabled={loading || busy} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(threads.map((thread) => thread.id)))} /> : null}
                        <span>{selectedThreads.length ? t("agent.history.selected", { count: selectedThreads.length }) : threads.length ? t("agent.history.count", { count: threads.length }) : connected ? t("agent.history.empty") : t("agent.status.disconnected")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedThreads.length ? (
                            <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={loading || busy} onClick={() => onDeleteThreads(selectedThreads.map((thread) => thread.id))}>
                                {t("agent.history.deleteCount", { count: selectedThreads.length })}
                            </Button>
                        ) : null}
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            {t("agent.history.refresh")}
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading || busy} onClick={onNewThread}>
                            {t("agent.history.newThread")}
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                            <div
                                key={thread.id}
                                role="button"
                                tabIndex={canResume ? 0 : -1}
                                aria-disabled={!canResume}
                                className={`${canResume ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/10" : "cursor-default opacity-60"} rounded-lg border px-2.5 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/20`}
                                style={{ borderColor: active ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onClick={() => {
                                    if (canResume) onResumeThread(thread.id);
                                }}
                                onKeyDown={(event) => {
                                    if (!canResume || (event.key !== "Enter" && event.key !== " ")) return;
                                    event.preventDefault();
                                    onResumeThread(thread.id);
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={selectedIds.has(thread.id)}
                                        disabled={loading || busy}
                                        aria-label={t("agent.history.selectThread", { name: thread.name || thread.preview || t("agent.history.untitled") })}
                                        onClick={(event) => event.stopPropagation()}
                                        onKeyDown={(event) => event.stopPropagation()}
                                        onChange={() => toggleThread(thread.id)}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? (
                                                <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.text }}>
                                                    {t("agent.history.current")}
                                                </span>
                                            ) : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || t("agent.history.untitled")}</div>
                                        </div>
                                        <div className="truncate text-[11px] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <span className="shrink-0 text-[10px] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt, i18n.language)}</span>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {t(connected ? "agent.history.noWorkspaceThreads" : "agent.history.connectHint")}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function formatThreadTime(value: number | undefined, locale: string) {
    if (!value) return "";
    return new Date(value * 1000).toLocaleString(locale);
}
