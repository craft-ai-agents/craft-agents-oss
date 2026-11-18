import { parseRoute } from '../../../electron/src/shared/route-parser'
import type { DeepLinkNavigation } from '../../../electron/src/shared/types'

/** Translate app links into the navigation payload consumed by the shared renderer. */
export function parseWebDeepLink(rawUrl: string): DeepLinkNavigation | null {
  if (!URL.canParse(rawUrl)) return null

  const url = new URL(rawUrl)
  if (url.protocol !== 'craftagents:') return null

  const path = `${url.hostname}${url.pathname}`
  const route = parseRoute(`${path}${url.search}`)
  if (!route) return null

  if (route.type === 'view') return { view: path }

  const actionParams = { ...route.params }
  // Native window/sidebar controls are not action arguments in the browser.
  delete actionParams.window
  delete actionParams.sidebar
  if (route.id) actionParams.id = route.id

  return { action: route.name, actionParams }
}
