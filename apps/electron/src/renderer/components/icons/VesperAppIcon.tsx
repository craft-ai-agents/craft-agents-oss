import vesperIcon from "@/assets/vesper_icon.png"

interface VesperAppIconProps {
  className?: string
  size?: number
}

/**
 * VesperAppIcon - Displays the Vesper app icon (hand holding a star)
 */
export function VesperAppIcon({ className, size = 64 }: VesperAppIconProps) {
  return (
    <img
      src={vesperIcon}
      alt="Vesper"
      width={size}
      height={size}
      className={className}
    />
  )
}
