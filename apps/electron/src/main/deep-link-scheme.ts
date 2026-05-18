export const DEFAULT_DEEPLINK_SCHEME = 'mdp'

/** Return the active custom URL scheme, including development overrides. */
export function getDeepLinkScheme(): string {
  return process.env.CRAFT_DEEPLINK_SCHEME || DEFAULT_DEEPLINK_SCHEME
}

/** Return the active custom URL protocol value used by URL.protocol. */
export function getDeepLinkProtocol(): string {
  return `${getDeepLinkScheme()}:`
}

/** Return the active custom URL prefix used when constructing deep links. */
export function getDeepLinkPrefix(): string {
  return `${getDeepLinkScheme()}://`
}
