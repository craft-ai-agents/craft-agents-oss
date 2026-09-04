import { JonworkAppIcon } from "./JonworkAppIcon"

interface CraftAgentsLogoProps {
  className?: string
}

/** Compatibility export for the full Jonwork brand lockup. */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <JonworkAppIcon className="h-[1em] w-[1em] object-contain" />
      <span>Jonwork</span>
    </span>
  )
}
