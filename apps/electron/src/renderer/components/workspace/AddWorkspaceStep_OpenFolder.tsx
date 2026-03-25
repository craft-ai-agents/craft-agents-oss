import { useState, useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import type { RemoteServerProfile, WorkspaceCreationTarget } from "../../../shared/types"
import { WorkspaceTargetSelector } from "./WorkspaceTargetSelector"

interface AddWorkspaceStep_OpenFolderProps {
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
 * AddWorkspaceStep_OpenFolder - Open an existing folder as workspace
 */
export function AddWorkspaceStep_OpenFolder({
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
}: AddWorkspaceStep_OpenFolderProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')

  const handleFolderSelected = useCallback((path: string) => {
    setSelectedPath(path)
    // Extract folder name for workspace name
    const folderName = path.split(/[\\/]/).pop() || path
    setWorkspaceName(folderName)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected, target)

  const handleOpen = useCallback(async () => {
    if (!selectedPath || !workspaceName.trim()) return
    await onCreate(selectedPath, workspaceName.trim(), { managedByApp: false })
  }, [selectedPath, workspaceName, onCreate])

  const canOpen = selectedPath && workspaceName.trim()

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
        title="Choose existing folder"
        className="mt-6"
        description="Choose any folder to use as workspace."
      />

      <div className="mt-6 w-full space-y-6">
        {/* Browse folder row */}
        <div
          className={cn(
            "flex items-center justify-between gap-4 p-4 rounded-xl",
            "border border-border/50 bg-background"
          )}
        >
          <div className="flex-1 min-w-0">
            {selectedPath ? (
              <p className="text-sm text-foreground truncate">{selectedPath}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No folder selected</p>
            )}
          </div>
          <AddWorkspaceSecondaryButton
            onClick={pickDirectory}
            disabled={isCreating || !target}
          >
            Browse
          </AddWorkspaceSecondaryButton>
        </div>
        {!target && (
          <p className="text-xs text-muted-foreground">Select a target above before browsing folders.</p>
        )}
        {showServerBrowser && (
          <ServerDirectoryBrowser
            open={showServerBrowser}
            presentation="inline"
            mode={serverBrowserMode}
            onSelect={confirmServerBrowser}
            onCancel={cancelServerBrowser}
            initialPath={selectedPath ?? undefined}
            target={target}
          />
        )}

        {/* Workspace name input - shown after folder is selected */}
        {selectedPath && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Workspace name
            </label>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="My Workspace"
              disabled={isCreating}
            />
          </div>
        )}

        {/* Open button */}
        <AddWorkspacePrimaryButton
          onClick={handleOpen}
          disabled={!canOpen || isCreating}
          loading={isCreating}
          loadingText="Opening..."
        >
          Open
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
