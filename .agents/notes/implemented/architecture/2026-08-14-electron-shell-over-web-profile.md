# Agent Note: Electron wraps the existing Web profile through a loopback Host child

Status: implemented

English | [中文](2026-08-14-electron-shell-over-web-profile.zh.md)

## Problem

The shipped interactive application starts with `dsh web` and requires the user to open its printed `http://127.0.0.1:3080` URL in a browser. A desktop entry should open the interface directly without forking the product UI, plugin composition, API routes, or session behavior.

Running the Harness Host inside Electron's main process would appear to remove one process, but Electron supplies a different Node ABI and makes `process.execPath` point at Electron. Native providers and subprocess adapters rely on ordinary Node behavior, so that layout would make the presentation shell part of core execution semantics.

## Decision

`apps/desktop` is a public Electron application package. Its Node bin resolves the pinned Electron executable, starts the application, and passes the exact Node executable that invoked the bin. The Electron main process owns only single-instance handling, window lifecycle, external-link policy, and a child-process supervision channel.

The main process starts `host.js` with that ordinary Node executable. The Host child calls the public `@deepseek-ai/dsh/desktop-host` adapter, which resolves launcher `--patch` options with the existing `dsh web` parser and boots the shipped `web` profile through the same `runProfile` path, layered environment, user profile, Web arguments, and shutdown controller. No package under `packages/core` changes, and the desktop application does not duplicate or replace product composition.

After launcher flags are separated, desktop defaults prepend `--host 127.0.0.1 --port 0` to the Web arguments. User Web arguments retain their existing last-value precedence, while the default asks the OS for an unused loopback port and prevents the shell from attaching to an unrelated process already using 3080. After profile activation, the Host child reads the actual `WebServer.port` and sends a ready message over process IPC. The main process accepts only an explicit loopback HTTP URL before loading it.

The BrowserWindow loads the existing static frontend, `/api` HTTP routes, and WebSocket downlinks from that URL. IPC carries only `ready`, startup error, and shutdown messages; it is not a second product transport. The renderer enables context isolation and Chromium sandboxing, disables Node integration and WebView, denies permission requests, confines navigation to the application origin, and sends outside HTTP or HTTPS links to the system browser.

Application quit sends one shutdown request to the Host child. On POSIX, the main process retains exact Host and descendant identities before that request and does not follow a reused pid; Windows uses `taskkill /T /F`. The existing profile shutdown controller disposes the Cordis tree and WebServer; after six seconds the main process forcibly terminates the retained tree and waits for the process handle to close. An `exit` event never substitutes for `close`. The shell remains open and reports an error if forced termination does not complete. Startup has a 60-second bound, spawn errors and early Host exit are reported, and a second desktop invocation focuses the existing window.

The workspace-local Windows x64 build reads `apps/desktop/desktop-build.config.json`, packages the bundled Electron main with `@electron/packager`, and creates an unsigned per-user Squirrel installer with `electron-winstaller`. Its application source contains no Harness runtime dependencies. The builder deploys the existing `@deepseek-ai/dsh` package from the workspace into an external Host runtime directory and copies the builder's exact configured ordinary Node executable beside it. A packaged main resolves both through `process.resourcesPath`; the development launcher continues to pass its own Node executable. The installer therefore preserves the same Host process and Node ABI separation without resolving the desktop application from npm.

## Verification

Pure runtime tests pin launcher argument separation, patch parsing, ephemeral loopback defaults, development and packaged Node executable selection, Host message validation, startup failures, shutdown escalation, same-origin navigation, and external-protocol filtering. Configuration tests reject unknown fields, unsupported signing and update modes, unsafe executable names, and non-ICO Windows icons. The desktop TypeScript project, workspace constraints, package build, built-Host snapshot, and packaged-entry probes cover the release-facing application boundaries. Existing Web tests remain authoritative for UI, HTTP, WebSocket, and profile behavior because those paths are unchanged.

## Alternatives considered

- **Run the Host inside Electron main** — rejected because Electron's Node ABI and `process.execPath` would alter native-module and subprocess behavior owned by the existing runtime.
- **Load `file://` and replace HTTP/WebSocket with Electron IPC** — rejected for this application because it creates a second carrier and requires product transport changes without changing the requested interaction. The protocol layering still permits that carrier if a later requirement justifies it.
- **Open the system browser automatically** — rejected because it removes URL copying but does not provide the requested Electron application lifecycle.
- **Always bind port 3080 and load it** — rejected because a collision could either fail startup or connect the desktop shell to an unrelated local service. Readiness from the owned child and an ephemeral port establish ownership.
- **Use Electron Forge as the build orchestrator** — rejected because its stable dependency graph includes a Git-sourced transitive package forbidden by the repository's dependency policy. Direct use of Electron Packager and the Squirrel installer keeps the maintained underlying tools and deletes that dependency.

## Consequences

- Browser and desktop entries use the same frontend assets, plugin graph, HTTP API, WebSocket streams, configuration, persistence, and shutdown implementation.
- Electron remains outside core logic and cannot silently substitute its Node runtime for providers that require ordinary Node.
- The desktop renderer still uses a loopback network socket. IPC transport remains an optional future optimization, not a prerequisite for a desktop window.
- The workspace can produce an unsigned Windows x64 installer without changing product transport or Host composition. Code signing, automatic updates, other architectures, and other operating-system packages remain separate release work.
