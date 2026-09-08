# Agent Note: Merge resolution preserves independent configuration entries

Status: implemented

English | [中文](2026-09-05-merge-resolution-preserves-configuration-entries.zh.md)

## Problem

Adjacent additions to a Loader patch list can occupy one Git conflict hunk even though their entry ids activate independently. Selecting one parent addition, or omitting both, leaves YAML and package dependency metadata valid while a consumer waits at boot for a provider that never mounts. The same resolution error can remove direct TypeScript project references: source imports remain, but the build graph no longer includes their owners.

## Decision

A resolved configuration or compiler-reference hunk preserves every non-conflicting addition from both parents. Before recording a merge with such a hunk, the merge reviewer compares the combined result with both parents and treats independent entries as a union; entries that share an id or set incompatible values remain an explicit product decision.

The Web bundle's `connection` neighborhood contains the independently mounted `mcp-settings-probe`, `file-upload`, and `ui-settings-mcp` entries. A package dependency makes their modules resolvable but does not mount their Cordis services. The [Web roster spec](../../../../packages/bundle/web-app/tests/settings-mcp-roster.spec.ts) asserts all three entries, including the `file-upload` provider required by Session Controller. The [shipped tool rosters decision](../feature/2026-07-31-even-out-shipped-tool-rosters.md) owns the MCP settings group and probe behavior, and the [generic file-upload decision](../feature/2026-08-26-generic-file-upload.md) owns file-upload behavior. The MCP client's direct project references and public-subpath source aliases, plus the MCP settings page's hand-written source-path alias, remain part of the complete package integration; the [public package subpaths decision](../bug-fix/2026-09-03-public-package-subpaths.md) owns the subpath tuple.

The [incremental base-retargeting decision](../../archived/process/2026-07-26-incremental-pr-base-retargeting.md) continues to own merge checkpoints. This note owns preservation and validation of independent additions inside one resolved checkpoint.

## Alternatives considered

**Infer mounted services from package dependencies.** A dependency permits module resolution but creates no Loader entry, so it cannot prove that a service provider activates.

**Select one parent list when adjacent additions conflict.** This removes a valid independent contribution without a type or YAML error and can defer the failure until a dependent plugin activates.

**Automatically union every conflicting configuration entry.** Equal ids or incompatible values require an intentional deployment choice; automatic union applies only after the merge reviewer has established that the additions are independent.

## Consequences

- The roster specification fails when the Web profile loses the file-upload provider or either MCP settings entry.
- `pnpm run verify-tsconfig-paths` validates source aliases, `pnpm run build` validates compiler-reference restoration, and the built Desktop Host snapshot validates the activated Web profile rather than only its parsed configuration.
- Merge review distinguishes independently additive rows from mutually exclusive configuration, preserving the former and escalating the latter for an explicit decision.
