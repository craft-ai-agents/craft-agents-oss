/**
 * ServerSettingsPage
 *
 * Configure the Electron app to act as a remote server,
 * accessible from other machines on the network.
 */

import { useState, useEffect, useCallback } from 'react'
import { Copy, Eye, EyeOff, AlertTriangle, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ServerConfig, ServerStatus } from '@craft-agent/shared/config/server-config'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInputRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'server',
}

interface ServerFormState {
  enabled: boolean
  port: string
  tlsCertPath: string
  tlsKeyPath: string
  token: string
}

function configToForm(config: ServerConfig): ServerFormState {
  return {
    enabled: config.enabled,
    port: String(config.port),
    tlsCertPath: config.tlsCertPath ?? '',
    tlsKeyPath: config.tlsKeyPath ?? '',
    token: config.token ?? '',
  }
}

function formToConfig(form: ServerFormState): ServerConfig {
  return {
    enabled: form.enabled,
    port: parseInt(form.port, 10) || 9100,
    tlsCertPath: form.tlsCertPath.trim() || undefined,
    tlsKeyPath: form.tlsKeyPath.trim() || undefined,
    token: form.token || undefined,
  }
}

export default function ServerSettingsPage() {
  const [form, setForm] = useState<ServerFormState>({
    enabled: false,
    port: '9100',
    tlsCertPath: '',
    tlsKeyPath: '',
    token: '',
  })
  const [savedForm, setSavedForm] = useState<ServerFormState>(form)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [error, setError] = useState<string>()

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const loadSettings = useCallback(async () => {
    try {
      const [config, serverStatus] = await Promise.all([
        window.electronAPI.getServerConfig(),
        window.electronAPI.getServerStatus(),
      ])
      const formState = configToForm(config)
      setForm(formState)
      setSavedForm(formState)
      setStatus(serverStatus)
    } catch (err) {
      console.error('Failed to load server settings:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    setError(undefined)
    const port = parseInt(form.port, 10)
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError('Port must be between 1024 and 65535')
      return
    }
    if (form.tlsCertPath && !form.tlsKeyPath) {
      setError('Private key is required when a certificate is provided')
      return
    }
    if (form.tlsKeyPath && !form.tlsCertPath) {
      setError('Certificate is required when a private key is provided')
      return
    }

    setIsSaving(true)
    try {
      await window.electronAPI.setServerConfig(formToConfig(form))
      setSavedForm(form)
      const newStatus = await window.electronAPI.getServerStatus()
      setStatus(newStatus)
      toast.success('Server settings saved')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(`Failed to save: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setForm(savedForm)
    setError(undefined)
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard`)
  }

  const handleBrowseCert = async () => {
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsCertPath: paths[0]! }))
    }
  }

  const handleBrowseKey = async () => {
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsKeyPath: paths[0]! }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    )
  }

  const hasTls = !!(form.tlsCertPath && form.tlsKeyPath)
  const needsRestart = status?.needsRestart ?? false
  const showServerDetails = form.enabled || savedForm.enabled

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Server" />
      <ScrollArea className="flex-1">
        <div className="px-5 py-7 max-w-3xl mx-auto space-y-5">

          {/* Enable toggle + restart banner */}
          <SettingsSection title="Remote Access">
            <SettingsCard>
              <SettingsToggle
                label="Enable Server Mode"
                description="Allow connections from other machines on the network."
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm(f => ({ ...f, enabled }))}
              />
            </SettingsCard>

            {needsRestart && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
                <RotateCw className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Restart required to apply changes</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => window.electronAPI.relaunchApp()}
                >
                  Restart Now
                </Button>
              </div>
            )}
          </SettingsSection>

          {/* Connection + TLS — only visible when server mode is relevant */}
          {showServerDetails && (
            <SettingsSection title="Connection">
              <SettingsCard>
                <SettingsInputRow
                  label="Port"
                  value={form.port}
                  onChange={(port) => setForm(f => ({ ...f, port }))}
                  placeholder="9100"
                />

                {status && form.enabled && (
                  <>
                    <SettingsRow label="URL">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {status.url}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(status.url, 'URL')}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </SettingsRow>

                    <SettingsRow label="Token">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded max-w-[180px] truncate">
                          {tokenVisible ? status.token : '••••••••••••••••'}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setTokenVisible(v => !v)}>
                          {tokenVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(status.token, 'Token')}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </SettingsRow>
                  </>
                )}

                <SettingsRow label="Certificate">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {form.tlsCertPath || 'Not configured'}
                    </span>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={handleBrowseCert}>
                      Browse
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow label="Private Key">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {form.tlsKeyPath || 'Not configured'}
                    </span>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={handleBrowseKey}>
                      Browse
                    </Button>
                  </div>
                </SettingsRow>
              </SettingsCard>

              {form.enabled && !hasTls && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {status?.insecureWarning
                      ? 'Server is running without TLS. Auth tokens are sent in cleartext.'
                      : 'Without TLS, connections will be unencrypted.'}
                  </span>
                </div>
              )}
            </SettingsSection>
          )}

          {/* Save/Reset */}
          {error && (
            <p className="text-xs text-destructive px-1">{error}</p>
          )}
          {(isDirty || error) && (
            <SettingsCardFooter>
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isSaving}>
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Spinner className="mr-1.5" /> : null}
                Save
              </Button>
            </SettingsCardFooter>
          )}

        </div>
      </ScrollArea>
    </div>
  )
}
