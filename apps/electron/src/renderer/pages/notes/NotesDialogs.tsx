import * as React from 'react'
import { Eraser, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  return (
    <>
      <RenameDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          onCreateDialogOpenChange(open)
          if (!open) onCreateTitleChange('')
        }}
        title={createInFolder ? t('notes.dialog.newNoteInFolder', { folder: createInFolder }) : t('notes.dialog.newNote')}
        value={createTitle}
        onValueChange={onCreateTitleChange}
        onSubmit={onCreateNote}
        placeholder={t('notes.dialog.noteTitlePlaceholder')}
      />
      <RenameDialog
        open={createFolderDialogOpen}
        onOpenChange={onCreateFolderDialogOpenChange}
        title={t('notes.dialog.newFolder')}
        value={createFolderName}
        onValueChange={onCreateFolderNameChange}
        onSubmit={onCreateFolder}
        placeholder={t('notes.dialog.folderNamePlaceholder')}
      />
      <Dialog open={moveDialogOpen} onOpenChange={onMoveDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.moveNote')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.moveNoteDesc', { title: moveTargetNote?.title ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={moveFolderName}
            onChange={(e) => onMoveFolderNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onMoveNote() }}
            placeholder={t('notes.dialog.folderPathPlaceholder')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onMoveDialogOpenChange(false)}>{t('notes.dialog.cancel')}</Button>
            <Button onClick={onMoveNote}>{t('notes.dialog.move')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renameDialogOpen} onOpenChange={onRenameDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.renameNote')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.renameNoteDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameTitle}
              onChange={(e) => onRenameTitleChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onRenameNote() }}
              placeholder={t('notes.dialog.noteTitlePlaceholder')}
            />
            <div className="rounded-[6px] border border-border/60 p-2 text-xs">
              <div className="mb-1 text-muted-foreground">
                {renameImpact
                  ? t('notes.dialog.renameImpact', {
                      replacements: renameImpact.totalReplacements,
                      notes: renameImpact.updatedNotes.length,
                    })
                  : t('notes.dialog.renameNoLinks')}
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
            <Button variant="outline" onClick={() => onRenameDialogOpenChange(false)}>{t('notes.dialog.cancel')}</Button>
            <Button onClick={onRenameNote} disabled={!renameTitle.trim() || renameTitle.trim() === activeNote?.title}>{t('notes.dialog.rename')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDialogOpen} onOpenChange={onDeleteDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.deleteNote')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.deleteNoteDesc', {
                title: activeNote?.title ?? '',
                path: activeNote?.relativePath ?? '',
                count: activeNote?.backlinks.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteDialogOpenChange(false)}>{t('notes.dialog.cancel')}</Button>
            <Button variant="destructive" onClick={onDeleteNote}>{t('notes.dialog.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!missingLinkTarget} onOpenChange={(open) => { if (!open) onDismissMissingLink() }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.createLinkedNote')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.createLinkedNoteDesc', { title: missingLinkTarget ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onDismissMissingLink}>{t('notes.dialog.cancel')}</Button>
            <Button onClick={onCreateMissingLink}>{t('notes.dialog.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={assetDialogOpen} onOpenChange={onAssetDialogOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.assets')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.assetsDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t('notes.dialog.assetsSummary', {
                total: allAssets.length,
                unused: orphanAssets.length,
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={onImportAsset} disabled={assetBusy}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {t('notes.dialog.import')}
              </Button>
              <Button variant="outline" size="sm" onClick={onCleanUnusedAssets} disabled={assetBusy || orphanAssets.length === 0}>
                <Eraser className="mr-1.5 h-3.5 w-3.5" />
                {t('notes.dialog.cleanUnused')}
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
                      {asset.relativePath} · {formatBytes(asset.size)} · {refCount
                        ? t('notes.dialog.assetUsedBy', {
                            label: `${refLabel}${refCount > 2 ? ` +${refCount - 2}` : ''}`,
                          })
                        : t('notes.dialog.assetUnused')}
                    </div>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => onOpenAssetRenameDialog(asset)} disabled={assetBusy}>{t('notes.dialog.rename')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => onDeleteAsset(asset)} disabled={assetBusy || refCount > 0}>{t('notes.dialog.delete')}</Button>
                </div>
              )
            }) : (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground">{t('notes.dialog.noAssetsYet')}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onAssetDialogOpenChange(false)}>{t('notes.dialog.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!assetRenameTarget} onOpenChange={(open) => { if (!open) onAssetRenameTargetChange(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.renameAsset')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.renameAssetDesc')}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={assetRenameName}
            onChange={(e) => onAssetRenameNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onRenameAsset() }}
            placeholder={t('notes.dialog.assetFilenamePlaceholder')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onAssetRenameTargetChange(null)}>{t('notes.dialog.cancel')}</Button>
            <Button onClick={onRenameAsset} disabled={assetBusy || !assetRenameName.trim()}>{t('notes.dialog.rename')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RenameDialog
        open={renameFolderDialogOpen}
        onOpenChange={onRenameFolderDialogOpenChange}
        title={t('notes.dialog.renameFolder', { folder: renameFolderTarget })}
        value={renameFolderName}
        onValueChange={onRenameFolderNameChange}
        onSubmit={onRenameFolder}
        placeholder={t('notes.dialog.folderNamePlaceholder')}
      />
      <Dialog open={deleteFolderDialogOpen} onOpenChange={onDeleteFolderDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('notes.dialog.deleteFolder')}</DialogTitle>
            <DialogDescription>
              {t('notes.dialog.deleteFolderDesc', {
                folder: deleteFolderTarget,
                count: deleteFolderNoteCount,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteFolderDialogOpenChange(false)}>{t('notes.dialog.cancel')}</Button>
            <Button variant="destructive" onClick={onDeleteFolder}>{t('notes.dialog.deleteFolder')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
