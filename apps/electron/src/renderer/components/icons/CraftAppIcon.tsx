import jonworkMark from "@/assets/craft_logo_c.svg"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * Compatibility component that displays the canonical Jonwork mark.
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={jonworkMark}
      alt="Jonwork"
      width={size}
      height={size}
      className={className}
    />
  )
}
