/**
 * ObscuredLabel
 *
 * Vertical text label shown when a panel is "obscured" (scrolled past) in the panel stack.
 * The label occupies a 40px-wide strip on the left edge of the panel, matching the PEEK_WIDTH.
 * Text is rendered vertically using writing-mode: vertical-lr.
 */

import { cn } from '@/lib/utils'
import { PEEK_WIDTH } from '@/hooks/usePanelScrollStates'

interface ObscuredLabelProps {
  /** The title text to display vertically */
  title: string
  /** Whether the label should be visible (panel is obscured) */
  visible: boolean
  /** Optional click handler (e.g., to scroll to panel) */
  onClick?: () => void
}

export function ObscuredLabel({ title, visible, onClick }: ObscuredLabelProps) {
  return (
    <div
      className={cn(
        'absolute inset-y-0 left-0 z-10 select-none',
        'text-[13px] font-medium text-muted-foreground',
        'transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        onClick && 'cursor-pointer hover:text-foreground',
      )}
      style={{
        writingMode: 'vertical-lr',
        width: PEEK_WIDTH,
        lineHeight: `${PEEK_WIDTH}px`,
        paddingTop: 36,
        overflow: 'hidden',
      }}
      onClick={onClick}
    >
      {title}
    </div>
  )
}
