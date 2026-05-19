import {
  DEFAULT_DEEPLINK_SCHEME,
  getConfiguredDeepLinkPrefix,
  getConfiguredDeepLinkProtocol,
  getConfiguredDeepLinkScheme,
} from '@craft-agent/shared/protocol'

export { DEFAULT_DEEPLINK_SCHEME }

/** Return the active custom URL scheme, including development overrides. */
export function getDeepLinkScheme(): string {
  return getConfiguredDeepLinkScheme()
}

/** Return the active custom URL protocol value used by URL.protocol. */
export function getDeepLinkProtocol(): string {
  return getConfiguredDeepLinkProtocol()
}

/** Return the active custom URL prefix used when constructing deep links. */
export function getDeepLinkPrefix(): string {
  return getConfiguredDeepLinkPrefix()
}
