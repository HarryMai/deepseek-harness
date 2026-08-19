# Agent Note: The windows-acl runner drops LUA_TOKEN so confined processes can create pipes

Status: implemented

English | [中文](2026-08-17-windows-acl-drop-lua-token-for-pipe-capture.zh.md)

## Problem

Field failure 2026-08-17 on the packaged desktop shell (Windows 11 22H2, build 22621): under `workspace-write`, every PowerShell command that captures native output failed at program launch with `Program 'X.exe' failed to run: Access is denied` — pipelines (`git ... | Select-Object`), variable captures (`$x = & git`), `2>$null` redirects, and .NET `ProcessStartInfo` redirection. Plain invocations without capture succeeded seconds apart. The failure reproduced at 100% on the field machine with the built runner in both `workspace-write` and `read-only` modes, console-present and console-less alike.

Forensics on the field machine: `CreatePipe` itself fails with `ERROR_ACCESS_DENIED` (5) inside a confined process; `AnonymousPipeServerStream` with an explicit `Everyone: FullControl` `PipeSecurity` succeeds; a confined-created `EventWaitHandle` takes the token default DACL and creation passes. The token default DACL patch (`setTokenDefaultDaclGrant`) is therefore effective, yet the anonymous-pipe security descriptor does not come from the token default DACL when the token is limited: `createRestrictedToken` passed `LUA_TOKEN`, and limited tokens derive anonymous-pipe SDs from a fixed template that names no restricting SID, so the WRITE_RESTRICTED pass-2 creation check fails. The development machine (build 26200) passed the same flag combination — the kernel behavior differs by build — which is why the verified-pipes claim survived until the field machine exercised it.

## Decision

Drop `LUA_TOKEN` from the restricted-token flags in `createRestrictedToken` (`src/token.ts`); keep `DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED`. Without the limited flag the anonymous-pipe SD follows the token's default DACL per the documented contract, which `setTokenDefaultDaclGrant` already extends with a full-access restricting-SID ACE — confined pipe creation and every capture shape work again on 22H2 and remain working on 26200.

The write boundary is unchanged: WRITE_RESTRICTED still intersects every write-class access through the restricting SIDs, and the runner suite pins ambient-temp, Documents, Public, and C-root denials with the flag absent. What LUA_TOKEN bought — a filtered-admin (limited) token — is not the write mechanism; pass-2 is. Reads and other non-write rights are intentionally not confined by this rung, so the wider pass-1 (the Administrators group is no longer deny-only) does not change the governed surface.

## Verification

- Field-machine matrix before/after: with LUA_TOKEN every capture shape failed (`CreatePipe` err 5; pipeline, capture, `2>$null`, and ProcessStartInfo redirection all failed); without it all pass, and `whoami /all` works.
- `tests/console-less.spec.ts` gains a `ProcessStartInfo.RedirectStandardOutput` probe asserting `PSI-REDIRECT: rc=0` — the discriminating regression: with LUA_TOKEN it fails ERROR_ACCESS_DENIED on 22H2, without it it passes on 22H2 and 26200.
- Package suite: 161 passed. The six `runner.spec.ts` failures are the documented pre-existing environmental ones on machines without pwsh (Win32 2 on the bare `pwsh` image name), reproduced identically on the unmodified source.

## Alternatives considered

- **Keep LUA_TOKEN and probe/degrade** — rejected: a half-working sandbox is the bug; degrading shells to unconfined loses the write boundary, and failing closed makes every confined run unusable on 22H2.
- **Make the default-DACL ACE non-inheritable** — tested and refuted: the ACE flags do not affect the pipe failure.
- **Broker pipes in the runner or hook CreatePipe via an injected DLL** — a native shim is the only way to keep the limited flag and restore pipe creation; disproportionate for the write-only contract, rejected.
- **Conditional LUA_TOKEN by build** — a version gate adds a second token-derivation path and an OS-floor fact to maintain; the flag's benefit does not cover the write boundary, so unconditional exclusion is simpler and pinned by tests.

## Consequences

- Confined processes create anonymous pipes again: PowerShell pipelines, variable captures, `2>$null`, and .NET redirection work under both confined modes on 22H2 and later.
- `whoami` and token-inspection cmdlets now work under the restricted token; the package README claim is corrected.
- The confined token is no longer marked limited: the Administrators group stays enabled in pass-1 (pass-2 still gates every write), and the token-inspection failure mode disappears.
- libuv's named-pipe stdio boundary is unchanged: `spawn(..., { stdio: 'pipe' })` inside a confined process still fails EPERM (the named-pipe default SD template), matching the documented limitation.
- The 2026-08-08 design note is updated in place (flag list and rationale).
