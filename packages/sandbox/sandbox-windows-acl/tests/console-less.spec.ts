/**
 * Console-less end-to-end regression (field failure 2026-08-15): the desktop
 * shell spawns the runner with windowsHide, so the confined tree owns no
 * console. Console-subsystem grandchildren (git.exe/node.exe) initialized
 * against WinSta0\Default under the restricted token and intermittently died
 * at DLL init with STATUS_DLL_INIT_FAILED (0xC0000142, System log Event 26
 * popups), clustered on PowerShell native-command invocations with stderr
 * redirection (`2>$null`). The runner now pins confined children to a
 * dedicated hidden desktop (src/desktop.ts) whose DACL names the restricting
 * SIDs. This spec drives the exact field chain — windowsHide runner →
 * restricted pwsh → native grandchildren with `2>$null` — and demands clean
 * results, grandchildren included.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

const isWin32 = process.platform === 'win32'
const runnerEntry = fileURLToPath(new URL('../src/runner.ts', import.meta.url))

function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

function gitAvailable(): boolean {
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0
}

describe.skipIf(!isWin32 || !pwshAvailable())('windows-acl console-less runner', () => {
  let scratchRoot!: string
  let writableDir!: string
  let isolatedTemp!: string

  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'dsh-acl-consoleless-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    isolatedTemp = mkdtempSync(join(tmpdir(), 'dsh-acl-consoleless-temp-'))
  })

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(isolatedTemp, { recursive: true, force: true })
  })

  it('windowsHide runner: native grandchildren with stderr redirection initialize cleanly on the confinement desktop', () => {
    const gitProbe = gitAvailable()
      ? "$git = git --version 2>$null; 'GIT-GRANDCHILD: rc=' + $LASTEXITCODE + ' out=[' + ($git -join ' ') + ']';"
      : ''
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      // The exact field shapes: PowerShell 5.1 routes a native command's
      // `2>$null` through a temp file, and every grandchild here is a
      // console-subsystem binary — the DLL-init failure surface.
      "$cmd = cmd /c ver 2>$null; 'CMD-GRANDCHILD: rc=' + $LASTEXITCODE + ' out=[' + ($cmd -join ' ') + ']';",
      `$node = & '${process.execPath}' --version 2>$null; 'NODE-GRANDCHILD: rc=' + $LASTEXITCODE + ' out=[' + ($node -join ' ') + ']';`,
      gitProbe,
      // The pipe-capture boundary: .NET's ProcessStartInfo redirection drives
      // CreatePipe under the confined token. A LIMITED token (LUA_TOKEN)
      // derives the anonymous-pipe security descriptor from a fixed template
      // that names no restricting SID, so this fails with ERROR_ACCESS_DENIED
      // (5) — the regression discriminator for the flag's exclusion (see
      // win32-abi.ts).
      "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='cmd'; $psi.Arguments='/c ver'; $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $p=[System.Diagnostics.Process]::Start($psi); $p.WaitForExit(10000) | Out-Null; 'PSI-REDIRECT: rc=' + $p.ExitCode;",
      // Repetition: the field failure was intermittent, so one clean pass
      // says little; ten consecutive grandchild spawns must ALL succeed.
      "$fail = 0; 1..10 | ForEach-Object { & cmd /c ver 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { $fail++ } }; 'REPEAT-FAILURES: ' + $fail",
    ].join('')
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', runnerEntry,
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        '--', resolvePwshPath(), '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', probe],
      {
        encoding: 'utf8',
        // The desktop-shell condition: the runner owns no console, which
        // engages the confinement desktop (src/desktop.ts).
        windowsHide: true,
        timeout: 60_000,
      },
    )
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stderr).not.toContain('windows-acl-run:')
    // cmd's banner leads with a blank line, which the PowerShell capture keeps
    // as an empty element — hence the whitespace-tolerant match.
    expect(result.stdout).toMatch(/CMD-GRANDCHILD: rc=0 out=\[\s*Microsoft Windows/u)
    expect(result.stdout).toMatch(/NODE-GRANDCHILD: rc=0 out=\[v[\d.]+\]/u)
    if (gitAvailable()) {
      expect(result.stdout).toMatch(/GIT-GRANDCHILD: rc=0 out=\[git version /u)
    }
    expect(result.stdout).toContain('REPEAT-FAILURES: 0')
    expect(result.stdout).toContain('PSI-REDIRECT: rc=0')
  }, 60_000)
})
