# Agent Note: Keep packaged Electron Host assumptions explicit

Status: implemented

English | [中文](2026-08-21-electron-shell-runtime-assumptions.zh.md)

## Problem

The packaged Electron shell starts the same Web profile as `dsh web`, but an installed GUI process does not inherit a terminal's working directory or visible console. Electron also applies permission handlers to the loopback renderer, and the Host can request an ordinary application exit through its existing command-line service.

## Decision

Packaged launches pass the current user's home directory as the Host cwd. Development launches retain the launcher cwd. This gives unbound sessions a stable per-user default and keeps them out of installer or `System32` directories; a persisted workspace cwd remains owned by the session.

The main process allows only `clipboard-sanitized-write` when the requesting frame has the loaded Web profile origin. Every other renderer permission remains denied. This preserves the sandboxed renderer while allowing the existing workspace and Web UI copy controls to use the browser Clipboard API.

Host stdout and stderr remain connected to the development process streams and are also appended to separate files below Electron `userData/logs/`. A failure to create those files is reported to the process diagnostics without preventing the Host from starting.

After the Host is ready, exit code `0` without a signal is an intentional application exit and closes Electron without an error dialog. Non-zero exits and signal exits remain unexpected unless the desktop shutdown sequence already owns the quit.

## Verification

Electron-free runtime tests cover packaged and development cwd selection, log paths, same-origin clipboard permission selection, and the normal versus unexpected exit matrix. The desktop TypeScript project and runtime test pass. An installed Squirrel launch still requires Windows field verification for the two startup paths, actual clipboard writes, log creation, and the application exit command.

## Alternatives considered

- **Keep `process.cwd()` for every launch** — rejected because Squirrel startup can provide `System32` or an installation directory, changing `.env` lookup and unbound-session file operations.
- **Allow every permission for the loopback page** — rejected because the renderer does not need broad device, notification, or navigation permissions; only clipboard writes are part of the existing UI contract.
- **Replace the browser Clipboard API in the UI** — rejected because the Web UI already owns a tested host clipboard helper and the Electron issue is the shell's permission policy.
- **Treat every post-ready exit as a crash** — rejected because the existing Web profile has a normal exit request and reports it with code `0`.

## Consequences

The packaged desktop entry has deterministic user-level startup semantics and leaves Host diagnostics in a location available after a console-less launch. Project-specific `.env` discovery is intentionally not inferred from a later workspace selection; users needing that layer can launch the CLI or development desktop entry from the project directory. Clipboard writes work only for the owned application origin, and newly required renderer permissions must be explicitly added to the shell policy and tests.
