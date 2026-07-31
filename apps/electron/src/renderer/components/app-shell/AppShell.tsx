/**
 * AppShell - DEPRECATED: Use LayoutShell with ChatSessionArea instead
 * 
 * This component is now a thin wrapper around ChatSessionArea for backward
 * compatibility. It will be removed once all consumers are updated.
 */

import * as React from "react"
import { AppShellProvider, type AppShellContextType } from "@/context/AppShellContext"
import { ChatSessionArea } from "@/shell"

interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides sidebars, shows only the chat content */
  isFocusedMode?: boolean
}

export function AppShell(props: AppShellProps) {
  return <ChatSessionArea {...props} />
}
