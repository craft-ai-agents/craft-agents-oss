import { useState, useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { useTranslation } from "react-i18next"

interface AddWorkspaceStep_OpenFolderProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_OpenFolder - Open an existing folder as workspace
 */
export function AddWorkspaceStep_OpenFolder({
  onBack,
  onCreate,
  isCreating
}: AddWorkspaceStep_OpenFolderProps) {
  const { t } = useTranslation(['settings'])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')

  const handleBrowse = useCallback(async () => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setSelectedPath(path)
      // Extract folder name for workspace name
      const folderName = path.split(/[\\/]/).pop() || path
      setWorkspaceName(folderName)
    }
  }, [])

  const handleOpen = useCallback(async () => {
    if (!selectedPath || !workspaceName.trim()) return
    await onCreate(selectedPath, workspaceName.trim())
  }, [selectedPath, workspaceName, onCreate])

  const canOpen = selectedPath && workspaceName.trim()

  return (
    <AddWorkspaceContainer>
      {/* Back button */}
        <button
          type="button"
          onClick={onBack}
          disabled={isCreating}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          isCreating && "opacity-50 cursor-not-allowed"
        )}
      >
          <ArrowLeft className="h-4 w-4" />
          {t('settings:workspace.add.back')}
        </button>

      <AddWorkspaceStepHeader
        title={t('settings:workspace.add.openTitle')}
        description={t('settings:workspace.add.openDescriptionTitle')}
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
              <p className="text-sm text-muted-foreground">{t('settings:workspace.add.noFolderSelected')}</p>
            )}
          </div>
          <AddWorkspaceSecondaryButton
            onClick={handleBrowse}
            disabled={isCreating}
          >
            {t('settings:workspace.add.browse')}
          </AddWorkspaceSecondaryButton>
        </div>

        {/* Workspace name input - shown after folder is selected */}
        {selectedPath && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="workspace-open-name">
              {t('settings:workspace.add.nameLabel')}
            </label>
            <Input
              id="workspace-open-name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder={t('settings:workspace.add.placeholder')}
              disabled={isCreating}
            />
          </div>
        )}

        {/* Open button */}
        <AddWorkspacePrimaryButton
          onClick={handleOpen}
          disabled={!canOpen || isCreating}
          loading={isCreating}
          loadingText={t('settings:workspace.add.opening')}
        >
          {t('settings:workspace.add.openAction')}
        </AddWorkspacePrimaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}
