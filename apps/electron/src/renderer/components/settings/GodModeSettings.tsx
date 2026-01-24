/**
 * GodModeSettings
 *
 * Dev-only settings section for God Mode (self-building feature).
 * Only visible when app is running in debug mode.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsTextarea,
} from '@/components/settings'
import type { GodModeConfig } from '../../../shared/types'

// Default context for the God Mode agent
const DEFAULT_GOD_MODE_CONTEXT = `You are working in God Mode - a special self-building environment for Craft Agent.

Your working directory is the Craft Agent source code itself. You have the power to modify the application that you're running inside.

When you receive annotations from Agentation:
1. The user has clicked on a UI element and provided feedback
2. The annotation includes an HTML snapshot and CSS selectors
3. Use this information to locate the relevant React component
4. Make the requested changes to improve the UI/UX

Remember:
- This is an Electron + React monorepo
- UI components are in apps/electron/src/renderer/
- Be careful with changes - they affect the running application
- Test your changes by asking the user to reload the app
`

export interface GodModeSettingsProps {
  /** Whether debug mode is enabled */
  isDebugMode: boolean
}

export function GodModeSettings({ isDebugMode }: GodModeSettingsProps) {
  const [config, setConfig] = useState<GodModeConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInitializing, setIsInitializing] = useState(false)

  // Load config on mount
  useEffect(() => {
    if (!isDebugMode) return

    const loadConfig = async () => {
      try {
        const cfg = await window.electronAPI.getGodModeConfig()
        setConfig(cfg)
      } catch (error) {
        console.error('Failed to load God Mode config:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [isDebugMode])

  // Save config helper
  const saveConfig = useCallback(async (newConfig: GodModeConfig | null) => {
    try {
      await window.electronAPI.setGodModeConfig(newConfig)
      setConfig(newConfig)
    } catch (error) {
      console.error('Failed to save God Mode config:', error)
      toast.error('Failed to save God Mode settings')
    }
  }, [])

  // Handle enable toggle
  const handleEnableChange = useCallback(async (enabled: boolean) => {
    if (enabled && (!config?.sourcePath)) {
      toast.error('Please set the source path first')
      return
    }

    const newConfig: GodModeConfig | null = enabled
      ? {
          enabled: true,
          sourcePath: config?.sourcePath || '',
          workspaceContext: config?.workspaceContext || DEFAULT_GOD_MODE_CONTEXT,
        }
      : null

    await saveConfig(newConfig)

    if (enabled) {
      // Initialize workspace
      setIsInitializing(true)
      try {
        const result = await window.electronAPI.initializeGodModeWorkspace()
        if (result.success) {
          toast.success('God Mode enabled! Check the workspace switcher for the God Mode workspace.')
          // Dispatch event to refresh workspaces in the app
          window.dispatchEvent(new CustomEvent('workspaces-changed'))
        } else {
          toast.error(`Failed to initialize: ${result.error}`)
          await saveConfig(null) // Disable on failure
        }
      } catch (error) {
        toast.error('Failed to initialize God Mode workspace')
        await saveConfig(null)
      } finally {
        setIsInitializing(false)
      }
    } else {
      toast.success('God Mode disabled')
    }
  }, [config, saveConfig])

  // Handle source path change
  const handleChangeSourcePath = useCallback(async () => {
    try {
      const selectedPath = await window.electronAPI.openFolderDialog()
      if (selectedPath) {
        const newConfig: GodModeConfig = {
          enabled: config?.enabled || false,
          sourcePath: selectedPath,
          workspaceContext: config?.workspaceContext || DEFAULT_GOD_MODE_CONTEXT,
        }
        await saveConfig(newConfig)
        toast.success('Source path updated')
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
      toast.error('Failed to select folder')
    }
  }, [config, saveConfig])

  // Handle context change
  const handleContextChange = useCallback(async (value: string) => {
    if (!config) return

    const newConfig: GodModeConfig = {
      ...config,
      workspaceContext: value,
    }
    await saveConfig(newConfig)
  }, [config, saveConfig])

  // Don't render if not in debug mode
  if (!isDebugMode) {
    return null
  }

  if (isLoading) {
    return null
  }

  return (
    <SettingsSection
      title="God Mode (Dev Only)"
      description="Self-building feature: Allow the agent to modify Craft Agent's own source code based on visual UI annotations."
    >
      <SettingsCard>
        <SettingsRow
          label="Source Path"
          description={config?.sourcePath || 'Not configured'}
          action={
            <button
              type="button"
              onClick={handleChangeSourcePath}
              className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              {config?.sourcePath ? 'Change' : 'Select'}
            </button>
          }
        />
        <SettingsToggle
          label="Enable God Mode"
          description={isInitializing ? 'Initializing workspace...' : 'Creates a special workspace with access to Craft Agent source'}
          checked={config?.enabled || false}
          onCheckedChange={handleEnableChange}
          disabled={!config?.sourcePath || isInitializing}
        />
      </SettingsCard>

      {config?.enabled && (
        <SettingsCard>
          <div className="px-4 py-3.5">
            <div className="text-sm font-medium text-foreground mb-1">Workspace Context</div>
            <div className="text-xs text-muted-foreground mb-3">
              Instructions given to the agent when working in God Mode
            </div>
            <SettingsTextarea
              value={config.workspaceContext || DEFAULT_GOD_MODE_CONTEXT}
              onChange={handleContextChange}
              placeholder="Enter context for the agent..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>
        </SettingsCard>
      )}
    </SettingsSection>
  )
}
