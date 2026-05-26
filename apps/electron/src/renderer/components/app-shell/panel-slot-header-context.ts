import type * as React from 'react'
import type { AppShellContextType } from '@/context/AppShellContext'

interface PanelSlotHeaderContextOptions {
  leadingAction?: React.ReactNode
  isFocusedPanel: boolean
}

/**
 * Builds the per-panel AppShell context values consumed by page headers.
 */
export function createPanelSlotHeaderContext(
  parentContext: AppShellContextType,
  {
    leadingAction,
    isFocusedPanel,
  }: PanelSlotHeaderContextOptions,
): AppShellContextType {
  return {
    ...parentContext,
    leadingAction,
    isFocusedPanel,
  }
}
