# Agent Note: Desktop package signing follows certificate availability

Status: implemented

English | [中文](2026-09-11-certificate-selected-desktop-packaging.zh.md)

## Problem

Desktop packaging needs to produce host-native installers when a platform certificate is unavailable without maintaining a second preparation pipeline or output tree.

## Decision

All Desktop make commands keep target preparation under `apps/desktop/.desktop-build/<target>` and write every electron-builder artifact to `apps/desktop/out`. The public root commands are `pnpm desktop:make:mac` and `pnpm desktop:make:win`; `mac` resolves to `mac-arm64` and `mac-x64` on a macOS build host, while `win` resolves to Windows x64. A macOS package is signed only when `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` is non-empty; a Windows package is signed only when `DSH_DESKTOP_WINDOWS_CER_FILE` is non-empty.

When a target Node.js runtime cannot execute on the macOS build host, seed preparation runs bundled pnpm through the host Node.js with explicit target operating-system and CPU selectors. Its offline verification retains disabled lifecycle scripts so the build host never executes target CPU code; the target runtime executes those scripts at first profile installation.

Missing certificate selectors explicitly disable certificate discovery, signing, notarization, signed update metadata, release hooks, and update-deployment resolution. They also leave the electron-builder application identifier unset unless an optional reverse-DNS `DSH_DESKTOP_APP_ID` override is supplied. A selected certificate requires that application identifier and its complete platform signing inputs. Only a signed package writes the completion record required by upload validation.

## Verification

Focused Desktop tests cover the common output directory, target-local preparation paths, both macOS targets selected by the platform command on either macOS architecture, macOS and Windows unsigned configurations without an application-ID variable, and certificate-selected upload eligibility.

## Alternatives considered

- **Separate unsigned commands and preparation directories** — rejected because they duplicate the package pipeline and make output location depend on a command rather than the available certificate.
- **Ambient certificate discovery** — rejected because an unselected local certificate must not silently change an unsigned build into a signed one.
- **Require an application-ID variable for unsigned packages** — rejected because it is unrelated to certificate selection and electron-builder provides a default identifier.
- **Architecture-named package commands** — rejected because the macOS make command exposes both supported macOS targets without a public architecture selector.

## Consequences

- Signed and unsigned installers share `apps/desktop/out`.
- The two make commands expose only platform selection; the macOS command creates two architecture-specific release records and upload metadata retains architecture-specific target names.
- `DSH_DESKTOP_APP_ID` selects neither the signed nor unsigned path.
- The archived [isolated unsigned packaging note](../../archived/architecture/2026-08-17-unsigned-macos-dmg-packaging.md) remains historical context only.
- Unsigned installers remain unsuitable for update upload because they have no completion record.
