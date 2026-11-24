import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a copy button shows its tick. */
export const COPIED_FEEDBACK_MS = 2000

/**
 * Clipboard copy with "copied" feedback that resets after COPIED_FEEDBACK_MS. Copying again
 * restarts the timer; unmounting clears it. A failed write (no clipboard permission, insecure
 * origin) logs and shows no tick.
 */
export function useCopyToClipboard(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy:', err)
      return
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setCopied(true)
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null
      setCopied(false)
    }, COPIED_FEEDBACK_MS)
  }, [])

  return { copied, copy }
}
