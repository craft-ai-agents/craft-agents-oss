import { useState } from "react";
import { Bot, X } from "lucide-react";
import { motion } from "motion/react";

import { JonworkSessionPanel } from "./jonwork-session-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const [maximized, setMaximized] = useState(false);

    const handleTogglePanel = () => {
        if (panelOpen) setMaximized(false);
        togglePanel();
    };

    return (
        <div className="pointer-events-none fixed inset-0 z-[90]">
            <motion.aside
                className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl border shadow-2xl ${maximized ? "inset-x-4 bottom-[88px] top-4" : "bottom-[88px] right-4 max-h-[calc(100vh-112px)]"}`}
                data-canvas-shortcuts-ignore
                initial={false}
                animate={{ y: panelOpen ? 0 : 18, scale: panelOpen ? 1 : 0.96, opacity: panelOpen ? 1 : 0 }}
                transition={{ duration: PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: maximized ? "auto" : `min(${width}px, calc(100vw - 32px))`, height: maximized ? "auto" : "min(620px, calc(100vh - 88px))", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text, pointerEvents: panelOpen ? undefined : "none" }}
            >
                <JonworkSessionPanel maximized={maximized} onToggleMaximize={() => setMaximized((value) => !value)} />
            </motion.aside>
            <button
                type="button"
                onClick={handleTogglePanel}
                className="pointer-events-auto absolute bottom-5 right-4 flex h-14 min-w-14 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,.38),0_0_0_4px_rgba(59,130,246,.16)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(59,130,246,.48),0_0_0_5px_rgba(59,130,246,.2)]"
                style={{ background: "#3b82f6", borderColor: "rgba(255,255,255,.38)" }}
                aria-label={panelOpen ? "收起 Jonwork 画布会话" : "打开 Jonwork 画布会话"}
                title={panelOpen ? "收起画布会话" : "打开画布会话"}
            >
                {panelOpen ? <X className="size-4" /> : <Bot className="size-4" />}
                <span>{panelOpen ? "收起" : "AI 会话"}</span>
                {!panelOpen ? <span className="absolute right-1 top-0.5 size-2.5 rounded-full border-2 border-white" style={{ background: "#22c55e" }} /> : null}
            </button>
        </div>
    );
}
