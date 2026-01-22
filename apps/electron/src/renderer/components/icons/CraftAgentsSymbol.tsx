import { VesperSymbol } from "./VesperSymbol"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * @deprecated Use VesperSymbol instead
 * CraftAgentsSymbol - Legacy alias for VesperSymbol
 */
export function CraftAgentsSymbol(props: CraftAgentsSymbolProps) {
  return <VesperSymbol {...props} />
}
