import { createPortal } from "react-dom"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface FabNewChatProps {
  onClick: () => void
  className?: string
}

/**
 * Floating action button for creating a new chat on compact/mobile layouts.
 * Bottom-right, thumb-reach. Hidden on desktop — the top-bar menu + ⌘N handle it there.
 *
 * Rendered through a portal to `document.body` so `position: fixed` is truly
 * viewport-relative. Without the portal, the FAB lives inside the navigator
 * panel which is wrapped in a transformed `motion.div` (CompactPanelTransition),
 * and any ancestor with `transform` becomes the containing block for `fixed`
 * descendants — the FAB would otherwise pin to the top of the screen instead
 * of the bottom.
 */
export function FabNewChat({ onClick, className }: FabNewChatProps) {
  const { t } = useTranslation()
  if (typeof document === 'undefined') return null
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      aria-label={t("menu.newChat")}
      className={cn(
        "fixed right-4 z-30 size-14 rounded-full",
        "bg-accent text-white",
        "flex items-center justify-center",
        "shadow-strong",
        "transition-all duration-150",
        "hover:scale-105 hover:shadow-tinted",
        "active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)]",
        className,
      )}
    >
      <Plus className="size-6 text-white" strokeWidth={2.5} />
    </button>,
    document.body,
  )
}
