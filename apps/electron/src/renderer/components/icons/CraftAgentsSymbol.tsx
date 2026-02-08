interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Bunny pixel art symbol - the small pixel art bunny icon
 * Uses accent color from theme (currentColor from className)
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id="bunny-mask">
          <rect x="0" y="0" width="16" height="16" fill="white" />
          {/* Left eye cutout */}
          <rect x="5" y="6" width="2" height="2" fill="black" />
          {/* Right eye cutout */}
          <rect x="9" y="6" width="2" height="2" fill="black" />
        </mask>
      </defs>
      {/* Left ear */}
      <rect x="3" y="0" width="2" height="5" fill="currentColor" />
      {/* Right ear */}
      <rect x="11" y="0" width="2" height="5" fill="currentColor" />
      {/* Head with eye cutouts */}
      <rect x="2" y="4" width="12" height="7" fill="currentColor" mask="url(#bunny-mask)" />
      {/* Bow tie */}
      <rect x="4" y="12" width="8" height="2" fill="currentColor" />
    </svg>
  )
}

