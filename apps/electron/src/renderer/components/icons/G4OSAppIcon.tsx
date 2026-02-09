import g4osLogo from "@/assets/g4os_logo.png"

interface G4OSAppIconProps {
  className?: string
  size?: number
}

/**
 * G4OSAppIcon - Displays the G4 OS logo (golden compass/crosshair icon)
 */
export function G4OSAppIcon({ className, size = 64 }: G4OSAppIconProps) {
  return (
    <img
      src={g4osLogo}
      alt="G4 OS"
      width={size}
      height={size}
      className={className}
    />
  )
}
