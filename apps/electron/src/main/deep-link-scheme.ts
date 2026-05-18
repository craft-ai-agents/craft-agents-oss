export const DEFAULT_DEEPLINK_SCHEME = 'mdp'

export function getDeepLinkScheme(): string {
  return process.env.CRAFT_DEEPLINK_SCHEME || DEFAULT_DEEPLINK_SCHEME
}

export function getDeepLinkProtocol(): string {
  return `${getDeepLinkScheme()}:`
}

export function getDeepLinkPrefix(): string {
  return `${getDeepLinkScheme()}://`
}
