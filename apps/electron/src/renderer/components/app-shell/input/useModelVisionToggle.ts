import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  setModelSupportsImages,
  type LlmConnection,
} from '@config/llm-connections'
import { useOptionalAppShellContext } from '@/context/AppShellContext'

export type ToggleModelVision = (
  connectionSlug: string,
  modelId: string,
  enabled: boolean,
) => Promise<void>

/**
 * Toggle per-model image support on a pi_compat (custom endpoint) connection.
 *
 * Same implementation as the inline callback that used to live in
 * `FreeFormInput.tsx` — extracted so the desktop dropdown and the compact
 * (drawer) model picker share one source of truth and stay aligned with
 * `setModelSupportsImages` / `modelSupportsImages` in `@config/llm-connections`.
 */
export function useModelVisionToggle(): ToggleModelVision {
  const { t } = useTranslation()
  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const refreshLlmConnections = appShellCtx?.refreshLlmConnections

  return React.useCallback(async (connectionSlug, modelId, enabled) => {
    if (!window.electronAPI) return
    const conn = llmConnections.find(c => c.slug === connectionSlug)
    if (!conn) return
    try {
      const { isAuthenticated: _a, authError: _b, isDefault: _c, ...bare } = conn
      const updated = setModelSupportsImages(bare as LlmConnection, modelId, enabled)
      const result = await window.electronAPI.saveLlmConnection(updated)
      if (!result.success) {
        console.error('Failed to toggle model vision:', result.error)
        toast.error(t('chat.modelPicker.toggleVisionFailed'))
        return
      }
      await refreshLlmConnections?.()
    } catch (error) {
      console.error('Failed to toggle model vision:', error)
      toast.error(t('chat.modelPicker.toggleVisionFailed'))
    }
  }, [llmConnections, refreshLlmConnections, t])
}
