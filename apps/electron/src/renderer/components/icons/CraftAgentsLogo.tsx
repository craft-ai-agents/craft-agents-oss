import brandLogo from "@/assets/brand_logo.png"

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * App brand logo.
 */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <img
      src={brandLogo}
      alt=""
      className={className}
      draggable={false}
    />
  )
}
