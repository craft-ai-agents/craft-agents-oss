import brandLogo from "@/assets/brand_logo.png"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * CraftAppIcon - Displays the app brand logo.
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={brandLogo}
      alt="App"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  )
}
