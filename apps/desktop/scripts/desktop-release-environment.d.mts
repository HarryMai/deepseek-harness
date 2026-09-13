/** Environment variable that supplies the Electron application identifier. */
export const DESKTOP_APP_ID_ENV: 'DSH_DESKTOP_APP_ID'

/** Environment variable that supplies electron-builder's macOS certificate qualifier. */
export const MACOS_SIGNING_IDENTITY_ENV: 'DSH_DESKTOP_MACOS_SIGNING_IDENTITY'

/** Environment variable that supplies the expected Apple Developer Team ID. */
export const MACOS_TEAM_ID_ENV: 'DSH_DESKTOP_MACOS_TEAM_ID'

/** Public identity expected on a macOS release. */
export interface MacOSSigningEnvironment {
  readonly signingIdentity: string
  readonly teamId: string
}

/** Apple ID credentials accepted by notarytool. */
export interface MacOSAppleIdNotarizationEnvironment {
  readonly appleId: string
  readonly appleIdPassword: string
  readonly teamId: string
}

/** App Store Connect API credentials accepted by notarytool. */
export interface MacOSApiKeyNotarizationEnvironment {
  readonly appleApiKey: string
  readonly appleApiKeyId: string
  readonly appleApiIssuer: string
}

/** Keychain profile accepted by notarytool. */
export interface MacOSKeychainNotarizationEnvironment {
  readonly keychainProfile: string
  readonly keychain?: string
}

/** One complete credential strategy accepted by notarytool. */
export type MacOSNotarizationEnvironment =
  | MacOSAppleIdNotarizationEnvironment
  | MacOSApiKeyNotarizationEnvironment
  | MacOSKeychainNotarizationEnvironment

/**
 * Resolve and validate an explicitly supplied application identifier.
 * @param env - Packaging environment.
 * @returns Reverse-DNS application identifier, when supplied.
 */
export function resolveOptionalDesktopAppId(env: NodeJS.ProcessEnv): string | undefined

/**
 * Resolve and validate the application identifier required by a signed release.
 * @param env - Packaging environment.
 * @returns Reverse-DNS application identifier.
 */
export function resolveDesktopAppId(env: NodeJS.ProcessEnv): string

/**
 * Report whether a macOS certificate identity was supplied for this package.
 * @param env - Packaging environment.
 * @returns Whether macOS signing is requested.
 */
export function hasMacOSSigningIdentity(env: NodeJS.ProcessEnv): boolean

/**
 * Resolve and validate the public identity expected on a macOS release.
 * @param env - Packaging environment.
 * @returns Expected certificate qualifier and Team ID.
 */
export function resolveMacOSSigningEnvironment(env: NodeJS.ProcessEnv): MacOSSigningEnvironment

/**
 * Resolve macOS signing only when a certificate identity was supplied.
 * @param env - Packaging environment.
 * @returns The selected signing identity, if any.
 */
export function resolveOptionalMacOSSigningEnvironment(
  env: NodeJS.ProcessEnv,
): MacOSSigningEnvironment | undefined

/**
 * Resolve one complete credential set accepted by Apple's notary service.
 * @param env - Packaging environment.
 * @returns Notary credentials without the submitted artifact path.
 */
export function resolveMacOSNotarizationEnvironment(env: NodeJS.ProcessEnv): MacOSNotarizationEnvironment
