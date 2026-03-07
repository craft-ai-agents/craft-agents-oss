import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { CornerDownRight } from 'lucide-react'
import {
  Island,
  IslandContentView,
  IslandFollowUpContentView,
  type IslandTransitionConfig,
} from '../ui'
import { cn } from '../../lib/utils'
import { clampIslandAnchorX, getDefaultIslandWidthEstimate } from './island-motion'

export type AnnotationIslandView = 'compact' | 'confirm-follow-up'
export type AnnotationIslandMode = 'edit' | 'view'

export interface AnnotationIslandMenuProps {
  anchor: { x: number; y: number } | null
  sourceKey: string
  replayNonce: number
  isVisible: boolean
  /** Render via React portal to document.body (default). Disable inside modal/dialog contexts. */
  usePortal?: boolean
  activeView: AnnotationIslandView
  mode: AnnotationIslandMode
  draft: string
  onDraftChange: (next: string) => void
  onOpenFollowUp: () => void
  onCancel: () => void
  onRequestBack?: () => boolean
  onRequestEdit: () => void
  onSubmit: (value: string) => void
  onDelete?: () => void
  sendMessageKey?: 'enter' | 'cmd-enter'
  transitionConfig: IslandTransitionConfig
  onExitComplete?: () => void
  zIndex?: number
}

export function AnnotationIslandMenu({
  anchor,
  sourceKey,
  replayNonce,
  isVisible,
  activeView,
  mode,
  draft,
  onDraftChange,
  onOpenFollowUp,
  onCancel,
  onRequestBack,
  onRequestEdit,
  onSubmit,
  onDelete,
  sendMessageKey = 'enter',
  transitionConfig,
  onExitComplete,
  zIndex = 50,
  usePortal = true,
}: AnnotationIslandMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [activeViewSize, setActiveViewSize] = React.useState<{ width: number; height: number } | null>(null)

  const anchorX = React.useMemo(() => {
    if (typeof window === 'undefined') return 0
    if (!anchor) return window.innerWidth / 2

    const width = activeViewSize?.width ?? getDefaultIslandWidthEstimate()
    return clampIslandAnchorX(anchor.x, width)
  }, [anchor, activeViewSize])

  if (!anchor) return null

  const menuNode = (
    <div
      ref={menuRef}
      data-ca-annotation-island="true"
      className="fixed"
      style={{
        zIndex,
        left: anchorX,
        top: Math.max(36, anchor.y),
        transform: 'translate(-50%, -100%)',
      }}
    >
      <Island
        key={sourceKey}
        activeViewId={activeView}
        radius={12}
        className="border-border/40 bg-background/75 backdrop-blur-xl backdrop-saturate-150 shadow-strong"
        onActiveViewSizeChange={setActiveViewSize}
        isVisible={isVisible}
        onExitComplete={onExitComplete}
        replayEntryKey={`${sourceKey}:${replayNonce}`}
        replayOnVisible="always"
        transitionConfig={transitionConfig}
        dialogBehavior="back-or-close"
        onRequestBack={onRequestBack}
        onRequestClose={onCancel}
      >
        <IslandContentView id="compact" anchorX="center" anchorY="bottom">
          <div className="p-1 flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenFollowUp}
              className={cn(
                'h-[30px] px-2.5 rounded-[8px] text-[13px] font-medium inline-flex items-center gap-1.5',
                'text-foreground/85 hover:text-foreground hover:bg-foreground/5',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              <span>Follow up</span>
            </button>
          </div>
        </IslandContentView>

        <IslandFollowUpContentView
          id="confirm-follow-up"
          mode={mode}
          value={draft}
          onValueChange={onDraftChange}
          onCancel={onCancel}
          onRequestEdit={onRequestEdit}
          onSubmit={onSubmit}
          onDelete={onDelete}
          title="Follow-up"
          submitLabel={onDelete ? 'Save' : 'Continue'}
          placeholder="Add comments the agent should consider in the next turn…"
          maxInputHeight={320}
          sendMessageKey={sendMessageKey}
          lockScroll
        />
      </Island>
    </div>
  )

  return usePortal ? ReactDOM.createPortal(menuNode, document.body) : menuNode
}
