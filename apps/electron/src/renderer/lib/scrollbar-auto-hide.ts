/**
 * Global scroll detection for auto-hiding native scrollbars.
 *
 * Sets `data-scrolling` attribute on any element that fires a scroll event.
 * Removes it after a timeout, creating a "show on scroll, hide on idle" effect.
 *
 * Native scrollbar CSS uses [data-scrolling]::-webkit-scrollbar-thumb to show the thumb.
 * Radix ScrollArea is excluded — it handles scroll detection internally.
 */

const HIDE_DELAY = 800
const scrollTimers = new WeakMap<EventTarget, ReturnType<typeof setTimeout>>()

export function initScrollbarAutoHide() {
  document.addEventListener(
    'scroll',
    (e) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return

      // Skip Radix ScrollArea viewports — handled by the ScrollArea component
      if (target.hasAttribute('data-radix-scroll-area-viewport')) return

      target.setAttribute('data-scrolling', '')

      const existing = scrollTimers.get(target)
      if (existing) clearTimeout(existing)

      scrollTimers.set(
        target,
        setTimeout(() => {
          target.removeAttribute('data-scrolling')
          scrollTimers.delete(target)
        }, HIDE_DELAY),
      )
    },
    true, // capture phase to catch all scroll events (including non-bubbling ones)
  )
}
