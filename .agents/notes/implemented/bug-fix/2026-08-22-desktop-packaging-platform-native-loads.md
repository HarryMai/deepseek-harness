# Agent Note: Desktop packaging defers platform native loads

Status: implemented

English | [中文](2026-08-22-desktop-packaging-platform-native-loads.zh.md)

## Problem

The packaged macOS desktop app starts Electron main from `app.asar`, but the desktop main import graph reached Windows-only native modules before any platform branch ran. `dsh-subprocess-local` imported the Windows process inspector, and `dsh-sandbox-local` imported the Windows ACL package; both had top-level Koffi imports. A macOS package does not ship or need the Koffi native addon in the Electron shell, so startup failed with `Cannot find the native Koffi module; did you bundle it correctly?` before the window/Host split could initialize.

The same package route also had two staging assumptions that broke local rebuilds after the macOS installer work: current `pnpm deploy` rejects a shared lockfile when the command overrides `injectWorkspacePackages`, and the workspace-runtime backfill copied every local optional dependency, including Linux-only Landlock platform packages whose `bin/` payload is absent on a macOS checkout.

## Decision

Windows-only Koffi use is now loaded lazily. `packages/subprocess/subprocess-local/src/windows-inspector.ts` and `packages/sandbox/sandbox-windows-acl/src/ffi.ts` import only Koffi types at module evaluation time; their runtime Koffi `require()` and native type registration run only from Win32 binding paths. POSIX process inspectors and non-Windows sandbox runner selection can import their packages without loading Koffi.

The desktop host-runtime deploy step uses `pnpm deploy --legacy` for the temporary ordinary-Node Host closure. This localizes pnpm's current shared-lockfile limitation to the packaging script instead of changing workspace-wide configuration. The supplemental workspace-runtime closure accepts the installer target platforms and skips workspace packages whose npm `os` or `cpu` fields exclude every target, so macOS packages do not try to copy Linux-only platform payloads while a multi-architecture macOS build can still include both `darwin-x64` and `darwin-arm64` packages if they appear later.

The desktop build command resolver treats a non-JavaScript `npm_execpath` as an executable to run directly. This supports native pnpm launchers such as `/Users/ming/Library/pnpm/pnpm` while preserving the existing Node-wrapper path for `.js`, `.mjs`, and `.cjs` launchers.

## Verification

Regression tests mock `koffi` to throw and prove that constructing a POSIX subprocess inspector and selecting a non-Windows sandbox runner do not load it. Workspace-runtime tests prove target filtering keeps matching `darwin` packages and skips `linux` or `!darwin` packages. Desktop build-command tests cover native package-manager launchers.

Focused test coverage passed for the Koffi paths, Windows ACL FFI failure paths, workspace-runtime filtering, and build-command resolver. The macOS package script completed on a darwin-x64 host with `--skip-build`, produced x64 and arm64 DMGs, and passed the packaged-Host smoke test for x64. Directly launching `apps/desktop/out/package/DeepSeek Harness-darwin-x64/DeepSeek Harness.app/Contents/MacOS/DeepSeekHarness` for eight seconds produced no stderr and did not report the Koffi startup error.

## Alternatives considered

**Bundle Koffi into the Electron shell.** Rejected because the macOS shell should not carry or load Windows-only native bindings. The Windows paths still load Koffi at the first operation that needs those bindings, where a missing addon can fail with the correct platform context.

**Keep eager imports and rely on optional dependency pruning.** Rejected because Electron evaluates the bundled main graph before the application can select a platform path. An optional native package that is irrelevant on macOS still becomes fatal when it is imported at top level.

**Set `forceLegacyDeploy` in workspace configuration.** Rejected because the workaround is specific to desktop packaging's temporary deploy command and its transient `injectWorkspacePackages` override. A workspace-wide setting would make every deploy use legacy behavior without evidence that other deploy consumers need it.

**Copy every workspace optional dependency and ignore missing files.** Rejected because missing declared runtime roots are still a real packaging defect for compatible packages. The filter should remove impossible platform packages before copying; it should not turn missing payloads into warnings.

## Consequences

- macOS desktop startup no longer depends on the Koffi native addon, and Windows-native Koffi failures are delayed until a Windows binding path is actually used.
- The desktop workspace-runtime backfill now follows npm `os` and `cpu` constraints for the package's target set rather than the builder's single host platform.
- `--legacy` remains part of the desktop deploy command until pnpm's non-legacy deploy supports this shared-lockfile plus `injectWorkspacePackages` combination; removing it requires a real package rebuild.
- The existing macOS packaging note still owns unsigned DMG generation and cross-architecture packaging policy; this note owns the startup and staging defect fixed by lazy native loads and platform-aware runtime closure.
