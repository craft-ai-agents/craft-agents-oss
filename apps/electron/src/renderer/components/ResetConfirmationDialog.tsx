import { useState, useMemo } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertTriangle } from "lucide-react"
import { useRegisterModal } from "@/context/ModalContext"

interface ResetConfirmationDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function getResetDialogLabels(t: TFunction) {
  return {
    title: t('common:reset.title'),
    description: t('common:reset.description'),
    warningTitle: t('common:reset.warningTitle'),
    warningDescription: t('common:reset.warningDescription'),
    confirmationPrompt: t('common:reset.confirmationPrompt', { a: '{{a}}', b: '{{b}}' }),
    placeholder: t('common:reset.placeholder'),
    confirm: t('common:reset.confirm'),
    cancel: t('common:actions.cancel'),
    items: [
      t('common:reset.items.workspaces'),
      t('common:reset.items.credentials'),
      t('common:reset.items.preferences'),
    ],
  }
}

/**
 * ResetConfirmationDialog - Destructive action confirmation with math problem
 *
 * Shows a warning about data loss and requires the user to solve a random
 * math problem to confirm the reset action.
 */
export function ResetConfirmationDialog({
  open,
  onConfirm,
  onCancel,
}: ResetConfirmationDialogProps) {
  const { t } = useTranslation(['common'])
  const labels = getResetDialogLabels(t)
  const [answer, setAnswer] = useState("")

  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, onCancel)

  // Generate a random math problem when dialog opens
  const problem = useMemo(() => {
    const a = open ? Math.floor(Math.random() * 50) + 10 : 0
    const b = open ? Math.floor(Math.random() * 50) + 10 : 0
    return { a, b, sum: a + b }
  }, [open]) // Regenerate when dialog opens

  const isCorrect = parseInt(answer) === problem.sum

  const handleConfirm = () => {
    if (isCorrect) {
      setAnswer("")
      onConfirm()
    }
  }

  const handleCancel = () => {
    setAnswer("")
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {labels.title}
          </DialogTitle>
          <DialogDescription className="text-left pt-2">
            {labels.description}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-2">
          {labels.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 text-sm">
          <strong className="text-amber-600 dark:text-amber-400">{labels.warningTitle}</strong>
          <p className="text-muted-foreground mt-1">
            {labels.warningDescription}
          </p>
        </div>

        <div className="space-y-2 pt-2">
          <label className="text-sm font-medium" htmlFor="reset-confirmation-answer">
            {t('common:reset.confirmationPrompt', { a: problem.a, b: problem.b })}
          </label>
          <Input
            id="reset-confirmation-answer"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={labels.placeholder}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isCorrect) {
                handleConfirm()
              }
            }}
            className="max-w-32"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            {labels.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={!isCorrect}
            onClick={handleConfirm}
          >
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
