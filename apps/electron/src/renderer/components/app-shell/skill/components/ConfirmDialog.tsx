import * as React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="w-full max-w-[360px] sm:max-w-[360px] gap-0 p-6">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-[14px] font-medium transition-colors',
              destructive
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-foreground text-background hover:opacity-85',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
