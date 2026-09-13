import {
  resolveDesktopAppId,
  resolveOptionalDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveOptionalMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  hasWindowsSigningCertificate,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import {
  resolveDesktopAutoUpdateConfig,
  resolveDesktopAutoUpdateTarget,
} from './scripts/desktop-auto-update-environment.mjs'
import { DESKTOP_OUTPUT_DIR, desktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'

/**
 * Create electron-builder configuration from one packaging environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const macOSSigning = packagesMacOS ? resolveOptionalMacOSSigningEnvironment(env) : undefined
  if (macOSSigning !== undefined) resolveMacOSNotarizationEnvironment(env)
  const windowsSigner = packagesWindows && hasWindowsSigningCertificate(env)
    ? createWindowsTokenSigner({
        certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const signed = macOSSigning !== undefined || windowsSigner !== undefined
  const appId = signed ? resolveDesktopAppId(env) : resolveOptionalDesktopAppId(env)
  const update = signed ? resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch) : undefined
  const buildPaths = desktopTargetBuildPaths(resolveDesktopAutoUpdateTarget(resolvedPlatform, resolvedArch))
  return {
    ...(appId === undefined ? {} : { appId }),
    productName: 'DeepSeek Harness',
    artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}',
    directories: { output: DESKTOP_OUTPUT_DIR },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      identity: macOSSigning?.signingIdentity ?? null,
      forceCodeSigning: macOSSigning !== undefined,
      hardenedRuntime: macOSSigning !== undefined,
      notarize: macOSSigning !== undefined,
      sign: macOSSigning === undefined ? null : undefined,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: macOSSigning !== undefined,
      writeUpdateInfo: false,
    },
    ...(macOSSigning === undefined ? {} : {
      afterSign: context => {
        if (context.electronPlatformName !== 'darwin') return
        verifyMacOSSignatureAfterSign(context, macOSSigning)
      },
      artifactBuildCompleted: artifact => {
        if (!artifact.file.endsWith('.dmg')) return
        return notarizeMacOSDiskImageArtifact(artifact, env, macOSSigning)
      },
    }),
    win: {
      forceCodeSigning: windowsSigner !== undefined,
      signExecutable: windowsSigner !== undefined,
      signtoolOptions: windowsSigner === undefined
        ? null
        : { sign: windowsSigner, signingHashAlgorithms: ['sha256'] },
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: windowsSigner !== undefined,
    },
    publish: update === undefined ? null : [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
