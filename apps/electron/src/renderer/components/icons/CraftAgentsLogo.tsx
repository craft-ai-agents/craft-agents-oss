import { VesperLogo } from "./VesperLogo"

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * @deprecated Use VesperLogo instead
 * CraftAgentsLogo - Legacy alias for VesperLogo
 */
export function CraftAgentsLogo(props: CraftAgentsLogoProps) {
  return <VesperLogo {...props} />
}
