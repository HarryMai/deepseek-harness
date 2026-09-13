# Agent Note: macOS desktop packaging provides an isolated unsigned local DMG

Status: implemented
Archived: 2026-09-11

English | [中文](2026-08-17-unsigned-macos-dmg-packaging.zh.md)

## Problem

Release-qualified macOS packaging requires a Developer ID identity, a matching Team ID, and notarization credentials. Contributors also need a complete DMG for local installation tests when those credentials are unavailable. That route must preserve the packaged Node.js, pnpm, offline seed, and private Desktop Host while remaining unable to weaken or overwrite the signed release path.

## Decision

The repository command `pnpm desktop:make:mac` delegates to `apps/desktop`'s `make:mac` script and `scripts/package-local.ts`. It accepts only a macOS host, selects that host's `x64` or `arm64` architecture, performs `build:official`, packs the current dsh, vendored, private Desktop Host, and Landlock packages, and prepares the matching upstream Node.js, pnpm, package set, and offline seed. Target Node.js execution during runtime and seed preparation makes the command host-native rather than a cross-architecture builder.

Local preparation owns `apps/desktop/.desktop-build/local/<target>/`; signed release preparation continues to own `.desktop-build/targets/<target>/`, and both may share only the integrity-verified download cache. The local entrypoint removes Apple, electron-builder certificate, Windows signer, application-ID override, and upload credential fields from inherited child environments. `prepare-local-seed.ts` uses a separate local-only entrypoint that preserves lockfile verification, production-only installation, offline reinstallation, private Host checks, pnpm-store archiving, and seed integrity inventory without invoking the release Mach-O signer.

`electron-builder-local.config.mjs` requires the internal local-build selector and uses the checked-in product name, bundle identifier, and artifact name. Its macOS configuration sets `identity: null`, `forceCodeSigning: false`, `hardenedRuntime: false`, `notarize: false`, and `dmg.sign: false`; it creates only the DMG and disables update information and publishing. It has no release after-sign, artifact-completion, notarization, upload, or completion-record hook. The signed `package:desktop*` commands and their fail-closed release configuration remain unchanged.

The unsigned DMG is a local validation artifact, not a distributable release. A quarantined copy may require Finder's **Open** action or explicit approval in **System Settings → Privacy & Security** after the recipient verifies its origin. Release upload cannot consume the local artifact because it has neither the signed target's directory nor its validated completion record and update metadata.

## Verification

`apps/desktop/tests/package-local.spec.ts` covers host-target selection, pnpm argument forwarding, signer and credential scrubbing, local-only configuration, disabled signing and publishing fields, and the absence of release hooks. `apps/desktop/tests/desktop-build-paths.spec.ts` proves local and release mutable roots are disjoint while the verified download cache remains shared. The command's dry run exercises root-script delegation, target resolution, and the final electron-builder arguments without writing package state. A full `pnpm desktop:make:mac` run on an Intel macOS host creates `apps/desktop/out/DeepSeek Harness-x64.dmg`; `hdiutil verify` accepts the image, while `codesign -dv --verbose=4` reports that both the DMG and unpacked application are not signed.

## Alternatives considered

- **Relax the release electron-builder configuration when credentials are absent** — rejected because a release command must fail before emitting an unsigned or unnotarized artifact. Separate configuration and output roots keep the two qualification levels explicit.
- **Restore the former standalone Packager and `hdiutil` implementation** — rejected because it would duplicate the current electron-builder application layout, embedded release resources, seed contract, and package selection.
- **Build both macOS architectures from one host** — rejected because seed preparation executes the target Node.js binary and platform-filtered dependencies make the prepared store target-specific. Each architecture builds and verifies on a matching host execution environment.

## Consequences

- macOS contributors can build the complete host-native DMG without an Apple identity or notarization credentials.
- Local and release artifacts cannot overwrite each other, and the local route cannot produce upload-qualified metadata.
- The local seed retains the current packaged application architecture and offline installation behavior but intentionally carries no release signature claims.
- The [Electron packaging and updates Agent Note](2026-08-25-electron-desktop-packaging-and-updates.md) owns the signed release path and the corresponding unsigned local Windows command.
