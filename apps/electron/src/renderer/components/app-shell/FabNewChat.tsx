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
        // Layered shadow: ambient drop + accent-tinted glow + subtle inner highlight
        "shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45),0_6px_18px_-6px_rgba(109,93,252,0.55),inset_0_1px_0_0_rgba(255,255,255,0.15)]",
        "transition-all duration-150",
        "hover:scale-105 hover:shadow-[0_14px_34px_-8px_rgba(0,0,0,0.5),0_8px_22px_-6px_rgba(109,93,252,0.65),inset_0_1px_0_0_rgba(255,255,255,0.2)]",
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
