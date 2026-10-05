/** Protect the local package commands that upstream integrations must preserve. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseDesktopPackageInvocation } from '../scripts/package-target.ts'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
const desktop = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }

it.each([
  ['mac-arm64', 'darwin', 'arm64', 'mac:arm64'],
  ['mac-x64', 'darwin', 'x64', 'mac:x64'],
  ['win-x64', 'win32', 'x64', 'win:x64'],
] as const)('retains the certificate-free %s package command and isolated artifacts', (name, platform, arch, script) => {
  expect(root.scripts[`package:desktop:${script}:unsigned`]).toBe(`pnpm --filter @deepseek-ai/dsh-desktop run package:${script}:unsigned`)
  expect(desktop.scripts[`package:${script}:unsigned`]).toBe(`tsx scripts/package-target.ts ${name} --unsigned`)
  const invocation = parseDesktopPackageInvocation([name, '--unsigned'], platform, arch)
  expect(() => {
    validateDesktopPackageEnvironment({}, invocation.target, invocation)
  }).not.toThrow()
  const config = createElectronBuilderConfig({ DSH_DESKTOP_UNSIGNED: '1' }, platform, arch)
  expect(config.directories.output.replaceAll('\\', '/')).toContain(`/out/targets/${name}/unsigned-artifacts`)
  expect(config.artifactName).toContain('-unsigned')
  expect(config.publish).toBeNull()
  expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
})
