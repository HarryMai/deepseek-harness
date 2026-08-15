# Agent Note: Console-less hosts pin confined children to a dedicated hidden desktop

Status: implemented

English | [中文](2026-08-15-console-less-confinement-desktop.zh.md)

## Problem

Field failure, 2026-08-15: in the packaged desktop shell (`apps/desktop`, Electron), sandboxed tool calls intermittently raised Windows Application-Popup dialogs — System log Event 26, `git.exe` / `node.exe`, `应用程序无法正常启动 (0xC0000142)` (`STATUS_DLL_INIT_FAILED`). Six popups correlated to the second with sandboxed `powershell` tool calls in one desktop-hosted session; every failing command carried a `2>$null` stderr redirection, while identical commands without redirection succeeded seconds apart. The failure was intermittent and never reproduced in isolation (35+ console-less repro spawns passed), pointing at a shared environmental resource rather than a deterministic denial.

The desktop shell spawns the Host tree with `windowsHide`, so the `dsh-sandbox-windows-acl` runner owns no console (`GetConsoleWindow` NULL). A confined console-subsystem child then cannot share a host console; Windows initializes it against the interactive `WinSta0\Default` desktop instead. Under the `WRITE_RESTRICTED` token that path is fragile twice over: the pass-2 restricted-SID access check leans on whatever ambient ACEs `Default`'s DACL happens to carry, and every console/desktop-heap consumer on the machine shares `Default`'s heap — a month-uptime machine with security software scanning child spawns makes the collision intermittent.

## Decision

Follow the standard sandbox pattern (Chromium's alternate desktop): when the runner has no console, `src/desktop.ts` creates a dedicated hidden desktop `dsh-acl-<pid>-<6hex>` on the process window station with a DACL built from SDDL granting `GENERIC_ALL` to SYSTEM (`S-1-5-18`), Administrators (`S-1-5-32-544`), Everyone (`S-1-1-0`), the logon SID (stringified through `ConvertSidToStringSidW`), and the workspace/temp capability SIDs. Both spawn paths pin it as `STARTUPINFOW.lpDesktop` (`<WinStaName>\<name>`), so every confined descendant inherits the desktop and initializes console/user32 deterministically against explicit pass-2 ACEs and a fresh desktop heap. Desktop creation fails closed like every other init step — a runner that cannot build its desktop never spawns.

The change adds FFI surface (`user32`: `GetConsoleWindow`, `GetProcessWindowStation`, `GetUserObjectInformationW`, `CreateDesktopW`, `CloseDesktop`; `advapi32`: `ConvertSidToStringSidW`, `ConvertStringSecurityDescriptorToSecurityDescriptorW`) and switches `STARTUPINFOW.lpDesktop` from koffi `'str16'` to `PVOID` with a caller-owned UTF-16 buffer kept referenced across `CreateProcessAsUserW`. One empirical FFI pitfall is pinned in a comment: decoding a returned string pointer **as** `'str16'` reinterprets the string's first code units as a nested pointer and segfaults the process (`0xC0000005`); `decodeString16` reads one `uint16` at a time via the (pointer, offset, type) form and never reads past the terminator.

Console-present runners (a terminal-hosted CLI) keep the long-standing shared-console path untouched — `hasConsole` gates the desktop, and the existing spawn shape is byte-identical when no desktop is pinned.

## Verification

- `tests/desktop.spec.ts`: the SDDL builder as a pure function; live create/close of the hidden desktop through the real bindings; capability-SID acceptance; fail-closed behavior on a garbage SID; a console-less (`windowsHide`) child probe asserting `hasConsole` is false and desktop creation works there.
- `tests/console-less.spec.ts`: the exact field chain end-to-end — `windowsHide` runner → confined `powershell` → `cmd`/`node`/`git` grandchildren with `2>$null`, plus ten repeated grandchild spawns — asserting exit 0, expected output, and no `windows-acl-run:` stderr.
- The mocked failure-path suite (`index-failure-paths.spec.ts`) keeps the console-present branch by stubbing `getConsoleWindow`.
- The 15-case redirect repro and the 20-way concurrent repro from the field diagnosis, retargeted at the repo-built `lib/runner.js`, all pass with the System-log Event 26 count unchanged.
- Six pre-existing `runner.spec.ts` failures on machines without `pwsh` (PowerShell 7) installed are environmental (`CreateProcessAsUserW` Win32 2 on the bare `pwsh` image name — reproduced identically with the pre-change packaged runner) and unrelated to this change.

## Alternatives considered

- **Add the console logon SID (`S-1-2-1`) to the restricting list** — already disproven by the POC and the README boundary: the child still dies at DLL init.
- **Wrap grandchildren with `CREATE_NEW_CONSOLE`/`CREATE_NO_WINDOW`** — the documented `0xC0000142` boundary; the flags are unusable under this restriction scheme.
- **Grant extra ACEs on `WinSta0\Default`** — mutating the interactive desktop's DACL widens every process's reach and still shares its heap; a dedicated desktop is strictly better confinement.
- **Attach the runner itself to a new console (`AllocConsole`)** — a hidden console would still initialize grandchildren against the ambient desktop for user32/GDI paths and risks a visible console window; the desktop pin covers both console and GUI subsystem children.

## Consequences

- Console-subsystem grandchildren (`git.exe`, `node.exe`) initialize deterministically under the desktop shell, and each runner gets a fresh desktop heap.
- No conhost window can flash on the user's screen, and confined processes lose ambient access to the user's desktop objects — a confinement improvement beyond the fix.
- A stale desktop left by a killed runner is never reopened with a foreign DACL because the name carries pid plus random suffix; the kernel destroys the desktop once the last handle closes and no process remains attached.
- Desktop creation joins the runner's fail-closed init contract: any Win32 failure aborts the spawn with `windows-acl-run:` and exit 127 rather than falling back to an unrestricted child.

## Field follow-up (2026-08-15, same day)

The original "the `0xC0000142` popup class is removed by construction" claim was falsified in the field: the fixed build still produced intermittent `git.exe` `0xC0000142` Application-Popup dialogs (System log Event 26, 15:14–15:15). Forensics eliminated every deterministic cause — the gate fired, the pin engaged, 840 field-faithful stress spawns passed, no poller, no session lock/unlock, no Defender block — leaving an irreproducible environmental transient. The desktop pin remains the primary mechanism, but it is no longer claimed sufficient by construction.

Defense in depth shipped in `dsh` 0.1.0-rc.6:

- **Popup-suppressing process error mode**: the runner installs `SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX)` (`0x8003`) at startup (`src/error-mode.ts`). Children inherit the error mode at `CreateProcess` — orthogonal to token and desktop — so a confined process dying in loader init reports its NTSTATUS as an exit code through the tool result instead of raising the modal dialog. Empirically proven on the field machine: a `failinit.exe` probe whose `DllMain` fails `DLL_PROCESS_ATTACH` (exact `0xC0000142` death) raised Event 26 and hung on the modal popup with ambient error mode `0`, and produced **no** Event 26 with an instant `0xC0000142` exit code under `0x8003`. The same death through the built runner produced no popup and a complete debug-log trail.
- **Forensic debug log**: `--debug-log <path>` runner flag writes a best-effort JSONL trail (`start`/`init`/`desktop`/`spawn`/`spawn-fail`/`exit`, capped at 512 KiB with one rotation). The desktop shell opts in via `DSH_ACL_DEBUG_LOG=<userData>/logs/acl-runner.log` in the Host spawn env; `sandbox-local` reads it in the Host process and forwards it on the runner argv as `--debug-log` because the runner env is scrubbed of all `DSH_*` names. Any field recurrence is now self-describing instead of a bare popup.
