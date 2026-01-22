/**
 * CopyButton - Reusable copy-to-clipboard button with feedback
 *
 * Shows "Copy" initially, then "Copied!" with checkmark for 2 seconds after copying.
 * Used in overlay headers for copying content.
 */

import * as React from 'react'
import { useCallback, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface CopyButtonProps {
  /** Content to copy to clipboard */
  content: string
  /** Optional label (default: "Copy") */
  label?: string
  /** Optional tooltip for the button */
  title?: string
  /** Optional className override */
  className?: string
}

export function CopyButton({ content, title = 'Copy', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [content])

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded-[6px] transition-colors shrink-0 select-none',
        copied
          ? 'text-success'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      title={copied ? 'Copied!' : title}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
