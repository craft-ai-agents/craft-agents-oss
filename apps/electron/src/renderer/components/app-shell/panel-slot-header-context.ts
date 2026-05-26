import type * as React from 'react'
import type { AppShellContextType } from '@/context/AppShellContext'

interface PanelSlotHeaderContextOptions {
  leadingAction?: React.ReactNode
}

/**
 * Builds the content-panel AppShell context values consumed by page headers.
 */
export function createPanelSlotHeaderContext(
  parentContext: AppShellContextType,
  {
    leadingAction,
  }: PanelSlotHeaderContextOptions,
): AppShellContextType {
  return {
    ...parentContext,
    leadingAction,
    isFocusedPanel: true,
  }
}
