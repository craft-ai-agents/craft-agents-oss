import * as React from 'react'
import { Eraser, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AssetThumbnail, formatBytes } from './NoteInspector'
import type { NoteAsset, NoteChangedPayload, NoteDocument, NoteRenameImpact, NoteSummary } from '../../../shared/types'

export type NoteFolderGroup = {
  folder: string
  notes: NoteSummary[]
}

export interface NotesDialogsProps {
  // Create note
  createDialogOpen: boolean
  createTitle: string
  createInFolder: string | undefined
  onCreateDialogOpenChange(open: boolean): void
  onCreateTitleChange(v: string): void
  onCreateNote(): void

  // Create folder
  createFolderDialogOpen: boolean
  createFolderName: string
  onCreateFolderDialogOpenChange(open: boolean): void
  onCreateFolderNameChange(v: string): void
  onCreateFolder(): void

  // Move note
  moveDialogOpen: boolean
  moveTargetNote: NoteSummary | null
  moveFolderName: string
  onMoveDialogOpenChange(open: boolean): void
  onMoveFolderNameChange(v: string): void
  onMoveNote(): void

  // Rename note
  renameDialogOpen: boolean
  renameTitle: string
  renameImpact: NoteRenameImpact | null
  activeNote: NoteDocument | null
  onRenameDialogOpenChange(open: boolean): void
  onRenameTitleChange(v: string): void
  onRenameNote(): void

  // Delete note
  deleteDialogOpen: boolean
  onDeleteDialogOpenChange(open: boolean): void
  onDeleteNote(): void

  // External change — now handled as toast in NotesPage; these props are kept for backward compat but ignored
  externalChange?: NoteChangedPayload | null
  onDismissExternalChange?(): void
  onReloadNote?(): void

  // Missing link
  missingLinkTarget: string | null
  onDismissMissingLink(): void
  onCreateMissingLink(): void

  // Assets dialog
  assetDialogOpen: boolean
  allAssets: NoteAsset[]
  orphanAssets: NoteAsset[]
  assetBusy: boolean
  onAssetDialogOpenChange(open: boolean): void
  onImportAsset(): void
  onCleanUnusedAssets(): void
  onOpenFile(path: string): void
  onOpenAssetRenameDialog(asset: NoteAsset): void
  onDeleteAsset(asset: NoteAsset): void

  // Asset rename
  assetRenameTarget: NoteAsset | null
  assetRenameName: string
  onAssetRenameTargetChange(asset: NoteAsset | null): void
  onAssetRenameNameChange(v: string): void
  onRenameAsset(): void

  // Rename folder
  renameFolderDialogOpen: boolean
  renameFolderTarget: string
  renameFolderName: string
  onRenameFolderDialogOpenChange(open: boolean): void
  onRenameFolderNameChange(v: string): void
  onRenameFolder(): void

  // Delete folder
  deleteFolderDialogOpen: boolean
  deleteFolderTarget: string
  deleteFolderNoteCount: number
  onDeleteFolderDialogOpenChange(open: boolean): void
  onDeleteFolder(): void
}

export function NotesDialogs({
  createDialogOpen, createTitle, createInFolder,
  onCreateDialogOpenChange, onCreateTitleChange, onCreateNote,
  createFolderDialogOpen, createFolderName,
  onCreateFolderDialogOpenChange, onCreateFolderNameChange, onCreateFolder,
  moveDialogOpen, moveTargetNote, moveFolderName,
  onMoveDialogOpenChange, onMoveFolderNameChange, onMoveNote,
  renameDialogOpen, renameTitle, renameImpact, activeNote,
  onRenameDialogOpenChange, onRenameTitleChange, onRenameNote,
  deleteDialogOpen, onDeleteDialogOpenChange, onDeleteNote,
  externalChange, onDismissExternalChange, onReloadNote,
  missingLinkTarget, onDismissMissingLink, onCreateMissingLink,
  assetDialogOpen, allAssets, orphanAssets, assetBusy,
  onAssetDialogOpenChange, onImportAsset, onCleanUnusedAssets, onOpenFile,
  onOpenAssetRenameDialog, onDeleteAsset,
  assetRenameTarget, assetRenameName,
  onAssetRenameTargetChange, onAssetRenameNameChange, onRenameAsset,
  renameFolderDialogOpen, renameFolderTarget, renameFolderName,
  onRenameFolderDialogOpenChange, onRenameFolderNameChange, onRenameFolder,
  deleteFolderDialogOpen, deleteFolderTarget, deleteFolderNoteCount,
  onDeleteFolderDialogOpenChange, onDeleteFolder,
}: NotesDialogsProps) {
  return (
    <>
      <RenameDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          onCreateDialogOpenChange(open)
          if (!open) onCreateTitleChange('')
        }}
        title={createInFolder ? `New note in ${createInFolder}` : 'New note'}
        value={createTitle}
        onValueChange={onCreateTitleChange}
        onSubmit={onCreateNote}
        placeholder="Note title"
      />
      <RenameDialog
        open={createFolderDialogOpen}
        onOpenChange={onCreateFolderDialogOpenChange}
        title="New folder"
        value={createFolderName}
        onValueChange={onCreateFolderNameChange}
        onSubmit={onCreateFolder}
        placeholder="Folder name"
      />
      <Dialog open={moveDialogOpen} onOpenChange={onMoveDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move note</DialogTitle>
            <DialogDescription>
              Move "{moveTargetNote?.title}" to a folder. Leave blank for the vault root.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={moveFolderName}
            onChange={(e) => onMoveFolderNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onMoveNote() }}
            placeholder="folder/subfolder"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onMoveDialogOpenChange(false)}>Cancel</Button>
            <Button onClick={onMoveNote}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renameDialogOpen} onOpenChange={onRenameDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename note</DialogTitle>
            <DialogDescription>
              Rename the markdown file and update any matching wiki links.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameTitle}
              onChange={(e) => onRenameTitleChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onRenameNote() }}
              placeholder="Note title"
            />
            <div className="rounded-[6px] border border-border/60 p-2 text-xs">
              <div className="mb-1 text-muted-foreground">
                {renameImpact
                  ? `Will update ${renameImpact.totalReplacements} link${renameImpact.totalReplacements === 1 ? '' : 's'} across ${renameImpact.updatedNotes.length} note${renameImpact.updatedNotes.length === 1 ? '' : 's'}.`
                  : 'No matching links found yet.'}
              </div>
              {renameImpact?.updatedNotes.length ? (
                <div className="max-h-36 overflow-y-auto">
                  {renameImpact.updatedNotes.map(note => (
                    <div key={note.noteId} className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0 flex-1 truncate">{note.title}</span>
                      <span className="text-muted-foreground">{note.replacements}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onRenameDialogOpenChange(false)}>Cancel</Button>
            <Button onClick={onRenameNote} disabled={!renameTitle.trim() || renameTitle.trim() === activeNote?.title}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDialogOpen} onOpenChange={onDeleteDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete note</DialogTitle>
            <DialogDescription>
              Delete "{activeNote?.title}" from {activeNote?.relativePath}? This note has {activeNote?.backlinks.length ?? 0} backlink{activeNote?.backlinks.length === 1 ? '' : 's'}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteDialogOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" onClick={onDeleteNote}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!missingLinkTarget} onOpenChange={(open) => { if (!open) onDismissMissingLink() }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Create linked note</DialogTitle>
            <DialogDescription>
              Create "{missingLinkTarget}" and open it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onDismissMissingLink}>Cancel</Button>
            <Button onClick={onCreateMissingLink}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={assetDialogOpen} onOpenChange={onAssetDialogOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Assets</DialogTitle>
            <DialogDescription>
              Manage files under notes/assets. Referenced assets are protected from deletion.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {allAssets.length} asset{allAssets.length === 1 ? '' : 's'} · {orphanAssets.length} unused
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={onImportAsset} disabled={assetBusy}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={onCleanUnusedAssets} disabled={assetBusy || orphanAssets.length === 0}>
                <Eraser className="mr-1.5 h-3.5 w-3.5" />
                Clean unused
              </Button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-[7px] border border-border/60">
            {allAssets.length ? allAssets.map(asset => {
              const refCount = asset.referencedBy?.length ?? 0
              const refLabel = asset.referencedBy?.slice(0, 2).map(ref => ref.title).join(', ')
              return (
                <div key={asset.relativePath} className="flex items-center gap-3 border-b border-border/50 px-3 py-2 last:border-b-0">
                  <AssetThumbnail asset={asset} size="md" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpenFile(asset.path)}>
                    <div className="truncate text-xs font-medium">{asset.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {asset.relativePath} · {formatBytes(asset.size)} · {refCount ? `used by ${refLabel}${refCount > 2 ? ` +${refCount - 2}` : ''}` : 'unused'}
                    </div>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => onOpenAssetRenameDialog(asset)} disabled={assetBusy}>Rename</Button>
                  <Button variant="ghost" size="sm" onClick={() => onDeleteAsset(asset)} disabled={assetBusy || refCount > 0}>Delete</Button>
                </div>
              )
            }) : (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground">No assets yet</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onAssetDialogOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!assetRenameTarget} onOpenChange={(open) => { if (!open) onAssetRenameTargetChange(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename asset</DialogTitle>
            <DialogDescription>
              Rename the asset file and update markdown references that point to it.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={assetRenameName}
            onChange={(e) => onAssetRenameNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onRenameAsset() }}
            placeholder="Asset filename"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onAssetRenameTargetChange(null)}>Cancel</Button>
            <Button onClick={onRenameAsset} disabled={assetBusy || !assetRenameName.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RenameDialog
        open={renameFolderDialogOpen}
        onOpenChange={onRenameFolderDialogOpenChange}
        title={`Rename folder "${renameFolderTarget}"`}
        value={renameFolderName}
        onValueChange={onRenameFolderNameChange}
        onSubmit={onRenameFolder}
        placeholder="Folder name"
      />
      <Dialog open={deleteFolderDialogOpen} onOpenChange={onDeleteFolderDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete folder</DialogTitle>
            <DialogDescription>
            Delete folder "{deleteFolderTarget}" and all {deleteFolderNoteCount} note{deleteFolderNoteCount === 1 ? '' : 's'} inside? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteFolderDialogOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" onClick={onDeleteFolder}>Delete folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
