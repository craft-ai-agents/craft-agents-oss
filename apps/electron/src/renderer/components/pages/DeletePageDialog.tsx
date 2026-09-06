import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeletePageDialogProps {
  /** Page name shown in the confirmation copy; null = closed */
  pageName: string | null
  /** Published pages get an extra note: the public copy is taken offline too */
  shared?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Destructive confirmation — deleting a page removes its data folder too. */
export function DeletePageDialog({ pageName, shared, onConfirm, onCancel }: DeletePageDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={pageName !== null} onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pages.deleteConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('pages.deleteConfirmDescription', { name: pageName ?? '' })}
            {shared ? ` ${t('pages.deleteSharedNote')}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('pages.deletePage')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
