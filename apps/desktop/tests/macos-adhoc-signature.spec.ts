/** Exercise certificate-free codesign with an executable owned by each test. */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { assertMacOSRuntimeSignatureDetails, signMacOSRuntimeCode, verifyMacOSRuntimeCode } from '../scripts/verify-macos-signature.mjs'

it('requires the local runtime signature, identifier, and hardened runtime flag without release credentials', () => {
  const details = 'Identifier=com.example.local\nSignature=adhoc\nCodeDirectory v=20500 flags=0x10002(adhoc,runtime) hashes=1+0'
  expect(() => {
    assertMacOSRuntimeSignatureDetails(details, undefined, 'com.example.local')
  }).not.toThrow()
  expect(() => {
    assertMacOSRuntimeSignatureDetails(details, undefined, 'com.example.other')
  }).toThrow('identifier')
  expect(() => {
    assertMacOSRuntimeSignatureDetails(details.replace('Signature=adhoc', 'Signature=certificate'), undefined)
  }).toThrow('not ad-hoc')
  expect(() => {
    assertMacOSRuntimeSignatureDetails(details.replace('(adhoc,runtime)', '(adhoc)'), undefined)
  }).toThrow('hardened runtime')
})

// Codesign and executable entitlements belong to macOS; parser coverage remains cross-platform.
it.skipIf(process.platform !== 'darwin').each([undefined, 'local-jit-entitlements.plist', 'local-node-x64-entitlements.plist'])
('signs, verifies, and executes native code without a certificate (entitlements=%s)', async (plist) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-adhoc-signature-'))
  try {
    const executable = join(root, 'probe')
    copyFileSync('/usr/bin/true', executable)
    const entitlements = plist === undefined ? undefined : join(import.meta.dirname, '../scripts', plist)
    await signMacOSRuntimeCode(executable, 'com.example.local', undefined, entitlements)
    expect(() => {
      verifyMacOSRuntimeCode(executable, undefined, 'com.example.local', entitlements)
    }).not.toThrow()
    expect(() => execFileSync(executable)).not.toThrow()
    expect(() => {
      verifyMacOSRuntimeCode(executable, undefined, 'com.example.other', entitlements)
    }).toThrow('identifier')
    if (plist !== undefined) {
      expect(() => {
        verifyMacOSRuntimeCode(executable, undefined, 'com.example.local')
      }).toThrow('entitlements do not match')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Signing the installed Node executable hashes its entire binary before the native-load check.
it.skipIf(process.platform !== 'darwin')('loads a bundled native module from a local Node interpreter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-adhoc-addon-'))
  try {
    const node = join(root, 'node')
    const source = join(root, 'addon.c')
    const addon = join(root, 'addon.node')
    copyFileSync(process.execPath, node)
    writeFileSync(source, 'void* napi_register_module_v1(void* env, void* exports) { return exports; }\n')
    execFileSync('/usr/bin/clang', ['-dynamiclib', '-o', addon, source])
    const entitlements = join(import.meta.dirname, '../scripts', process.arch === 'x64'
      ? 'local-node-x64-entitlements.plist' : 'local-jit-entitlements.plist')
    await signMacOSRuntimeCode(node, 'com.example.node', undefined, entitlements)
    await signMacOSRuntimeCode(addon, 'com.example.addon', undefined)
    verifyMacOSRuntimeCode(node, undefined, 'com.example.node', entitlements)
    expect(execFileSync(node, ['-e', 'require(process.argv[1]); console.log("loaded")', addon], { encoding: 'utf8' })).toBe('loaded\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)
