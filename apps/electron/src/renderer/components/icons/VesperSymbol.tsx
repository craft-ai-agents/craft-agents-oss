interface VesperSymbolProps {
  className?: string
}

/**
 * Vesper "V" symbol - the small pixel art icon
 * Uses accent color from theme (currentColor from className)
 *
 * The golden hour where AI Companions work tirelessly into the night
 * while Humans do the Orchestration and Creative Thinking.
 */
export function VesperSymbol({ className }: VesperSymbolProps) {
  return (
    <svg
      viewBox="0 0 115 129"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0,0 L30.6445,0 L30.6445,26 L45.716,26 L45.716,52 L60.789,52 L60.789,26 L75.861,26 L75.861,0 L106.506,0 L106.506,39 L91.433,39 L91.433,52 L76.36,52 L76.36,65 L91.433,65 L91.433,78 L106.506,78 L106.506,129 L75.861,129 L75.861,103 L60.789,103 L60.789,77 L45.716,77 L45.716,103 L30.6445,103 L30.6445,129 L0,129 L0,78 L15.072,78 L15.072,65 L30.144,65 L30.144,52 L15.072,52 L15.072,39 L0,39 L0,0 Z"
        fill="currentColor"
        fillRule="nonzero"
      />
    </svg>
  )
}
