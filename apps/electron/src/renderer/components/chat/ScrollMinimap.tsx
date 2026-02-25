"use client"

/**
 * ScrollMinimap — 消息导航：迷你彩带嵌入 message 列表
 *
 * 每条一行 = 左侧色条（角色）+ 右侧预览，点击跳转
 */

import * as React from "react"
import { cn } from "@/lib/utils"

export type TurnSegmentType = "user" | "assistant" | "system" | "auth"

/** State passed from ChatDisplay to right sidebar */
export interface ChatMinimapState {
  viewportRef: React.RefObject<HTMLDivElement | null>
  turnCount: number
  turnTypes: TurnSegmentType[]
  turnLabels: string[]
  onSegmentClick: (index: number) => void
}

interface ScrollMinimapProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
  turnCount: number
  turnTypes?: TurnSegmentType[]
  turnLabels?: string[]
  onSegmentClick?: (index: number) => void
  className?: string
  width?: number
}

const MAX_PREVIEW_LEN = 40

const SEGMENT_BG: Record<TurnSegmentType, string> = {
  user: "bg-primary/40",
  assistant: "bg-muted-foreground/30",
  system: "bg-amber-500/35",
  auth: "bg-orange-500/35",
}

export function ScrollMinimap({
  viewportRef,
  turnCount,
  turnTypes = [],
  turnLabels = [],
  onSegmentClick,
  className,
  width,
}: ScrollMinimapProps) {
  if (turnCount === 0) return null

  const fillContainer = width == null
  const types: TurnSegmentType[] = []
  for (let i = 0; i < turnCount; i++) {
    types.push(turnTypes[i] ?? "assistant")
  }

  return (
    <div
      className={cn(
        "flex min-w-0 rounded-lg border border-border/40 bg-foreground-2/80 overflow-hidden",
        fillContainer ? "w-full h-full min-h-0" : "shrink-0 h-full",
        className
      )}
      style={width != null ? { width } : { minWidth: 0, width: "100%" }}
      aria-label="Message map"
    >
      {/* 列表：每行 = 色条 + 预览 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {turnLabels.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSegmentClick?.(i)}
              title={label}
              className={cn(
                "w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-sm",
                "hover:bg-foreground/[0.06] active:bg-foreground/[0.08] transition-colors",
                "text-foreground/90"
              )}
            >
              <span
                className={cn("shrink-0 w-1 rounded-full self-stretch min-h-[12px]", SEGMENT_BG[types[i]])}
                aria-hidden
              />
              <span className="flex-1 min-w-0 truncate text-xs">
                {label.length > MAX_PREVIEW_LEN ? `${label.slice(0, MAX_PREVIEW_LEN)}…` : label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
