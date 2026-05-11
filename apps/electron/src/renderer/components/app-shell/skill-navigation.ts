import type { SkillDestination } from '../../../shared/types'
import { routes, type Route } from '../../../shared/routes'
import { KEYS } from '@/lib/local-storage'

type SkillDestinationStorage = Pick<Storage, 'getItem' | 'setItem'>

const DEFAULT_SKILL_DESTINATION: SkillDestination = 'local'
const SKILL_DESTINATIONS = new Set<SkillDestination>(['local', 'marketplace'])
const STORAGE_KEY = `craft-${KEYS.lastSkillDestination}`

/** Checks whether a value is one of the supported Skills submenu destinations. */
export function isSkillDestination(value: unknown): value is SkillDestination {
  return typeof value === 'string' && SKILL_DESTINATIONS.has(value as SkillDestination)
}

/** Loads the last selected Skills submenu destination, defaulting to Local Skills. */
export function getLastSkillDestination(storage: SkillDestinationStorage = window.localStorage): SkillDestination {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    return isSkillDestination(parsed) ? parsed : DEFAULT_SKILL_DESTINATION
  } catch {
    return DEFAULT_SKILL_DESTINATION
  }
}

/** Persists the last selected Skills submenu destination. */
export function setLastSkillDestination(
  storage: SkillDestinationStorage = window.localStorage,
  destination: SkillDestination
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(destination))
}

/** Resolves the route that should open when the top-level Skills item is selected. */
export function getSkillDestinationRoute(storage: SkillDestinationStorage = window.localStorage): Route {
  const destination = getLastSkillDestination(storage)

  switch (destination) {
    case 'marketplace':
      return routes.view.skillMarketplace()
    case 'local':
      return routes.view.localSkills()
  }
}
