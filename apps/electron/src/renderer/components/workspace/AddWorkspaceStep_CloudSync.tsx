import { useState, useCallback } from "react"
import { ArrowLeft, Cloud, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspacePrimaryButton } from "./primitives"

interface AddWorkspaceStep_CloudSyncProps {
  onBack: () => void
  onConnect: (name: string, remoteUrl: string, apiKey: string) => Promise<void>
  isConnecting: boolean
}

type ValidationState = 'idle' | 'validating' | 'success' | 'error'

/**
 * AddWorkspaceStep_CloudSync - Connect to a cloud workspace
 *
 * Fields:
 * - Workspace Name (becomes the slug / Durable Object identity)
 * - Remote URL (e.g., https://my-craft-cloud.workers.dev)
 * - API Key (validated against the Worker's secret env var)
 *
 * The flow is the same whether the workspace is new or existing on the server.
 * If the slug has no data on the server, the Durable Object auto-creates empty.
 * If it has data, you join the existing workspace.
 */
export function AddWorkspaceStep_CloudSync({
  onBack,
  onConnect,
  isConnecting
}: AddWorkspaceStep_CloudSyncProps) {
  const [name, setName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationState>('idle')

  const slug = slugify(name)

  const handleValidateAndConnect = useCallback(async () => {
    if (!name.trim() || !remoteUrl.trim() || !apiKey.trim()) return

    setError(null)
    setValidation('validating')

    // Normalize URL (strip trailing slash)
    const normalizedUrl = remoteUrl.trim().replace(/\/+$/, '')

    try {
      // Validate connection by hitting the REST endpoint
      const res = await fetch(`${normalizedUrl}/workspace/${slug}/sessions`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      })

      if (res.status === 401) {
        setError('Invalid API key. Check your key and try again.')
        setValidation('error')
        return
      }

      if (!res.ok) {
        setError(`Connection failed: ${res.status} ${res.statusText}`)
        setValidation('error')
        return
      }

      setValidation('success')

      // Validation passed — proceed with workspace creation
      await onConnect(name.trim(), normalizedUrl, apiKey.trim())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message.includes('fetch') || message.includes('network') || message.includes('Failed')) {
        setError('Cannot reach the server. Check the URL and try again.')
      } else {
        setError(message)
      }
      setValidation('error')
    }
  }, [name, remoteUrl, apiKey, slug, onConnect])

  const canConnect = name.trim() && remoteUrl.trim() && apiKey.trim() && !isConnecting

  return (
    <AddWorkspaceContainer>
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={isConnecting}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          isConnecting && "opacity-50 cursor-not-allowed"
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <AddWorkspaceStepHeader
        title="Sync with Cloud"
        description="Connect to a shared cloud workspace. If the workspace doesn't exist yet on the server, it will be created."
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
              onChange={(e) => { setName(e.target.value); setValidation('idle'); setError(null) }}
              placeholder="My Project"
              disabled={isConnecting}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {slug && (
            <p className="text-xs text-muted-foreground">
              Workspace slug: <span className="font-mono">{slug}</span>
            </p>
          )}
        </div>

        {/* Remote URL */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            Remote URL
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={remoteUrl}
              onChange={(e) => { setRemoteUrl(e.target.value); setValidation('idle'); setError(null) }}
              placeholder="https://my-craft-cloud.workers.dev"
              disabled={isConnecting}
              className="border-0 bg-transparent shadow-none font-mono text-sm"
            />
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            API Key
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setValidation('idle'); setError(null) }}
              placeholder="Enter your API key"
              disabled={isConnecting}
              className="border-0 bg-transparent shadow-none"
            />
          </div>
        </div>

        {/* Validation status */}
        {validation === 'validating' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validating connection...
          </div>
        )}
        {validation === 'success' && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Connected successfully
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Connect button */}
        <AddWorkspacePrimaryButton
          onClick={handleValidateAndConnect}
          disabled={!canConnect}
          loading={isConnecting || validation === 'validating'}
          loadingText="Connecting..."
        >
          <Cloud className="h-4 w-4 mr-2" />
          Connect
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
