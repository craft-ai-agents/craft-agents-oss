import vesperIcon from "@/assets/vesper_icon.png"

interface VesperSymbolProps {
  className?: string
}

/**
 * Vesper symbol - the hand holding a star icon
 *
 * The golden hour where AI Companions work tirelessly into the night
 * while Humans do the Orchestration and Creative Thinking.
 */
export function VesperSymbol({ className }: VesperSymbolProps) {
  return (
    <img
      src={vesperIcon}
      alt="Vesper"
      className={className}
    />
  )
}
