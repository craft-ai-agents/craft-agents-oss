interface G4OSLogoProps {
  className?: string
}

/**
 * G4 OS wordmark logo - uses accent color from theme
 * Apply text-accent class to get the brand color
 */
export function G4OSLogo({ className }: G4OSLogoProps) {
  return (
    <svg
      viewBox="0 0 200 40"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="32"
        fontFamily="Manrope, system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="36"
        fill="currentColor"
        letterSpacing="-1"
      >
        G4 OS
      </text>
    </svg>
  )
}
