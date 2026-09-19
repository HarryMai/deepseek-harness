# Agent Note: Desktop package signing follows certificate availability

Status: implemented

English | [中文](2026-09-11-certificate-selected-desktop-packaging.zh.md)

## Problem

Desktop packaging needs to produce host-native installers when a platform certificate is unavailable while retaining one fixed-target preparation and packaging flow.

## Decision

Fixed target commands keep preparation under `apps/desktop/.desktop-build/targets/<target>`. `pnpm run package:desktop:mac:arm64`, `pnpm run package:desktop:mac:x64`, and `pnpm run package:desktop:win:x64` select their target explicitly. A macOS package is signed only when `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` is non-empty; a Windows package is signed only when `DSH_DESKTOP_WINDOWS_CER_FILE` is non-empty.

When a target Node.js runtime cannot execute on the macOS build host, seed preparation runs bundled pnpm through the host Node.js with explicit target operating-system and CPU selectors. Its offline verification retains disabled lifecycle scripts so the build host never executes target CPU code; the target runtime executes those scripts at first profile installation.

Missing certificate selectors, or `DSH_DESKTOP_UNSIGNED=1`, explicitly disable certificate discovery, signing, notarization, mandatory-update metadata, release hooks, and update-deployment resolution. They omit the policy and leave the electron-builder application identifier unset unless an optional reverse-DNS value is supplied. `DSH_DESKTOP_UNSIGNED=0` and a selected certificate require the application identifier and complete platform signing inputs. Only a signed package writes the completion record required by upload validation.

## Verification

Focused Desktop tests cover target-local preparation paths, macOS and Windows unsigned configurations without application-ID or policy variables, explicit unsigned output isolation, and certificate-selected upload eligibility.

## Alternatives considered

- **A second unsigned implementation pipeline** — rejected because it duplicates target preparation and package behavior instead of selecting signing from the release environment.
- **Ambient certificate discovery** — rejected because an unselected local certificate must not silently change an unsigned build into a signed one.
- **Require an application-ID variable for unsigned packages** — rejected because it is unrelated to certificate selection and electron-builder provides a default identifier.
- **Platform-only package commands** — rejected because runtime preparation, signing, and artifact records must name one unambiguous target.

## Consequences

- Signed installers use each target's `artifacts` directory; unsigned installers use that target's `unsigned-artifacts` directory.
- Fixed target commands expose platform and architecture, and release records retain the same target name.
- `DSH_DESKTOP_APP_ID` selects neither the signed nor unsigned path.
- The archived [isolated unsigned packaging note](../../archived/architecture/2026-08-17-unsigned-macos-dmg-packaging.md) remains historical context only.
- Unsigned installers remain unsuitable for update upload because they have no completion record.
