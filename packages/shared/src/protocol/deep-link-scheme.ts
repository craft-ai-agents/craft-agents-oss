/** Default OS custom URL scheme used by Electron deep links. */
export const DEFAULT_DEEPLINK_SCHEME = 'mdp'

/** Default URL protocol value as reported by URL.protocol. */
export const DEFAULT_DEEPLINK_PROTOCOL = `${DEFAULT_DEEPLINK_SCHEME}:`

/** Default URL prefix used when constructing Electron deep links. */
export const DEFAULT_DEEPLINK_PREFIX = `${DEFAULT_DEEPLINK_SCHEME}://`

/** Host used by OIDC authorization-code redirects back into the Electron app. */
export const SSO_CALLBACK_HOST = 'sso-callback'

/** Default OIDC redirect URI for the Electron SSO callback. */
export const DEFAULT_SSO_CALLBACK_URL = `${DEFAULT_DEEPLINK_PREFIX}${SSO_CALLBACK_HOST}`

/** Environment values that may override the development deep-link scheme. */
export interface DeepLinkSchemeEnv {
  [key: string]: string | undefined
  CRAFT_DEEPLINK_SCHEME?: string
}

/** Return the active custom URL scheme, including development overrides. */
export function getConfiguredDeepLinkScheme(env: DeepLinkSchemeEnv = process.env): string {
  return env.CRAFT_DEEPLINK_SCHEME || DEFAULT_DEEPLINK_SCHEME
}

/** Return the active custom URL protocol value used by URL.protocol. */
export function getConfiguredDeepLinkProtocol(env: DeepLinkSchemeEnv = process.env): string {
  return `${getConfiguredDeepLinkScheme(env)}:`
}

/** Return the active custom URL prefix used when constructing deep links. */
export function getConfiguredDeepLinkPrefix(env: DeepLinkSchemeEnv = process.env): string {
  return `${getConfiguredDeepLinkScheme(env)}://`
}
