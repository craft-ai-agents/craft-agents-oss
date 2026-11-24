/**
 * A popover that opens on hover and pins on click (the Coding-mode PR chip's card).
 *
 * Hover opens after `openDelay`; leaving the trigger and the content closes it after `closeDelay`,
 * enough to cross the gap between them. A click pins it open (hover no longer closes it); a second
 * click, Esc or an outside click closes it. Touch pointers skip hover and use the click path.
 *
 * Built on the existing controlled Radix Popover rather than a hover card: the card holds links and
 * buttons, so it has to work from the keyboard and on touch too.
 */

import * as React from 'react'

export interface HoverIntentState {
  open: boolean
  /** Opened (or kept open) by a click: hover-out doesn't close it */
  pinned: boolean
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const DEFAULT_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The open/pin state machine, free of React and the DOM so it can be tested with fake timers. */
export class HoverIntent {
  private state: HoverIntentState = { open: false, pinned: false }
  private openTimer: unknown = null
  private closeTimer: unknown = null

  constructor(
    private readonly options: {
      openDelay: number
      closeDelay: number
      onChange: (state: HoverIntentState) => void
      timers?: Timers
    },
  ) {}

  private get timers(): Timers {
    return this.options.timers ?? DEFAULT_TIMERS
  }

  get current(): HoverIntentState {
    return this.state
  }

  /** The pointer entered the trigger or the content. */
  enter(): void {
    this.cancelClose()
    if (this.state.open || this.openTimer !== null) return
    this.openTimer = this.timers.set(() => {
      this.openTimer = null
      this.set({ open: true, pinned: false })
    }, this.options.openDelay)
  }

  /** The pointer left the trigger or the content. */
  leave(): void {
    this.cancelOpen()
    if (!this.state.open || this.state.pinned || this.closeTimer !== null) return
    this.closeTimer = this.timers.set(() => {
      this.closeTimer = null
      this.set({ open: false, pinned: false })
    }, this.options.closeDelay)
  }

  /** Click (or Enter/Space) on the trigger: pin an unpinned card, close a pinned one. */
  click(): void {
    this.cancelOpen()
    this.cancelClose()
    this.set(this.state.open && this.state.pinned ? { open: false, pinned: false } : { open: true, pinned: true })
  }

  /**
   * Keep an open card open while it is being used from a layer outside it (a menu opened from the
   * card renders in a portal, so reaching it looks like leaving the card). Never opens a closed card.
   */
  pin(): void {
    if (!this.state.open) return
    this.cancelClose()
    this.set({ open: true, pinned: true })
  }

  /** Esc or an outside click (Radix `onOpenChange(false)`). */
  dismiss(): void {
    this.cancelOpen()
    this.cancelClose()
    this.set({ open: false, pinned: false })
  }

  dispose(): void {
    this.cancelOpen()
    this.cancelClose()
  }

  private cancelOpen(): void {
    if (this.openTimer === null) return
    this.timers.clear(this.openTimer)
    this.openTimer = null
  }

  private cancelClose(): void {
    if (this.closeTimer === null) return
    this.timers.clear(this.closeTimer)
    this.closeTimer = null
  }

  private set(next: HoverIntentState): void {
    if (next.open === this.state.open && next.pinned === this.state.pinned) return
    this.state = next
    this.options.onChange(next)
  }
}

type PointerHandler = (event: React.PointerEvent) => void

export interface HoverPopover extends HoverIntentState {
  /** For the Radix `Popover`'s `onOpenChange` (it only ever reports closes here) */
  onOpenChange: (open: boolean) => void
  /** Pin an open card (see {@link HoverIntent.pin}) */
  pin: () => void
  /** Spread on the trigger; its onClick prevents Radix's own toggle */
  triggerProps: { onPointerEnter: PointerHandler; onPointerLeave: PointerHandler; onClick: (event: React.MouseEvent) => void }
  /** Spread on the popover content */
  contentProps: { onPointerEnter: PointerHandler; onPointerLeave: PointerHandler }
}

export function useHoverPopover({ openDelay = 300, closeDelay = 150 }: { openDelay?: number; closeDelay?: number } = {}): HoverPopover {
  const [state, setState] = React.useState<HoverIntentState>({ open: false, pinned: false })
  const [intent] = React.useState(() => new HoverIntent({ openDelay, closeDelay, onChange: setState }))
  React.useEffect(() => () => intent.dispose(), [intent])

  return React.useMemo(() => {
    const enter: PointerHandler = (event) => {
      if (event.pointerType !== 'touch') intent.enter()
    }
    const leave: PointerHandler = (event) => {
      if (event.pointerType !== 'touch') intent.leave()
    }
    return {
      ...state,
      onOpenChange: (open: boolean) => {
        if (!open) intent.dismiss()
      },
      pin: () => intent.pin(),
      triggerProps: {
        onPointerEnter: enter,
        onPointerLeave: leave,
        onClick: (event: React.MouseEvent) => {
          // Radix skips its own toggle for a default-prevented click; the intent decides instead
          event.preventDefault()
          intent.click()
        },
      },
      contentProps: { onPointerEnter: enter, onPointerLeave: leave },
    }
  }, [state, intent])
}
