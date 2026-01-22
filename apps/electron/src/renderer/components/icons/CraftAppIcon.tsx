import { VesperAppIcon } from "./VesperAppIcon"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * @deprecated Use VesperAppIcon instead
 * CraftAppIcon - Legacy alias for VesperAppIcon
 */
export function CraftAppIcon(props: CraftAppIconProps) {
  return <VesperAppIcon {...props} />
}
