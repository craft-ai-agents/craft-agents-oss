import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentCanvasReference } from "@/stores/use-agent-store";

export function AgentCanvasReferencePreview({ reference, previewUrl, previewText, theme }: { reference: AgentCanvasReference; previewUrl?: string; previewText?: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const Icon = canvasReferenceIcon(reference.kind);
    return (
        <div className="w-64" style={{ color: theme.node.text }}>
            <div className="mb-2 flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate text-sm font-medium">{reference.title}</span>
            </div>
            {reference.kind === "image" && previewUrl ? <img src={previewUrl} alt={reference.title} className="max-h-64 w-full rounded-md object-contain" /> : null}
            {reference.kind === "video" && previewUrl ? <video src={previewUrl} controls preload="metadata" className="max-h-64 w-full rounded-md" /> : null}
            {reference.kind === "audio" && previewUrl ? <audio src={previewUrl} controls preload="metadata" className="w-full" /> : null}
            {reference.kind === "text" && previewText ? (
                <div className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>
                    {previewText}
                </div>
            ) : null}
            {!previewUrl && !(reference.kind === "text" && previewText) ? <div className="py-3 text-center text-xs" style={{ color: theme.node.muted }}>{t("agent.composer.mentions.previewUnavailable")}</div> : null}
        </div>
    );
}

export function canvasReferenceIcon(kind: AgentCanvasReference["kind"]) {
    return kind === "audio" ? Music2 : kind === "video" ? Video : kind === "image" ? ImageIcon : FileText;
}

export function canvasReferenceKindLabel(kind: AgentCanvasReference["kind"]) {
    return i18n.t(`agent.composer.mentions.kind.${kind}`);
}
