import type { SkillDestination } from '../../../shared/types'
import { routes, type Route } from '../../../shared/routes'
import { KEYS } from '@/lib/local-storage'

type SkillDestinationStorage = Pick<Storage, 'getItem' | 'setItem'>

const SKILL_DESTINATIONS = new Set<SkillDestination>(['local', 'marketplace'])
const STORAGE_KEY = `craft-${KEYS.lastSkillDestination}`

export function isSkillDestination(value: unknown): value is SkillDestination {
  return typeof value === 'string' && SKILL_DESTINATIONS.has(value as SkillDestination)
}

export function getLastSkillDestination(storage: SkillDestinationStorage = window.localStorage): SkillDestination {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    return isSkillDestination(parsed) ? parsed : 'local'
  } catch {
    return 'local'
  }
}

export function setLastSkillDestination(
  storage: SkillDestinationStorage = window.localStorage,
  destination: SkillDestination
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(destination))
}

export function getSkillDestinationRoute(storage: SkillDestinationStorage = window.localStorage): Route {
  return getLastSkillDestination(storage) === 'marketplace'
    ? routes.view.skillMarketplace()
    : routes.view.localSkills()
}
