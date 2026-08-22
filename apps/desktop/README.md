# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron desktop application for the shipped DeepSeek Harness Web profile. The Electron main process owns only the window and process lifecycle; an ordinary Node child starts the existing profile, HTTP routes, WebSocket routes, and frontend unchanged.

## Run

This application is launched from the repository workspace; the build does not install `@deepseek-ai/dsh-desktop` from a registry. After the workspace dependencies and repository artifacts are present, run `pnpm desktop`. Launcher flags keep the `dsh web` ordering: place repeatable `--patch <path>` options before the first Web option, for example `pnpm desktop --patch ./extra.yml --port 3080`. The desktop defaults are `--host 127.0.0.1 --port 0`; the operating system selects a free loopback port and Electron opens it automatically.

## Build the unsigned Windows installer

[`desktop-build.config.json`](desktop-build.config.json) is the single editable input for Windows application metadata and installer behavior. It owns the display and executable names, publisher, description, copyright, Windows x64 target, Squirrel package and output names, shortcuts, optional `.ico` paths, and the ordinary Node version copied from the builder. `null` icon fields retain Electron's default icon; configured icon paths are relative to this directory.

The builder requires Windows x64, Node 24.9.0, and the repository's pnpm 11.7.0. From the repository root, install the workspace dependencies once with `pnpm install`; this links `@deepseek-ai/dsh-desktop` from `apps/desktop` and does not request that package from a registry. Packaging reads the pinned Electron ZIP from `electron_config_cache`, `ELECTRON_CACHE`, or Electron's standard local cache and fails instead of downloading it when the archive is absent. Then build the installer:

```sh
pnpm desktop:make:win:x64
```

The command builds repository artifacts, deploys the existing `@deepseek-ai/dsh` Host closure from the local workspace, and writes the packaged application under `apps/desktop/out/package/` and Squirrel artifacts under `apps/desktop/out/make/squirrel.windows/x64/`. Distribute the configured `Setup.exe`; the `.nupkg` and `RELEASES` files are update metadata. The installer is per-user, does not require administrator access, bundles its ordinary Node runtime, works offline after installation, and does not enable automatic updates or delete Harness user data during uninstall.

The configuration intentionally accepts only the current unsigned Windows x64 route. Unsupported changes such as enabling signing, automatic updates, machine-wide installation, or another architecture fail before packaging instead of being ignored. An unsigned installer displays an unknown-publisher or SmartScreen warning on some Windows systems.

## Build the unsigned macOS disk images

The same [`desktop-build.config.json`](desktop-build.config.json) owns the macOS package metadata in its `mac` section: the target architectures (`x64` and `arm64`), the reverse-DNS bundle identifier, the DMG output filename with its required `{arch}` placeholder, and an optional `.icns` icon path. `installer.signing` is pinned to `none`; the field reserves the configuration position for a later signed build without enabling one. A `null` icon retains Electron's default icon; a configured icon path is relative to this directory.

The builder requires macOS and the repository's pnpm 11.7.0, and one builder of either architecture produces both packages. From the repository root, install the workspace dependencies once with `pnpm install`. Unlike the Windows build, which copies the builder's own Node executable, the macOS build downloads the configured Node version's official darwin tarball for each target architecture from nodejs.org and verifies it against the published SHA-256 before use. Packaging reads the pinned Electron ZIP from `electron_config_cache`, `ELECTRON_CACHE`, or Electron's standard local cache; `pnpm install` populates that cache only for the builder's own architecture, so the other architecture's ZIP is downloaded from the GitHub release, with the same SHA-256 verification. Then build the disk images:

```sh
pnpm desktop:make:mac
```

The command builds repository artifacts, deploys the existing `@deepseek-ai/dsh` Host closure once from the local workspace, stages the downloaded Node runtime per architecture, and writes the `.app` bundles under `apps/desktop/out/package/` and one DMG per architecture under `apps/desktop/out/make/dmg/<arch>/` — `DeepSeek Harness-x64.dmg` and `DeepSeek Harness-arm64.dmg` with the checked-in configuration. Each DMG contains the application beside an `Applications` symlink for drag installation; the application bundles its ordinary Node runtime and works offline after installation. The packaged-Host smoke test runs only for the builder's own architecture because the other architecture's Node cannot execute on the host. `pnpm desktop:make:mac --dry-run` prints the resolved targets and output names without building; `--skip-build` reuses existing repository artifacts.

The configuration intentionally accepts only the current unsigned DMG route. Unsupported changes such as a signing identity, another installer format, or an output filename without `{arch}` fail before packaging instead of being ignored. Gatekeeper blocks an unsigned application downloaded from the internet with a "cannot be opened because the developer cannot be verified" or "is damaged" alert; recipients open it through right-click → **Open**, on macOS 15 or later through **System Settings → Privacy & Security → Open Anyway**, or by clearing the quarantine attribute with `xattr -cr`. An application built and launched on the same machine carries no quarantine attribute and opens without warnings.

## Process ownership

The Node launcher starts Electron and passes its own Node executable path to the Electron main process. Electron starts [`host.ts`](src/host.ts) with that ordinary Node executable, and the Host child boots the public `@deepseek-ai/dsh/desktop-host` adapter. Keeping the Harness runtime outside Electron preserves the Node ABI and `process.execPath` assumptions of native and subprocess providers.

Window closure requests bounded Harness shutdown through process IPC. On POSIX, Electron retains the exact Host and descendant process identities before sending that request; Windows delegates tree ownership to `taskkill /T /F`. If graceful shutdown does not finish within six seconds, Electron forcibly terminates the retained tree and waits for the process handle to close before quitting. A termination failure keeps Electron open and reports the error. Startup readiness is also delivered through IPC, and Electron accepts only an HTTP URL with a loopback host and an explicit port.

Packaged launches start the Host with the current user's home directory as its cwd, so an unbound session does not inherit `System32` or the installation directory. A persisted workspace cwd remains authoritative for sessions that provide one. The packaged Host also appends stdout to `userData/logs/host.stdout.log` and stderr to `userData/logs/host.stderr.log`; the default Harness-home `.env` remains the supported user-level environment layer, while a project `.env` requires a CLI or development launch from that project directory.

After startup, a Host exit with code `0` and no signal is treated as a normal application exit. Other unsupervised exits show the existing error dialog and terminate the Electron shell.

## Renderer security

The renderer uses context isolation, Chromium sandboxing, and no Node integration or WebView. Only `clipboard-sanitized-write` from the loaded application origin is allowed; all other permission requests remain denied. Navigation stays on the application origin, and HTTP or HTTPS links outside that origin open in the system browser. IPC carries lifecycle messages only; product API calls continue through the existing HTTP and WebSocket implementation.

## Known limitations

- The Windows installer is unsigned and may require the user to choose **More info** and **Run anyway** in SmartScreen.
- The macOS disk images are unsigned; Gatekeeper blocks a downloaded copy until the recipient explicitly opens it or clears its quarantine attribute.
- A macOS package built for the non-host architecture (arm64 on an x64 builder or the reverse) is staged but never executed during the build: its packaged-Host smoke test is skipped, and the deployed Host closure comes from the builder's workspace. Validate such a package on matching hardware before distributing it.
- The native installer build is workspace-local and does not fetch `@deepseek-ai/dsh-desktop` from npm.
- Packaged Host output is available below Electron's per-user `userData/logs/` directory; a project `.env` outside the Harness home is not a packaged-launch input.
- A custom non-loopback `--host` is rejected by the desktop shell because its renderer accepts loopback application URLs only; use `dsh web` for deliberate network exposure.
