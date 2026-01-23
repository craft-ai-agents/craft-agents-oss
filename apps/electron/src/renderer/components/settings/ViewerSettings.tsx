/**
 * Viewer Settings Section
 *
 * Configure session sharing viewer backend.
 * Allows choosing between Craft hosted, static export, self-hosted, and local viewer.
 */

import { useEffect, useState } from 'react'
import { useAtom, atom } from 'jotai'
import { Globe, CheckCircle2, XCircle, Upload } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRadioGroup,
  SettingsRadioCard,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Import viewer types from shared types
import type { ViewerConfig, ViewerType } from '@/shared/types'

// Atoms for state management
const viewerTypeAtom = atom<ViewerType>('craft-hosted')
const craftUrlAtom = atom<string>('')
const selfHostedUrlAtom = atom<string>('')
const staticExportPathAtom = atom<string>('')
const staticUploadCommandAtom = atom<string>('')
const isLoadingAtom = atom<boolean>(false)
const errorAtom = atom<string | null>(null)
const testStatusAtom = atom<'idle' | 'checking' | 'success' | 'error'>('idle')

export function ViewerSettings() {
  const [viewerType, setViewerType] = useAtom(viewerTypeAtom)
  const [craftUrl, setCraftUrl] = useAtom(craftUrlAtom)
  const [selfHostedUrl, setSelfHostedUrl] = useAtom(selfHostedUrlAtom)
  const [staticExportPath, setStaticExportPath] = useAtom(staticExportPathAtom)
  const [staticUploadCommand, setStaticUploadCommand] = useAtom(staticUploadCommandAtom)
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom)
  const [error, setError] = useAtom(errorAtom)
  const [testStatus, setTestStatus] = useAtom(testStatusAtom)

  // Load viewer config on mount
  useEffect(() => {
    const loadConfig = async () => {
      if (!window.electronAPI?.getViewerConfig) return

      setIsLoading(true)
      try {
        const result = await window.electronAPI.getViewerConfig()
        if (result.success && result.config) {
          setViewerType(result.config.type || 'craft-hosted')
          setCraftUrl(result.config.craftUrl || '')
          setSelfHostedUrl(result.config.selfHostedUrl || '')
          setStaticExportPath(result.config.staticExportPath || '')
          setStaticUploadCommand(result.config.staticUploadCommand || '')
        }
      } catch (err) {
        console.error('Failed to load viewer config:', err)
        setError('Failed to load viewer configuration')
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [setViewerType, setCraftUrl, setSelfHostedUrl, setStaticExportPath, setStaticUploadCommand, setIsLoading, setError])

  const handleTestConnection = async () => {
    if (!window.electronAPI?.testViewerConnection) return

    setTestStatus('checking')
    setError(null)

    try {
      const config: ViewerConfig = {
        type: viewerType,
        craftUrl: viewerType === 'craft-hosted' ? craftUrl : undefined,
        selfHostedUrl: viewerType === 'self-hosted' ? selfHostedUrl : undefined,
      }

      const result = await window.electronAPI.testViewerConnection(config)

      if (result.success) {
        setTestStatus('success')
        setTimeout(() => setTestStatus('idle'), 3000)
      } else {
        setTestStatus('error')
        setError(result.error || 'Connection test failed')
      }
    } catch (err) {
      console.error('Failed to test connection:', err)
      setTestStatus('error')
      setError('Failed to test connection')
    }
  }

  const handleSave = async () => {
    if (!window.electronAPI?.setViewerConfig) return

    setIsLoading(true)
    setError(null)

    try {
      const config: ViewerConfig = {
        type: viewerType,
        craftUrl: viewerType === 'craft-hosted' ? craftUrl : undefined,
        selfHostedUrl: viewerType === 'self-hosted' ? selfHostedUrl : undefined,
        staticExportPath: viewerType === 'static-export' ? staticExportPath : undefined,
        staticUploadCommand: viewerType === 'static-export' ? staticUploadCommand : undefined,
      }

      const result = await window.electronAPI.setViewerConfig(config)

      if (result.success) {
        // Show success feedback
        setTestStatus('success')
        setTimeout(() => setTestStatus('idle'), 2000)
      } else {
        setError(result.error || 'Failed to save settings')
      }
    } catch (err) {
      console.error('Failed to save viewer config:', err)
      setError('Failed to save settings')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <SettingsSection
      title="Session Sharing"
      description="Configure where shared sessions are hosted"
    >
      <SettingsRadioGroup value={viewerType} onValueChange={setViewerType}>
        <SettingsRadioCard
          value="craft-hosted"
          label="Craft Hosted (Default)"
          description="Uses agents.craft.do - no setup required"
          icon={<Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          expandedContent={
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Custom URL (Optional)</Label>
                <Input
                  value={craftUrl}
                  onChange={(e) => setCraftUrl(e.target.value)}
                  placeholder="https://agents.craft.do"
                  className="mt-1.5 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to use default Craft URL
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestConnection}
                disabled={testStatus === 'checking'}
                className="w-full"
              >
                {testStatus === 'checking' ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-foreground mr-2" />
                    Testing Connection...
                  </>
                ) : testStatus === 'success' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600 dark:text-green-400" />
                    Connection Successful
                  </>
                ) : testStatus === 'error' ? (
                  <>
                    <XCircle className="w-4 h-4 mr-2 text-red-600 dark:text-red-400" />
                    Connection Failed
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
            </div>
          }
        />

        <SettingsRadioCard
          value="static-export"
          label="Static Export"
          description="Generate HTML files for any static host"
          icon={<Upload className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
          expandedContent={
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Export Path</Label>
                <Input
                  value={staticExportPath}
                  onChange={(e) => setStaticExportPath(e.target.value)}
                  placeholder="~/exports/sessions"
                  className="mt-1.5 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Local directory for exported HTML files
                </p>
              </div>
              <div>
                <Label className="text-xs">Upload Command (Optional)</Label>
                <Input
                  value={staticUploadCommand}
                  onChange={(e) => setStaticUploadCommand(e.target.value)}
                  placeholder="aws s3 sync {path} s3://bucket"
                  className="mt-1.5 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Command to upload files after export (use {'{path}'} placeholder)
                </p>
              </div>
            </div>
          }
        />
      </SettingsRadioGroup>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      <SettingsCard divided={false}>
        <div className="p-4">
          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </div>
      </SettingsCard>

      {/* How it works */}
      <SettingsCard>
        <div className="p-4 space-y-3">
          <h4 className="text-sm font-medium">How Session Sharing Works</h4>
          <ul className="text-xs text-muted-foreground space-y-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">Craft Hosted:</strong> Zero-config sharing via agents.craft.do with automatic uploads
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">Static Export:</strong> Generate self-contained HTML files for S3, Netlify, or GitHub Pages
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">Privacy First:</strong> All viewer backends are read-only and respect your data preferences
              </span>
            </li>
          </ul>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
