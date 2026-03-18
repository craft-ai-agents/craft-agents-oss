import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspacePrimaryButton, AddWorkspaceSecondaryButton } from "./primitives"

interface AddWorkspaceStep_ConnectRemoteProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_ConnectRemote - Connect to a remote Craft Agent Server
 *
 * Fields:
 * - Workspace name (required)
 * - Server URL (ws:// or wss://)
 * - Token (password field)
 * - Test Connection button
 */
export function AddWorkspaceStep_ConnectRemote({
  onBack,
  onCreate,
  isCreating,
}: AddWorkspaceStep_ConnectRemoteProps) {
  const [name, setName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [token, setToken] = useState('')
  const [homeDir, setHomeDir] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [remoteWorkspaceId, setRemoteWorkspaceId] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : '~/.craft-agent/workspaces'
  const finalPath = slug ? `${defaultBasePath}/${slug}` : null

  // Validate slug uniqueness
  useEffect(() => {
    if (!slug) {
      setSlugError(null)
      return
    }

    const validateSlug = async () => {
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug)
        if (result.exists) {
          setSlugError(`A workspace named "${slug}" already exists`)
        } else {
          setSlugError(null)
        }
      } catch {
        // ignore
      }
    }

    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug])

  // Reset test state when URL or token changes
  useEffect(() => {
    setTestState('idle')
    setTestError(null)
    setRemoteWorkspaceId(null)
  }, [serverUrl, token])

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl || !token) return
    setTestState('testing')
    setTestError(null)
    try {
      const result = await window.electronAPI.testRemoteConnection(serverUrl, token)
      if (result.ok) {
        setTestState('ok')
        setRemoteWorkspaceId(result.remoteWorkspaceId ?? null)
        // Auto-fill name from remote workspace if user hasn't entered one
        if (!name.trim() && result.remoteWorkspaceName) {
          setName(result.remoteWorkspaceName)
        }
      } else {
        setTestState('error')
        setTestError(result.error || 'Connection failed')
      }
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [serverUrl, token])

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || !serverUrl || !token || !remoteWorkspaceId || slugError) return
    await onCreate(finalPath, name.trim(), { url: serverUrl, token, remoteWorkspaceId })
  }, [name, finalPath, serverUrl, token, remoteWorkspaceId, slugError, onCreate])

  const canCreate = name.trim() && finalPath && serverUrl && token && remoteWorkspaceId && !slugError && !isCreating

  return (
    <AddWorkspaceContainer>
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={isCreating}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          isCreating && "opacity-50 cursor-not-allowed"
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <AddWorkspaceStepHeader
        title="Connect to remote server"
        description="Connect to a remote Craft Agent Server for this workspace."
      />

      <div className="mt-6 w-full space-y-5">
        {/* Workspace name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Workspace name
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Remote Workspace"
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {slugError && (
            <p className="text-xs text-destructive">{slugError}</p>
          )}
        </div>

        {/* Server URL */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Server URL
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://192.168.1.100:3001"
              disabled={isCreating}
              className="border-0 bg-transparent shadow-none font-mono text-sm"
            />
          </div>
        </div>

        {/* Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Token
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Server authentication token"
              disabled={isCreating}
              className="border-0 bg-transparent shadow-none"
            />
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <AddWorkspaceSecondaryButton
            onClick={handleTestConnection}
            disabled={!serverUrl || !token || testState === 'testing' || isCreating}
          >
            {testState === 'testing' ? 'Testing...' : 'Test Connection'}
          </AddWorkspaceSecondaryButton>
          {testState === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected
            </span>
          )}
          {testState === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {testError || 'Failed'}
            </span>
          )}
        </div>

        {/* Create button */}
        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText="Creating..."
        >
          Create
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
