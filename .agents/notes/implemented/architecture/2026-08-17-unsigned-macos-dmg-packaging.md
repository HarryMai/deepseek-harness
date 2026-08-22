# Agent Note: macOS desktop packaging builds unsigned per-architecture DMGs

Status: implemented

English | [中文](2026-08-17-unsigned-macos-dmg-packaging.zh.md)

## Problem

The desktop shell shipped with an unsigned Windows x64 Squirrel installer ([Electron shell Agent Note](2026-08-14-electron-shell-over-web-profile.md)) but no macOS package, so macOS recipients could only run the workspace launcher. A macOS package must preserve that note's separation — Electron main owns the window, an ordinary Node child runs the Host — while one builder covers both Apple silicon and Intel machines, and it must ship before the project holds an Apple signing identity.

## Decision

`apps/desktop/scripts/build-mac.ts` (workspace script `make:mac`, repository script `pnpm desktop:make:mac`) mirrors the Windows packager against the same `desktop-build.config.json`, extended with a `mac` section: `architectures` (a non-empty, duplicate-free subset of `x64`/`arm64`), a reverse-DNS `bundleIdentifier`, `installer` with `format: 'dmg'`, an `outputFileName` that must contain `{arch}` and end in `.dmg`, and `signing: 'none'`, plus `icons.application` accepting a `.icns` path or `null`. For each configured architecture the build packages the bundled Electron main with `@electron/packager`, asserts the packaged runtime entries (`Contents/Resources/n/node` and `Contents/Resources/h/desktop-host-child.js`), stages a bundle copy through `src/stage-application.ts` (`copyApplicationBundle`, `verbatimSymlinks: true`), and wraps it in a UDZO disk image through `hdiutil` with the display name as volume name and an `Applications` symlink for drag installation. The staging copy keeps framework symlink targets relative: the `fs.cp` default resolves them to absolute builder paths, and a staged bundle carrying those ships an `.app` whose `Electron Framework.framework` entries point back at the builder’s workspace, so the installed app fails during Electron/ICU initialization instead of resolving its framework inside the bundle. Output lands at `apps/desktop/out/make/dmg/<arch>/DeepSeek Harness-<arch>.dmg` under `apps/desktop/out/package/` staging; `packagedNodeExecutable` gains a darwin branch resolving `n/node` beside the Windows `n/node.exe` layout. `--dry-run` prints the resolved plan without writing the build or output trees, and `--skip-build` reuses existing repository artifacts — both shared with the Windows packager.

Per-architecture Node runtimes are downloaded, not copied. The Windows build copies the builder's own Node executable and therefore asserts the builder's Node equals the configured version; a macOS builder must produce both architectures from one host, so the build downloads the configured version's official `node-v<version>-darwin-<arch>.tar.gz` from nodejs.org and verifies it against the published `SHASUMS256.txt` before extraction, caching the archive under `apps/desktop/.desktop-cache/` and re-verifying on reuse. The pinned Electron darwin ZIP comes from the local Electron cache (`electron_config_cache`, `ELECTRON_CACHE`, or `~/Library/Caches/electron`) when present and otherwise from the GitHub release with the same SHA-256 verification. The Windows build instead fails when its cache lacks the ZIP, because `pnpm install` always populates the single Windows target; a macOS builder's local cache only ever holds its own architecture, so the other architecture's ZIP cannot be required locally.

The Host closure is staged once per build through the same pnpm-deploy-plus-workspace staging as Windows and shared by both architecture packages. The packaged-Host smoke test runs only for the builder's own architecture: the downloaded Node for the other architecture cannot execute on the host, so that bundle is staged, entry-checked, and imaged without a boot probe.

Signing is config-reserved, not implemented: `installer.signing` validates the literal `'none'` so a later identity adds an enum value rather than changing the config shape, matching the Windows `unsigned: true` stance. The unsigned cost lands on recipients of a downloaded copy: Gatekeeper blocks first launch ("cannot be opened because the developer cannot be verified" or "is damaged") until the app is opened through right-click → Open, macOS 15+ System Settings → Privacy & Security → Open Anyway, or `xattr -cr`. A locally built and locally launched app carries no quarantine attribute and opens without warnings.

## Verification

`apps/desktop/tests/build-config.spec.ts` accepts the checked-in unsigned macOS settings and rejects unknown or missing `mac` fields, duplicate or unsupported architectures, non-reverse-DNS bundle identifiers, signed or non-DMG installers, output filenames without `{arch}`, and non-`.icns` icons. `apps/desktop/tests/runtime.spec.ts` pins the darwin packaged-Node branch (skipped off-darwin) and its rejection of unsupported platforms. `apps/desktop/tests/stage-application.spec.ts` proves the staging copy keeps a framework symlink target relative and resolvable inside the staged bundle. `--dry-run` exercises the config-loading and target-resolution path end to end. A full `pnpm run desktop:make:mac` on a darwin-x64 host produced both `DeepSeek Harness-x64.dmg` and `DeepSeek Harness-arm64.dmg` under `apps/desktop/out/make/dmg/`; the x64 packaged-Host smoke test passed, and the arm64 smoke test was skipped as designed.

## Alternatives considered

- **Copy the builder's Node like the Windows build** — rejected because one macOS builder produces both architectures; the builder's own executable only ever matches one of them.
- **Ship one universal (fat) package** — rejected because it doubles the Electron and Node payload of every download and still requires both per-architecture Electron ZIPs; per-architecture DMGs keep each artifact single-architecture.
- **Refuse to download Electron, as the Windows build does** — rejected because `pnpm install` populates the local cache only for the builder's own architecture, so the cross-architecture ZIP could never resolve locally.
- **Wait for a signing identity before shipping macOS packages** — rejected because recipients get a working package now with a documented first-run workaround, and the reserved `signing` field keeps the later signed route additive.

## Consequences

- macOS x64 and arm64 recipients install from DMGs without the project holding an Apple Developer identity; the cost is the documented Gatekeeper first-run workaround in `apps/desktop/README.md`.
- A staged bundle keeps its framework symlinks relative, so an installed copy resolves Electron Framework inside the app and carries no dependency on the builder’s workspace paths.
- A package built for the non-host architecture is never executed during the build: its Node executable is correct by verified download, but the shared Host closure comes from the builder's workspace, so any native module shipping single-architecture binaries would match the builder rather than the package (`node-pty` currently carries both darwin prebuilds). Validate a cross-architecture package on matching hardware before distributing it.
- The macOS build reaches the network on every run (the Node checksum list) and on any Electron cache miss (the GitHub release); an offline build must preseed `apps/desktop/.desktop-cache/` and the Electron cache.
- The [Electron shell Agent Note](2026-08-14-electron-shell-over-web-profile.md) remains the owner of the window/Host separation and the Windows packaging decision; this note owns only the macOS packaging route.
