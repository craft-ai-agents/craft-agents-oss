import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { featureWorkbenchAtom } from '@/atoms/unified-shell'
import { ActivityRail } from './ActivityRail'
import { InspectorHost } from './InspectorHost'
import { SurfaceTabs } from './SurfaceTabs'
import { resolveWorkbenchAvailability } from './workbench-rollout'

export interface WorkspaceSurfaceHostProps {
  children: ReactNode
  operatorCapability: unknown
  /** Optional test/integration override; omitted reads the persisted atom. */
  userPreference?: unknown
}

export function WorkspaceSurfaceHost({
  children,
  operatorCapability,
  userPreference,
}: WorkspaceSurfaceHostProps) {
  const persistedPreference = useAtomValue(featureWorkbenchAtom)
  const availability = resolveWorkbenchAvailability(
    operatorCapability,
    userPreference === undefined ? persistedPreference : userPreference,
  )

  if (availability !== 'enabled') return <>{children}</>

  return (
    <>
      <ActivityRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SurfaceTabs />
        {children}
      </div>
      <InspectorHost />
    </>
  )
}
