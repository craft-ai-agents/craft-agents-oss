import { useEffect, useState } from 'react'
import * as storage from '@/lib/local-storage'
import {
  DEFAULT_PROJECT_COLOR_TREATMENT,
  type ProjectColorTreatment,
} from '@/utils/project-colors'

const STORAGE_EVENT = 'craft-project-color-treatment-changed'

function read(): ProjectColorTreatment {
  const value = storage.get<ProjectColorTreatment>(
    storage.KEYS.projectColorTreatment,
    DEFAULT_PROJECT_COLOR_TREATMENT,
  )
  return value === 'stripe-tint' ? 'stripe-tint' : 'stripe'
}

/**
 * Read the user's "project color treatment" preference, and re-render when it changes.
 *
 * Updates propagate within the same window via a custom event dispatched by
 * `setProjectColorTreatment`, and across windows via the native `storage` event.
 */
export function useProjectColorTreatment(): ProjectColorTreatment {
  const [value, setValue] = useState<ProjectColorTreatment>(read)

  useEffect(() => {
    const refresh = () => setValue(read())
    window.addEventListener(STORAGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(STORAGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return value
}

/**
 * Persist the preference and notify listeners in the current window.
 */
export function setProjectColorTreatment(value: ProjectColorTreatment): void {
  storage.set(storage.KEYS.projectColorTreatment, value)
  window.dispatchEvent(new Event(STORAGE_EVENT))
}
