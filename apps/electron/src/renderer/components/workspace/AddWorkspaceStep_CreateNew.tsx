import { useState, useEffect, useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import type { RemoteServerProfile, WorkspaceCreationTarget } from "../../../shared/types"
import { WorkspaceTargetSelector } from "./WorkspaceTargetSelector"

type LocationOption = 'default' | 'custom'

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, options?: { managedByApp?: boolean }) => Promise<void>
  isCreating: boolean
  targetMode: 'local' | 'remote'
  target: WorkspaceCreationTarget | null
  onTargetModeChange: (mode: 'local' | 'remote') => void
  remoteServers: RemoteServerProfile[]
  selectedServerId: string | null
  onSelectedServerIdChange: (serverId: string | null) => void
  allowLocalTarget?: boolean
  connectedRemoteName?: string | null
  connectedRemoteUrl?: string | null
}

/**
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default (~/.craft-agent/workspaces/) or Custom
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating,
  targetMode,
  target,
  onTargetModeChange,
  remoteServers,
  selectedServerId,
  onSelectedServerIdChange,
  allowLocalTarget = true,
  connectedRemoteName,
  connectedRemoteUrl,
}: AddWorkspaceStep_CreateNewProps) {
  const [name, setName] = useState('')
  const [locationOption, setLocationOption] = useState<LocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Get home directory on mount
  useEffect(() => {
    if (!target) {
      setHomeDir('')
      return
    }
    window.electronAPI.getHomeDirForTarget(target).then(setHomeDir).catch(() => setHomeDir(''))
  }, [target])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : null
  const finalPath = locationOption === 'default'
    ? (defaultBasePath && slug ? `${defaultBasePath}/${slug}` : null)
    : customPath && slug
      ? `${customPath}/${slug}`
      : null

  // Validate slug uniqueness when name changes
  useEffect(() => {
    if (!slug) {
      setError(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = target
          ? await window.electronAPI.checkWorkspaceSlugAtTarget(target, slug)
          : await window.electronAPI.checkWorkspaceSlug(slug)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
      } finally {
        setIsValidating(false)
      }
    }

    // Debounce validation
    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug, target])

  const handleFolderSelected = useCallback((path: string) => {
    setCustomPath(path)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected, target)

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error) return
    await onCreate(finalPath, name.trim(), { managedByApp: locationOption === 'default' })
  }, [name, finalPath, error, onCreate, locationOption])

  const canCreate = !!target && !!name.trim() && !!finalPath && !error && !isValidating && !isCreating

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

      <WorkspaceTargetSelector
        targetMode={targetMode}
        onTargetModeChange={onTargetModeChange}
        remoteServers={remoteServers}
        selectedServerId={selectedServerId}
        onSelectedServerIdChange={onSelectedServerIdChange}
        allowLocalTarget={allowLocalTarget}
        connectedRemoteName={connectedRemoteName}
        connectedRemoteUrl={connectedRemoteUrl}
        disabled={isCreating}
      />

      <AddWorkspaceStepHeader
        title="Create workspace"
        className="mt-6"
        description="Enter a name and choose where to store your workspace."
      />

      <div className="mt-6 w-full space-y-6">
        {/* Workspace name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            Workspace name
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Location selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            Location
          </label>

          {/* Default location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'default'}
            onChange={() => setLocationOption('default')}
            disabled={isCreating}
            title="Default location"
            subtitle={targetMode === 'remote' ? "under the selected server's .craft-agent folder" : "under .craft-agent folder"}
          />

          {/* Custom location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'custom'}
            onChange={() => setLocationOption('custom')}
            disabled={isCreating}
            title="Choose a location"
            subtitle={customPath || "Pick a place to put your new workspace."}
            action={locationOption === 'custom' ? (
              <AddWorkspaceSecondaryButton
                onClick={(e) => {
                  e.preventDefault()
                  pickDirectory()
                }}
                disabled={isCreating || !target}
              >
                Browse
              </AddWorkspaceSecondaryButton>
            ) : undefined}
          />
          {!target && (
            <p className="text-xs text-muted-foreground">
              Select a target above before choosing a location.
            </p>
          )}
          {showServerBrowser && (
            <ServerDirectoryBrowser
              open={showServerBrowser}
              presentation="inline"
              mode={serverBrowserMode}
              onSelect={confirmServerBrowser}
              onCancel={cancelServerBrowser}
              initialPath={customPath ?? undefined}
              target={target}
            />
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
