import { useEffect, useState } from 'react'
import { ComposerModelMenu } from '@/components/app-shell/input/ComposerModelMenu'
import type { CraftyModelMenuProps } from './useCraftyModel'

/** Quieter than the composer's chip: the question is the panel's focus, not the model. */
const CHIP = 'h-control-sm gap-1 pl-2 pr-1.5 text-label-sm font-normal text-tertiary'

/**
 * The composer's model menu in the panel. Non-modal: in this click-through window a modal menu
 * would block the panel, which reads as the pointer leaving it, so a click there would fall
 * through to the app underneath. Lives inside the panel, so each invocation starts closed.
 */
export function CraftyModelMenu(props: CraftyModelMenuProps) {
  const [open, setOpen] = useState(false)

  // A click in another app takes the focus away from this window: the menu closes with it
  useEffect(() => {
    if (!open) return
    const onBlur = () => setOpen(false)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [open])

  return <ComposerModelMenu {...props} open={open} onOpenChange={setOpen} modal={false} triggerClassName={CHIP} />
}
