import { forwardRef, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type MentionState = {
    start: number;
    query: string;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, ...props }, forwardedRef) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasSelection, setHasSelection] = useState(false);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const activeReferences = references.filter((item) => item.active);
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);
    const activeLabels = useMemo(() => (highlightLabels ? Array.from(new Set(references.filter((item) => item.active).map((item) => item.label))).sort((a, b) => b.length - a.length) : []), [highlightLabels, references]);

    const updateValue = (next: string, selectionStart?: number) => {
        onChange(next);
        if (typeof selectionStart !== "number") return;
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const prefix = nextValue.slice(0, cursor);
        const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
        if (!match || !references.some((item) => item.active)) {
            closeMention();
            return;
        }
        setMention({ start: cursor - match[2].length - 1, query: match[2] });
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const textarea = textareaRef.current;
        const end = textarea?.selectionStart ?? value.length;
        const insertText = `${reference.label} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const syncOverlayScroll = () => {
        if (!overlayRef.current || !textareaRef.current) return;
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    };

    const updateSelectionState = () => {
        const textarea = textareaRef.current;
        setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
    };

    const showOverlay = Boolean(activeLabels.length && !hasSelection);
    const mergedStyle = {
        ...(style || {}),
        color: showOverlay ? "transparent" : style?.color,
        caretColor: style?.color || theme.node.text,
        cursor: "text",
        // The highlight layer covers the textarea when showOverlay is active, so keep the textarea above it to preserve the native caret.
        ...(showOverlay ? { position: "relative", zIndex: 1, background: "transparent", backgroundColor: "transparent" } : {}),
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu textarea={textareaRef.current} caretIndex={mention.start} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full ${containerClassName || ""}`}>
            {showOverlay ? (
                <div ref={overlayRef} className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`} style={{ ...style, color: theme.node.text }}>
                    <MentionHighlightText value={value || props.placeholder?.toString() || ""} labels={activeLabels} placeholder={!value} />
                </div>
            ) : null}
            <textarea
                {...props}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={value}
                className={className}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                    requestAnimationFrame(() => {
                        syncOverlayScroll();
                        updateSelectionState();
                    });
                }}
                onSelect={(event) => {
                    updateSelectionState();
                    props.onSelect?.(event);
                }}
                onKeyUp={(event) => {
                    updateSelectionState();
                    props.onKeyUp?.(event);
                }}
                onPointerUp={(event) => {
                    updateSelectionState();
                    props.onPointerUp?.(event);
                }}
                onKeyDown={(event) => {
                    if (isImeComposing(event)) {
                        onKeyDown?.(event);
                        return;
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && !mention) {
                        const el = textareaRef.current;
                        if (el && el.selectionStart === el.selectionEnd) {
                            const result = deleteAdjacentLabel(value, el.selectionStart, event.key === "Backspace" ? "backward" : "forward", activeLabels);
                            if (result) {
                                event.preventDefault();
                                updateValue(result.value, result.caret);
                                requestAnimationFrame(updateSelectionState);
                                return;
                            }
                        }
                    }
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    syncOverlayScroll();
                    props.onScroll?.(event);
                }}
                onBlur={(event) => {
                    setHasSelection(false);
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
});

function MentionHighlightText({ value, labels, placeholder }: { value: string; labels: string[]; placeholder: boolean }) {
    if (placeholder) return <span className="opacity-45">{value}</span>;
    if (!labels.length) return <>{value}</>;
    const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
    return (
        <>
            {value.split(pattern).map((part, index) =>
                labels.includes(part) ? (
                    <span key={`${part}-${index}`} className="rounded-md bg-[#2f80ff]/16 px-1 py-0.5 font-medium text-[#2f80ff] ring-1 ring-[#2f80ff]/24">
                        {part}
                    </span>
                ) : (
                    <span key={`${part}-${index}`}>{part}</span>
                ),
            )}
        </>
    );
}

function MentionMenu({ textarea, caretIndex, references, activeIndex, theme, onSelect }: { textarea: HTMLTextAreaElement; caretIndex: number; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const rect = textarea.getBoundingClientRect();
    const boundary = textarea.closest(".ant-modal-content")?.getBoundingClientRect() || { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    // Anchor the menu to the pixel position of the @ caret instead of the textarea edge.
    // The canvas may be scaled: rect uses scaled coordinates while mirror measurements use layout coordinates, so apply the scale.
    const scale = textarea.offsetWidth ? rect.width / textarea.offsetWidth : 1;
    const computed = window.getComputedStyle(textarea);
    const lineHeight = (parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 20) * scale;
    const caret = getCaretPoint(textarea, caretIndex);
    const caretLeft = rect.left + (caret.left - textarea.scrollLeft) * scale;
    const caretTop = rect.top + (caret.top - textarea.scrollTop) * scale;
    const left = clamp(caretLeft, boundary.left + 8, boundary.right - menuWidth - 8);
    const showAbove = caretTop + lineHeight + gap + maxMenuHeight > boundary.bottom && caretTop - gap - maxMenuHeight >= boundary.top;
    const top = clamp(showAbove ? caretTop - gap - maxMenuHeight : caretTop + lineHeight + gap, boundary.top + 8, boundary.bottom - maxMenuHeight - 8);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

// Mirror the textarea layout in a div to measure the caret at index in unscaled layout coordinates.
const MIRROR_STYLE_PROPS = ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "textTransform"] as const;

function getCaretPoint(textarea: HTMLTextAreaElement, index: number) {
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const style = mirror.style;
    style.position = "absolute";
    style.top = "0";
    style.left = "-9999px";
    style.visibility = "hidden";
    style.whiteSpace = "pre-wrap";
    style.overflowWrap = "break-word";
    for (const prop of MIRROR_STYLE_PROPS) style[prop] = computed[prop];
    mirror.textContent = textarea.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = textarea.value.slice(index) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const point = { left: marker.offsetLeft, top: marker.offsetTop };
    document.body.removeChild(mirror);
    return point;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A plain textarea cannot represent atomic tokens, so delete a complete reference label at once.
// Labels must be ordered by descending length so longer labels match first.
function deleteAdjacentLabel(value: string, caret: number, direction: "backward" | "forward", labels: string[]): { value: string; caret: number } | null {
    if (direction === "backward") {
        const before = value.slice(0, caret);
        for (const label of labels) {
            if (!label) continue;
            const match = new RegExp(`(^|\\s)(${escapeRegExp(label)})\\s*$`).exec(before);
            if (match) {
                const start = match.index + match[1].length; // Label start; preserve the preceding separator space.
                return { value: value.slice(0, start) + value.slice(caret), caret: start };
            }
        }
    } else {
        // Forward deletion requires the caret to follow a line boundary or whitespace to avoid cutting into other text.
        if (caret > 0 && !/\s/.test(value[caret - 1])) return null;
        const after = value.slice(caret);
        for (const label of labels) {
            if (!label) continue;
            const match = new RegExp(`^(\\s*)(${escapeRegExp(label)})(?=\\s|$)`).exec(after);
            if (match) {
                return { value: value.slice(0, caret) + value.slice(caret + match[0].length), caret };
            }
        }
    }
    return null;
}
