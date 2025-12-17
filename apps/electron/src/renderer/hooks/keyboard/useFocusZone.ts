import { useRef, useEffect, useCallback } from "react"
import { useFocusContext, type FocusZoneId } from "@/context/FocusContext"

interface UseFocusZoneOptions {
  /** Unique zone identifier */
  zoneId: FocusZoneId
  /** Called when zone gains focus */
  onFocus?: () => void
  /** Called when zone loses focus */
  onBlur?: () => void
  /** Custom function to focus first element in zone */
  focusFirst?: () => void
}

interface UseFocusZoneReturn {
  /** Ref to attach to zone container */
  zoneRef: React.RefObject<HTMLDivElement>
  /** Whether this zone currently has focus */
  isFocused: boolean
  /** Programmatically focus this zone */
  focus: () => void
}

/**
 * Hook for registering a component as a focus zone.
 * Zones can be navigated between using Tab/Shift+Tab or Cmd+1/2/3.
 */
export function useFocusZone({
  zoneId,
  onFocus,
  onBlur,
  focusFirst,
}: UseFocusZoneOptions): UseFocusZoneReturn {
  const zoneRef = useRef<HTMLDivElement>(null)
  const { registerZone, unregisterZone, focusZone, isZoneFocused } = useFocusContext()

  const isFocused = isZoneFocused(zoneId)

  // Track previous focus state for callbacks
  const wasFocusedRef = useRef(isFocused)

  // Register zone on mount
  useEffect(() => {
    registerZone({
      id: zoneId,
      ref: zoneRef as React.RefObject<HTMLElement>,
      focusFirst,
    })

    return () => {
      unregisterZone(zoneId)
    }
  }, [zoneId, registerZone, unregisterZone, focusFirst])

  // Handle focus/blur callbacks
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current) {
      onFocus?.()
    } else if (!isFocused && wasFocusedRef.current) {
      onBlur?.()
    }
    wasFocusedRef.current = isFocused
  }, [isFocused, onFocus, onBlur])

  const focus = useCallback(() => {
    focusZone(zoneId)
  }, [focusZone, zoneId])

  return {
    zoneRef,
    isFocused,
    focus,
  }
}
