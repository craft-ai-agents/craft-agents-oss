import brandLogo from "@/assets/brand_logo.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * App brand symbol used in the title bar, splash screen, and onboarding.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={brandLogo}
      alt=""
      className={className}
      draggable={false}
    />
  )
}
