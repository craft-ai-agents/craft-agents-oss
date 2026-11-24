import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Cloud, Folder } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { WorkspaceAvatar } from "@/components/ui/workspace-avatar"
import { useRegisterModal } from "@/context/ModalContext"
import { PATH_SEP, getFileManagerName } from "@/lib/platform"
import type { Workspace } from "../../../shared/types"

interface RemoveWorkspaceDialogProps {
  /** Workspace to remove; null closes the dialog. */
  workspace: Workspace | null
  iconUrl?: string
  onClose: () => void
  onRemoved?: () => void
}

/**
 * Confirmation before the workspace switcher removes a workspace. Removing only drops it from the
 * app's list (`removeWorkspace`): a local workspace's folder, sessions and settings stay on disk,
 * a remote one is untouched on its server, so the dialog shows where it lives and how to add it
 * back. Cancel has focus, so Enter never removes by accident.
 */
export function RemoveWorkspaceDialog({ workspace, iconUrl, onClose, onRemoved }: RemoveWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState(false)
  const [homeDir, setHomeDir] = useState("")
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Keep the last workspace on screen while the dialog animates out
  const lastWorkspace = useRef<Workspace | null>(null)
  if (workspace) lastWorkspace.current = workspace
  const shown = workspace ?? lastWorkspace.current
  const open = workspace !== null

  useRegisterModal(open, onClose)

  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir).catch(() => {})
  }, [])

  if (!shown) return null
  const remoteHost = shown.remoteServer ? hostOf(shown.remoteServer.url) : null

  const handleRemove = async () => {
    setRemoving(true)
    try {
      if (await window.electronAPI.removeWorkspace(shown.id)) {
        toast.success(t("toast.removedWorkspace", { name: shown.name }))
        onRemoved?.()
        onClose()
      } else {
        toast.error(t("toast.removeWorkspaceFailed", { name: shown.name }))
      }
    } catch {
      toast.error(t("toast.removeWorkspaceFailed", { name: shown.name }))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !removing) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="gap-4 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader className="flex-row items-center gap-3 text-left sm:text-left">
          <WorkspaceAvatar
            workspaceId={shown.id}
            workspaceName={shown.name}
            src={iconUrl}
            className="size-10 shrink-0 rounded-lg shadow-elev-1"
            fallbackClassName="rounded-lg text-label font-semibold"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="line-clamp-2 break-words" title={shown.name}>
              {t("dialog.removeWorkspace.title", { name: shown.name })}
            </DialogTitle>
            <DialogDescription>
              {t(remoteHost ? "dialog.removeWorkspace.descriptionRemote" : "dialog.removeWorkspace.descriptionLocal")}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-2.5 rounded-lg bg-sunken py-2 pl-3 pr-1.5">
          {remoteHost
            ? <Cloud className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
            : <Folder className="size-4 shrink-0 text-tertiary" aria-hidden="true" />}
          <span
            className="min-w-0 flex-1 select-text py-0.5 font-mono text-mono-ui text-secondary [overflow-wrap:anywhere]"
            title={remoteHost ?? shown.rootPath}
          >
            {remoteHost ?? breakAfterSeparators(withTilde(shown.rootPath, homeDir))}
          </span>
          {!remoteHost && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-secondary"
              onClick={() => window.electronAPI.showInFolder(shown.rootPath)}
            >
              {t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() })}
            </Button>
          )}
        </div>

        <p className="text-label-sm text-tertiary">
          {remoteHost
            ? t("dialog.removeWorkspace.reopenRemote")
            : t("dialog.removeWorkspace.reopenLocal", {
                addWorkspace: t("workspace.addWorkspace"),
                openFolder: t("workspace.openFolder"),
              })}
        </p>

        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={removing}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={handleRemove} disabled={removing}>
            {t("common.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** `~/…` for paths in the home folder. */
function withTilde(path: string, homeDir: string): string {
  return homeDir && path.startsWith(homeDir + PATH_SEP) ? `~${path.slice(homeDir.length)}` : path
}

/** Lets a long path wrap after `/` rather than mid-name (each separator gets a <wbr>). */
function breakAfterSeparators(path: string): ReactNode[] {
  return path.split(PATH_SEP).flatMap((part, i) => (i === 0 ? [part] : [PATH_SEP, <wbr key={i} />, part]))
}

/** host[:port] of a ws(s):// URL; the raw string if it doesn't parse. Never shows the token. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
