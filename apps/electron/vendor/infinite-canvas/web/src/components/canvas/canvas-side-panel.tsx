import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Empty, Input, Popconfirm, Select, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, ChevronRight, Download, Eye, FileText, Image as ImageIcon, ListChecks, Music2, Plus, Search, Settings2, Square, Trash2, Type, Video } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { fetchSourcePrompts, type Prompt } from "@/services/api/prompts";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const tab = useCanvasSidePanelStore((state) => state.activeTab);
    const openTab = useCanvasSidePanelStore((state) => state.openTab);
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="absolute inset-y-0 left-0 z-[60] flex h-full"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-5 px-4 pt-3.5">
                    <TabButton label={t("canvas.sidePanel.canvas")} active={tab === "canvas"} theme={theme} onClick={() => openTab("canvas")} />
                    <TabButton label={t("canvas.sidePanel.assets")} active={tab === "assets"} theme={theme} onClick={() => openTab("assets")} />
                    <TabButton label={t("canvas.sidePanel.prompts")} active={tab === "prompts"} theme={theme} onClick={() => openTab("prompts")} />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {tab === "canvas" ? (
                        <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                    ) : tab === "assets" ? (
                        <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                    ) : (
                        <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                    )}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.sidePanel.resize")} />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Canvas tab: list nodes and center, zoom, and select the clicked node.
// ---------------------------------------------------------------------------

const NODE_FILTER_VALUES = ["all", CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text, CanvasNodeType.Audio, CanvasNodeType.Config, CanvasNodeType.Group];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.sidePanel.exportName", { count: targets.length }));
            message.success(t("canvas.sidePanel.exported", { count: targets.length }));
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="text-xs font-medium opacity-60">{t("canvas.sidePanel.elements")}</span>
                {filtered.length ? <span className="text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                </button>
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_VALUES.map((value) => ({ value, label: value === "all" ? t("common.all") : t(`canvas.sidePanel.filter.${value}`) }))} />}
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchNodes")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="space-y-1.5">
                        {filtered.map((node) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const isChecked = checked.has(node.id);
                            const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                            return (
                                <div key={node.id} className={cn("group flex w-full items-center rounded-lg transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")} style={active ? { background: theme.toolbar.activeBg } : undefined}>
                                    <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : onFocusNode(node.id))} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left" title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}>
                                        {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                                        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                                            {isImage ? <img src={node.metadata!.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}
                                        </span>
                                        <span className="min-w-0 flex-1 space-y-0.5">
                                            <span className="block truncate text-sm font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
                                            <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span>
                                        </span>
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                    {selectMode || !isImage ? null : (
                                        <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5">
                                            <button type="button" onClick={() => onPreviewNode(node.id)} className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.preview")} title={t("canvas.sidePanel.preview")}>
                                                <Eye className="size-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{t("canvas.sidePanel.noNodes")}</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {allChecked ? t("canvas.sidePanel.clearAll") : t("workbench.selectAll")}
                    </button>
                    <span className="text-xs opacity-45">{t("canvas.sidePanel.selected", { count: checked.size })}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        {t("canvas.exportSelected")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Assets tab: collapsible type groups, tag filtering, and click-to-insert.
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; icon: typeof Square }[] = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Video },
    { kind: "text", icon: FileText },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        let added = 0;
        try {
            for (const file of files) {
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file);
                    addAsset({ kind: "image", title: file.name || t("assets.kinds.image"), coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
                    added += 1;
                } else if (file.type.startsWith("video/")) {
                    const media = await uploadMediaFile(file, "video");
                    addAsset({ kind: "video", title: file.name || t("assets.kinds.video"), coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
                    added += 1;
                }
            }
            if (added) message.success(t("canvas.sidePanel.addedAssets", { count: added }));
            else message.warning(t("canvas.sidePanel.mediaOnly"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchAssets")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <Plus className="size-3.5" />
                    {t("canvas.sidePanel.add")}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        {t("common.all")}
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{t(`assets.kinds.${group.kind}`)}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(buildInsertPayload(asset))} onRemove={() => (removeAsset(asset.id), message.success(t("canvas.sidePanel.assetRemoved")))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noAssets")} className="pt-16" />
                )}
            </div>
        </div>
    );
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="group relative aspect-square overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <AssetCover asset={asset} />
            <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-4" />
                </button>
                <Popconfirm title={t("canvas.sidePanel.removeAssetTitle")} okText={t("canvas.sidePanel.remove")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label={t("canvas.sidePanel.removeAsset")}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") {
        if (asset.coverUrl) return <img src={asset.coverUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
        return <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
    }
    return <img src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
}

// ---------------------------------------------------------------------------
// Prompt library tab: collapsible source groups, lazy loading, and copy or text-node insertion actions.
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [detail, setDetail] = useState<Prompt | null>(null);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("canvas.sidePanel.promptCopied"));
        } catch {
            message.error(t("canvas.sidePanel.copyFailed"));
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchPrompts")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-1">
                    {enabledSources.length ? enabledSources.map((source) => (
                        <PromptSourceGroup
                            key={source.id}
                            sourceId={source.id}
                            sourceName={source.name}
                            keyword={keyword}
                            open={!!expanded[source.id]}
                            theme={theme}
                            onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                            onInsert={onInsert}
                            onView={setDetail}
                        />
                    )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noPrompts")} className="pt-12" />}
                </div>
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

function PromptSourceGroup({
    sourceId,
    sourceName,
    keyword,
    open,
    theme,
    onToggle,
    onInsert,
    onView,
}: {
    sourceId: string;
    sourceName: string;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onView: (prompt: Prompt) => void;
}) {
    const { t } = useTranslation();
    // Cache a source after its first expansion to avoid repeated requests; search results also need the data for counts.
    const showResults = open || !!keyword.trim();
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });

    const filtered = useMemo(() => {
        const items = query.data || [];
        const q = keyword.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(q));
    }, [query.data, keyword]);

    const insertPrompt = (item: Prompt) => onInsert({ kind: "text", content: item.prompt, title: item.title });

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{sourceName}</span>
                {showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
            </button>
            {showResults ? (
                <div className="px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            {t("canvas.sidePanel.loadFailedRetry")}
                        </button>
                    ) : filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.map((item) => (
                                <PromptRow key={item.id} item={item} theme={theme} onInsert={() => insertPrompt(item)} onView={() => onView(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{keyword.trim() ? t("canvas.sidePanel.noMatchingPrompts") : t("canvas.sidePanel.sourceEmpty")}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.viewDetails")} title={t("canvas.sidePanel.viewDetails")}>
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("canvas.sidePanel.inserted")}
                    title={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
