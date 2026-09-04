import { useEffect, useId, useState, type ReactNode } from "react";
import { App, Button, Image, Modal, Popover } from "antd";
import { Brain, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleAlert, Copy, ExternalLink, FilePenLine, FileText, FolderOpen, ListChecks, LoaderCircle, Search, ShieldAlert, TerminalSquare, Wrench, XCircle } from "lucide-react";
import { Streamdown, type LinkSafetyModalProps } from "streamdown";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore, type AgentCanvasReference, type AgentPendingApproval, type AgentSkillReference } from "@/stores/use-agent-store";
import { resolveAgentMessageAssetUrl, revealAgentLocalFile } from "@/services/api/canvas-agent";
import { AgentCanvasReferencePreview, canvasReferenceIcon, canvasReferenceKindLabel } from "./agent-canvas-reference-preview";
import { agentInlineTokenClass, agentInlineTokenIconClass, agentInlineTokenMediaClass, agentReferenceMarker, parseAgentInlineTokens } from "./agent-chat-inline-tokens";

const streamdownProps = () => ({
    className: "agent-streamdown",
    controls: { code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } },
    linkSafety: { enabled: true, renderModal: (props: LinkSafetyModalProps) => <AgentLinkModal {...props} /> },
    lineNumbers: false,
    translations: {
        close: tr("close"), copied: tr("copied"), copyCode: tr("copyCode"), copyLink: tr("copyLink"), externalLinkWarning: tr("externalWarning"), openExternalLink: tr("openExternal"), openLink: tr("continueOpen"),
    },
} as const);
const streamdownAnimation = { duration: 20, stagger: 0, sep: "word" } as const;

function AgentLinkModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const localPath = localFilePath(url);
    const [opening, setOpening] = useState(false);
    const open = async () => {
        if (!localPath) return onConfirm();
        const { url: endpoint, token } = useAgentStore.getState();
        setOpening(true);
        try {
            await revealAgentLocalFile(endpoint, token, localPath);
            message.success(t("agent.message.revealed"));
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.message.openLocalFailed"));
        } finally {
            setOpening(false);
        }
    };
    return (
        <Modal open={isOpen} onCancel={onClose} footer={null} centered width={420} title={t(localPath ? "agent.message.openLocal" : "agent.message.openExternal")}>
            <div className="text-sm text-black/55 dark:text-white/55">
                {t(localPath ? "agent.message.localDescription" : "agent.message.externalDescription")}
            </div>
            <div className="mt-4 max-h-32 overflow-auto break-all rounded-lg bg-black/[.035] px-3 py-2.5 font-mono text-xs leading-5 dark:bg-white/[.06]">{localPath || url}</div>
            <div className="mt-5 flex justify-end gap-2">
                <Button type="text" icon={<Copy className="size-4" />} onClick={() => copyText(localPath || url, t(localPath ? "agent.message.pathCopied" : "agent.message.linkCopied"))}>
                    {t(localPath ? "agent.message.copyPath" : "agent.message.copyLink")}
                </Button>
                <Button type="text" loading={opening} icon={localPath ? <FolderOpen className="size-4" /> : <ExternalLink className="size-4" />} onClick={open}>
                    {t(localPath ? "agent.message.showInFolder" : "agent.message.continueOpen")}
                </Button>
            </div>
        </Modal>
    );
}

function localFilePath(value: string) {
    let decoded = value;
    try {
        decoded = decodeURI(value);
    } catch {}
    if (decoded.startsWith("file://")) {
        try {
            return decodeURIComponent(new URL(decoded).pathname);
        } catch {
            return "";
        }
    }
    if (/^[A-Za-z]:[\\/]/.test(decoded)) return decoded;
    let pathname = decoded;
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        try {
            const parsed = new URL(decoded);
            if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) return "";
            pathname = parsed.pathname;
        } catch {
            return "";
        }
    }
    return /^\/(?:Users|home|private|tmp|Volumes|var\/folders)\//.test(pathname) ? decodeURIComponent(pathname) : "";
}

export type AgentChatAttachment = { id: string; name: string; url: string };
export type AgentChatMessageItem = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: AgentChatAttachment[];
    canvasReferences?: AgentCanvasReference[];
    skill?: AgentSkillReference;
    /** Present while the message is actively streaming; cleared on completion. */
    streamId?: string;
};

export function AgentChatMessage({ item, theme, onRejectTool, onApproveTool }: { item: AgentChatMessageItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onRejectTool?: (id: string) => void; onApproveTool?: (id: string) => void }) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return <AgentToolCard title={item.title || tr("toolCall")} text={item.text} detail={item.detail} theme={theme} />;
    }
    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={isUser ? "min-w-0 max-w-[82%] py-1 text-right text-sm leading-6" : "min-w-0 w-full text-left text-sm leading-6"}
                style={{ color }}
            >
                {isUser ? (
                    <AgentUserMessageContent text={item.text} references={item.canvasReferences || []} skill={item.skill} theme={theme} />
                ) : (
                    <Streamdown {...streamdownProps()} animated={streamdownAnimation} isAnimating={!!item.streamId}>{item.text}</Streamdown>
                )}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} alignRight={isUser} /> : null}
                {item.meta ? <div className={`mt-1 text-[11px] tabular-nums opacity-55 ${isUser ? "text-right" : ""}`}>{item.meta}</div> : null}
            </div>
        </div>
    );
}

function AgentUserMessageContent({ text, references, skill, theme }: { text: string; references: AgentCanvasReference[]; skill?: AgentSkillReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const tokens = parseAgentInlineTokens(text, references, skill);
    return (
        <div className="whitespace-pre-wrap break-words">
            {tokens.map((token, index) => token.type === "text"
                ? token.value
                : token.type === "skill"
                    ? <AgentSkillMention key={`skill:${index}`} skill={token.skill} theme={theme} />
                    : <AgentCanvasMention key={`${token.reference.nodeId}:${index}`} reference={token.reference} theme={theme} />)}
        </div>
    );
}

function AgentSkillMention({ skill, theme }: { skill: AgentSkillReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return <span className={agentInlineTokenClass} style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} title={skill.path}>/{skill.displayName || skill.name}</span>;
}

function AgentCanvasMention({ reference, theme }: { reference: AgentCanvasReference; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const node = useAgentStore((state) => state.canvasContext?.snapshot.nodes.find((item) => item.id === reference.nodeId));
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const previewUrl = resolveAgentMessageAssetUrl(endpoint, token, reference.previewUrl || node?.metadata?.content || "");
    const previewText = reference.text || node?.metadata?.content || node?.metadata?.prompt;
    const Icon = canvasReferenceIcon(reference.kind);
    return (
        <Popover
            trigger={["hover", "focus"]}
            placement="top"
            mouseEnterDelay={0.15}
            content={<AgentCanvasReferencePreview reference={reference} previewUrl={previewUrl} previewText={previewText} theme={theme} />}
        >
            <span
                tabIndex={0}
                className={`${agentInlineTokenClass} max-w-56 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/15`}
                style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                aria-label={i18n.t("agent.composer.mentions.referenceLabel", { kind: canvasReferenceKindLabel(reference.kind), title: reference.title })}
            >
                {reference.kind === "image" && previewUrl
                    ? <img src={previewUrl} alt="" className={agentInlineTokenMediaClass} />
                    : <Icon className={agentInlineTokenIconClass} />}
                <span>{agentReferenceMarker(reference)}</span>
            </span>
        </Popover>
    );
}

export function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onReject?: () => void; onApprove?: () => void }) {
    const { t } = useTranslation();
    const view = userDetail(detail);
    return (
        <div className="min-w-0 rounded-xl border px-3 py-3" style={{ borderColor: "rgba(217,119,6,.28)", background: "rgba(217,119,6,.025)", color: theme.node.text }}>
            <details className="group">
                <summary className={`list-none ${view ? "cursor-pointer" : "cursor-default"}`} onClick={(event) => { if (!view) event.preventDefault(); }}>
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium leading-5">
                        <CircleAlert className="size-4 shrink-0 text-amber-600" />
                        <span className="min-w-0 flex-1">{t("agent.message.awaitingConfirmation")}</span>
                        {view ? <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} /> : null}
                    </div>
                    <div className="mt-1 pl-6 text-sm leading-5" style={{ color: theme.node.muted }}>{summary}</div>
                </summary>
                {view ? <div className="ml-6"><AgentDetailBlock detail={view} theme={theme} /></div> : null}
            </details>
            {onReject || onApprove ? (
                <div className="mt-3 flex justify-end gap-2 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <Button danger type="text" className="!h-8" icon={<XCircle className="size-3.5" />} onClick={() => onReject?.()}>
                        {t("agent.message.reject")}
                    </Button>
                    <Button type="text" className="!h-8" icon={<CheckCircle2 className="size-3.5" />} style={{ color: "#16a34a" }} onClick={() => onApprove?.()}>
                        {t("agent.message.approve")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

export function AgentApprovalCard({ approval, theme, onDecision }: { approval: AgentPendingApproval; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onDecision: (decision: "accept" | "acceptForSession" | "decline") => void }) {
    const { t } = useTranslation();
    const isFile = approval.method === "item/fileChange/requestApproval";
    const isNetwork = Boolean(approval.networkApprovalContext);
    const title = t(isNetwork ? "agent.message.networkApproval" : isFile ? "agent.message.fileApproval" : approval.method === "item/permissions/requestApproval" ? "agent.message.permissionApproval" : "agent.message.commandApproval");
    const target = isNetwork ? approvalTarget(approval.networkApprovalContext) : isFile ? approval.grantRoot || approval.cwd : commandText(approval.command) || approval.cwd;
    return (
        <div className="min-w-0 rounded-xl border px-3 py-3" style={{ borderColor: "rgba(234,88,12,.32)", background: "rgba(234,88,12,.035)", color: theme.node.text }}>
            <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-orange-600" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{title}</div>
                    {approval.reason ? <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{approval.reason}</div> : null}
                    {target ? <div className="mt-1.5 break-all rounded-lg px-2.5 py-2 font-mono text-[11px] leading-4" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{target}</div> : null}
                </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                <Button danger type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "decline"} onClick={() => onDecision("decline")}>{t("agent.message.decline")}</Button>
                <Button type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "accept"} onClick={() => onDecision("accept")}>{t("agent.message.allowOnce")}</Button>
                <Button type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "acceptForSession"} style={{ color: "#ea580c" }} onClick={() => onDecision("acceptForSession")}>{t("agent.message.allowSession")}</Button>
            </div>
        </div>
    );
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const plan = planDetail(detail);
    if (plan) return <AgentPlanCard title={title} plan={plan} theme={theme} />;
    const kind = String(objectField(detail, "kind") || "");
    if (kind === "reasoning") return <AgentReasoningSummary text={text} detail={detail} theme={theme} />;
    if (kind === "command") return <AgentCommandGroup items={[{ id: title, text, detail }]} theme={theme} />;
    const state = toolCardState(title, text, detail);
    const view = userDetail(detail);
    const showText = title !== "读取画布" || text !== "已读取当前画布内容";
    const className = "group min-w-0 rounded-xl border px-3 py-2.5 text-left";
    const style = { borderColor: theme.node.stroke, background: "transparent", color: theme.node.text };
    const content = (
        <>
            <div className="flex min-w-0 items-center gap-2 text-sm leading-5">
                <span className="shrink-0" style={{ color: state.color }}>{toolIcon(kind, state.icon)}</span>
                <span className="min-w-0 truncate font-medium">{title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: state.color }}>{state.label}</span>
                {view ? <ChevronDown className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} /> : null}
            </div>
            {showText ? (
                <div className={`mt-1 whitespace-pre-wrap break-words pl-6 text-sm leading-5 ${kind === "command" ? "font-mono text-[12px]" : ""}`} style={{ color: state.isError ? state.color : theme.node.muted }}>
                    {text}
                </div>
            ) : null}
        </>
    );
    if (!view) return <div className={className} style={style}>{content}</div>;
    return (
        <details className={className} style={style}>
            <summary className="list-none cursor-pointer">{content}</summary>
            <div className="ml-6"><AgentDetailBlock detail={view} theme={theme} /></div>
        </details>
    );
}

function AgentReasoningSummary({ text, detail, theme }: { text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const status = String(objectField(detail, "status") || "");
    const running = ["inProgress", "in_progress", "running", "started", "pending"].includes(status);
    return (
        <details className="group min-w-0 text-left">
            <summary className="cursor-pointer list-none py-1 text-sm" style={{ color: theme.node.muted }}>
                <div className="flex min-w-0 items-center gap-2">
                    {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <Brain className="size-4 shrink-0" />}
                    <span>{t(running ? "agent.message.thinking" : "agent.events.reasoning")}</span>
                    <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
                </div>
            </summary>
            <div className="break-words pb-1 pl-6 pr-2 text-xs leading-5 [&_code]:rounded [&_code]:px-1 [&_p]:my-1 [&_pre]:my-2" style={{ color: theme.node.muted }}>
                <Streamdown {...streamdownProps()} animated={streamdownAnimation} isAnimating={running}>{text}</Streamdown>
            </div>
        </details>
    );
}

type AgentCommandItem = Pick<AgentChatMessageItem, "id" | "text" | "detail">;

export function AgentCommandGroup({ items, theme }: { items: AgentCommandItem[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const states = items.map((item) => commandViewState(item.detail));
    const running = states.some((state) => state.running);
    const failed = states.filter((state) => state.failed).length;
    const expandable = items.some((item) => Boolean(item.text.trim() || userDetail(item.detail)));
    const color = running ? "#d97706" : failed ? "#dc2626" : theme.node.muted;
    const label = running ? t(items.length > 1 ? "agent.message.commandsRunning" : "agent.message.commandRunning", { count: items.length }) : t("agent.message.commandsCompleted", { count: items.length, failed: failed ? t("agent.message.commandsFailed", { count: failed }) : "" });
    const header = (
        <div className="flex min-w-0 items-center gap-2 text-sm" style={{ color }}>
            {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <TerminalSquare className="size-4 shrink-0" />}
            <span className="font-medium">{label}</span>
            {expandable ? <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" /> : null}
        </div>
    );
    if (!expandable) return <div className="min-w-0 py-1 text-left">{header}</div>;
    return (
        <details className="group min-w-0 text-left">
            <summary className="cursor-pointer list-none py-1">{header}</summary>
            {items.length === 1
                ? <AgentSingleCommand item={items[0]} theme={theme} />
                : <div className="ml-6 mt-1">{items.map((item, index) => <AgentCommandEntry key={item.id} item={item} index={index} theme={theme} />)}</div>
            }
        </details>
    );
}

function AgentSingleCommand({ item, theme }: { item: AgentCommandItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const view = userDetail(item.detail);
    return (
        <div className="ml-6 pb-1">
            {item.text ? <div className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-5" style={{ color: theme.node.text }}>{item.text}</div> : null}
            {view ? <AgentDetailBlock detail={view} theme={theme} /> : null}
        </div>
    );
}

function AgentCommandEntry({ item, index, theme }: { item: AgentCommandItem; index: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const detailId = useId();
    const view = userDetail(item.detail);
    const state = commandViewState(item.detail);
    const status = t(state.failed ? "agent.message.failed" : state.running ? "agent.message.running" : "agent.message.completed");
    const color = state.failed ? "#dc2626" : state.running ? "#d97706" : "#16a34a";
    const content = (
        <>
            <span className="w-4 shrink-0 text-center text-[10px] tabular-nums opacity-50" style={{ color: theme.node.muted }}>{index + 1}</span>
            <code className="min-w-0 flex-1 truncate text-[11px] leading-5" style={{ color: theme.node.text }} title={item.text}>{item.text || t("agent.message.command")}</code>
            <span className="shrink-0" style={{ color }} title={status} aria-label={status}>
                {state.running ? <LoaderCircle className="size-3.5 animate-spin" /> : state.failed ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            </span>
            {view ? <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} style={{ color: theme.node.muted }} /> : null}
        </>
    );
    return (
        <div className={index ? "border-t" : ""} style={{ borderColor: theme.node.stroke }}>
            {view
                ? <button type="button" className="flex w-full min-w-0 items-center gap-2 py-2 text-left" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((value) => !value)}>{content}</button>
                : <div className="flex min-w-0 items-center gap-2 py-2 text-left">{content}</div>}
            {view && open ? <div id={detailId} className="pb-2 pl-6"><AgentDetailBlock detail={view} theme={theme} /></div> : null}
        </div>
    );
}

function commandViewState(detail: unknown) {
    const status = String(objectField(detail, "status") || "").toLowerCase();
    return {
        running: ["inprogress", "in_progress", "running", "started", "pending"].includes(status),
        failed: ["failed", "error"].includes(status),
    };
}

function AgentPlanCard({ title, plan, theme }: { title: string; plan: PlanDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const [open, setOpen] = useState(true);
    const completed = plan.tasks.filter((item) => item.status === "completed").length;
    const state = planCardState(plan, completed);
    return (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5">
                <ListChecks className="size-4 shrink-0" style={{ color: state.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: state.color }}>{state.label}</span>
                <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>{completed}/{plan.tasks.length}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} />
            </summary>
            {plan.explanation ? <div className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{plan.explanation}</div> : null}
            <div className="mt-2.5 space-y-2 border-t pt-2.5" style={{ borderColor: theme.node.stroke }}>
                {plan.tasks.map((item, index) => {
                    const task = planTaskState(item.status, theme.node.muted);
                    return (
                        <div key={`${index}-${item.step}`} className="flex items-start gap-2 text-sm leading-5">
                            <span className="mt-0.5 shrink-0" style={{ color: task.color }}>{task.icon}</span>
                            <span className={`min-w-0 flex-1 ${item.status === "completed" ? "opacity-55" : item.status === "inProgress" ? "font-medium" : ""}`} style={{ color: item.status === "inProgress" ? theme.node.text : theme.node.muted }}>{item.step}</span>
                            <span className="shrink-0 text-[11px]" style={{ color: task.color }}>{task.label}</span>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

export function AgentWorkingMessage({ text, detail, status = "running", mcpStatuses = [], activityKey, theme }: { text: string; detail?: string; status?: "running" | "ready" | "error"; mcpStatuses?: Array<{ name: string; status: "running" | "ready" | "error"; detail: string }>; activityKey: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const startedAt = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [activityKey]);
    return (
        <div className="min-w-0 py-1" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: theme.node.muted }}>
                {status === "running" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : status === "ready" ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="size-3.5 shrink-0 text-red-600" />}
                <span className="min-w-0">{text}</span>
                {status === "running" && elapsed >= 5 ? <span className="shrink-0 text-[11px] tabular-nums opacity-60">{waitingTime(elapsed)}</span> : null}
            </div>
            {detail ? <div className="ml-5.5 mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{detail}</div> : null}
            {mcpStatuses.length ? (
                <div className="ml-5.5 mt-3 space-y-2">
                    {mcpStatuses.map((item) => (
                        <div key={item.name} className="flex min-w-0 items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                            {item.status === "running" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : item.status === "ready" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}
                            <div className="min-w-0">
                                <div className="font-medium" style={{ color: theme.node.text }}>{item.name}</div>
                                <div className="opacity-65">{item.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
            {status === "running" && elapsed >= 30 ? <div className="mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{t("agent.message.slowResponse")}</div> : null}
        </div>
    );
}

function waitingTime(seconds: number) {
    if (seconds < 60) return tr("waitingSeconds", { seconds });
    const minutes = Math.floor(seconds / 60);
    return tr("waitingMinutes", { minutes, seconds: seconds % 60 });
}

function commandText(value: unknown) {
    if (Array.isArray(value)) return value.map(String).join(" ");
    return typeof value === "string" ? value : "";
}

function approvalTarget(value: unknown) {
    const host = String(objectField(value, "host") || "");
    const protocol = String(objectField(value, "protocol") || "");
    const port = String(objectField(value, "port") || "");
    return host ? `${protocol ? `${protocol}://` : ""}${host}${port ? `:${port}` : ""}` : "";
}

type PlanTask = { step: string; status: string };
type PlanDetail = { status: string; tasks: PlanTask[]; explanation?: string };
type UserDetail = { kind?: string; status?: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }> };

function AgentDetailBlock({ detail, theme }: { detail: UserDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    return (
        <div className="mt-3 space-y-2.5 border-t pt-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            {detail.rows?.length ? (
                <dl className="space-y-1.5">
                    {detail.rows.map((row) => (
                        <div key={`${row.label}-${row.value}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
                            <dt className="opacity-60">{row.label}</dt>
                            <dd className="min-w-0 break-words" style={{ color: theme.node.text }}>{row.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            {detail.files?.length ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t("agent.message.files")}</div>
                    {detail.files.map((file) => (
                        <div key={`${file.action}-${file.path}`} className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 break-all" style={{ color: theme.node.text }}>{file.path}</span>
                            {file.action ? <span className="shrink-0 opacity-60">{file.action}</span> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {detail.output ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t(detail.status === "failed" || detail.status === "error" ? "agent.message.errorInfo" : "agent.message.output")}</div>
                    <pre className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-[11px] leading-4" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{detail.output}</pre>
                </div>
            ) : null}
        </div>
    );
}

function AgentMessageAttachments({ attachments, alignRight }: { attachments: AgentChatAttachment[]; alignRight?: boolean }) {
    const { t } = useTranslation();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    return (
        <>
            <div className={`mt-1.5 flex flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-start"}`}>
                {attachments.map((item) => (
                    <img
                        key={item.id}
                        src={item.url}
                        alt={item.name}
                        title={t("agent.message.viewLarge")}
                        className="size-10 cursor-zoom-in rounded-lg object-cover"
                        draggable={false}
                        onClick={() => setPreviewUrl(item.url)}
                    />
                ))}
            </div>
            {previewUrl ? (
                <div className="hidden">
                    <Image src={previewUrl} alt={t("agent.message.attachmentPreview")} preview={{ visible: true, src: previewUrl, onVisibleChange: (visible) => !visible && setPreviewUrl(null) }} />
                </div>
            ) : null}
        </>
    );
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const status = String(objectField(detail, "status") || "").toLowerCase();
    if (status === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw)) return { label: tr("noEffect"), color: "#d97706", icon: <CircleAlert className="size-4" />, isError: false };
    if (["declined", "rejected", "cancelled", "canceled"].includes(status) || /拒绝|取消/.test(raw)) return { label: tr("canceled"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
    if (["failed", "error"].includes(status) || /失败|错误/.test(raw) || lower.includes("failed") || lower.includes("error")) return { label: tr("failed"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
    if (["inprogress", "in_progress", "running", "started", "pending"].includes(status)) return { label: tr("running"), color: "#d97706", icon: <LoaderCircle className="size-4 animate-spin" />, isError: false };
    if (["completed", "succeeded", "success"].includes(status) || /完成|成功/.test(raw)) return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: tr("recorded"), color: "#2563eb", icon: <Wrench className="size-4" />, isError: false };
}

function toolIcon(kind: string | undefined, fallback: ReactNode) {
    if (kind === "search") return <Search className="size-4" />;
    if (kind === "file") return <FilePenLine className="size-4" />;
    if (kind === "plan") return <ListChecks className="size-4" />;
    return fallback;
}

function planCardState(plan: PlanDetail, completed: number) {
    if (plan.status === "failed") return { label: tr("failed"), color: "#dc2626" };
    if (["interrupted", "cancelled", "canceled"].includes(plan.status)) return { label: tr("stopped"), color: "#d97706" };
    if (completed === plan.tasks.length) return { label: tr("completed"), color: "#16a34a" };
    if (plan.status === "finished") return { label: tr("finished"), color: "#2563eb" };
    return { label: tr("running"), color: "#d97706" };
}

function planTaskState(status: string, muted: string) {
    if (status === "completed") return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-3.5" /> };
    if (status === "inProgress") return { label: tr("running"), color: "#d97706", icon: <LoaderCircle className="size-3.5 animate-spin" /> };
    return { label: tr("pending"), color: muted, icon: <Circle className="size-3.5" /> };
}

function planDetail(value: unknown): PlanDetail | null {
    if (!value || typeof value !== "object" || objectField(value, "kind") !== "todo") return null;
    const tasks = Array.isArray(objectField(value, "tasks"))
        ? (objectField(value, "tasks") as unknown[]).flatMap((item) => {
              const step = String(objectField(item, "step") || "").trim();
              return step ? [{ step, status: String(objectField(item, "status") || "pending") }] : [];
          })
        : [];
    if (!tasks.length) return null;
    const explanation = String(objectField(value, "explanation") || "").trim();
    return { status: String(objectField(value, "status") || "inProgress"), tasks, ...(explanation ? { explanation } : {}) };
}

function userDetail(value: unknown): UserDetail | null {
    if (!value || typeof value !== "object") return null;
    const detail = value as Record<string, unknown>;
    const rows = Array.isArray(detail.rows)
        ? detail.rows.flatMap((row) => {
              if (!row || typeof row !== "object") return [];
              const label = String((row as Record<string, unknown>).label || "");
              const value = String((row as Record<string, unknown>).value || "");
              return label && value ? [{ label, value }] : [];
          })
        : [];
    const files = Array.isArray(detail.files)
        ? detail.files.flatMap((file) => {
              if (!file || typeof file !== "object") return [];
              const path = String((file as Record<string, unknown>).path || "");
              return path ? [{ path, action: String((file as Record<string, unknown>).action || "") || undefined }] : [];
          })
        : [];
    const error = objectField(detail.error, "message");
    const output = typeof detail.output === "string" ? detail.output.trim() : typeof error === "string" ? error : "";
    if (!rows.length && !files.length && !output) return null;
    return { kind: typeof detail.kind === "string" ? detail.kind : undefined, status: typeof detail.status === "string" ? detail.status : undefined, rows, files, output };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return String(objectField(value, "message") || "");
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function tr(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.message.${key}`, options);
}
