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
 * Flow: URL + Token → Test Connection → Name (required for fresh servers, optional override otherwise) → Create
 * If the remote server has no workspace, one is created with the user's chosen name.
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
  const [remoteWorkspaceName, setRemoteWorkspaceName] = useState<string | null>(null)
  const [needsWorkspace, setNeedsWorkspace] = useState(false)
  const [slugError, setSlugError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  // Effective name: user input, or remote workspace name as fallback (only when workspace exists)
  const effectiveName = name.trim() || (!needsWorkspace ? remoteWorkspaceName : null) || ''
  const slug = slugify(effectiveName)
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
    setRemoteWorkspaceName(null)
    setNeedsWorkspace(false)
  }, [serverUrl, token])

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl || !token) return
    setTestState('testing')
    setTestError(null)
    try {
      const result = await window.electronAPI.testRemoteConnection(serverUrl, token)
      if (result.ok) {
        setTestState('ok')
        if (result.needsWorkspace) {
          setNeedsWorkspace(true)
          setRemoteWorkspaceId(null)
          setRemoteWorkspaceName(null)
        } else {
          setNeedsWorkspace(false)
          setRemoteWorkspaceId(result.remoteWorkspaceId ?? null)
          setRemoteWorkspaceName(result.remoteWorkspaceName ?? null)
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
    if (!effectiveName || !finalPath || !serverUrl || !token || slugError) return

    let wsId = remoteWorkspaceId

    // If the remote server needs a workspace, call testRemoteConnection again with the name
    // to create one on the remote server
    if (needsWorkspace && !wsId) {
      const result = await window.electronAPI.testRemoteConnection(serverUrl, token, effectiveName)
      if (!result.ok || !result.remoteWorkspaceId) {
        setTestState('error')
        setTestError(result.error || 'Failed to create workspace on remote server')
        return
      }
      wsId = result.remoteWorkspaceId
    }

    if (!wsId) return
    await onCreate(finalPath, effectiveName, { url: serverUrl, token, remoteWorkspaceId: wsId })
  }, [effectiveName, finalPath, serverUrl, token, remoteWorkspaceId, needsWorkspace, slugError, onCreate])

  // For fresh servers: name is required. For existing: name is optional (defaults to remote name).
  const hasValidName = needsWorkspace ? !!name.trim() : !!effectiveName
  const canCreate = hasValidName && finalPath && serverUrl && token && testState === 'ok' && !slugError && !isCreating

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
              autoFocus
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
          {testState === 'ok' && !needsWorkspace && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected{remoteWorkspaceName ? ` — ${remoteWorkspaceName}` : ''}
            </span>
          )}
          {testState === 'ok' && needsWorkspace && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="h-3.5 w-3.5" />
              Connected — new server
            </span>
          )}
          {testState === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {testError || 'Failed'}
            </span>
          )}
        </div>

        {/* Workspace name — shown after successful test */}
        {testState === 'ok' && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              Workspace name
              {!needsWorkspace && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
              )}
            </label>
            <div className="bg-background shadow-minimal rounded-lg">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={needsWorkspace ? 'My Remote Workspace' : (remoteWorkspaceName || 'Remote Workspace')}
                disabled={isCreating}
                className="border-0 bg-transparent shadow-none"
              />
            </div>
            {needsWorkspace && !name.trim() && (
              <p className="text-xs text-muted-foreground">A workspace will be created on the remote server with this name.</p>
            )}
            {slugError && (
              <p className="text-xs text-destructive">{slugError}</p>
            )}
          </div>
        )}

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
