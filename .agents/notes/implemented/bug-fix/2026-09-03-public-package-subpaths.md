# Agent Note: Public package subpaths keep their complete integration

Status: implemented

English | [中文](2026-09-03-public-package-subpaths.zh.md)

## Problem

A profile or an application can import a package subpath that is neither exposed by the package manifest nor represented in the TypeScript source graph. The source module and its tsdown entry may still exist, so an incomplete integration can pass a local source inspection while a supported profile fails under Node's package resolver or `tsc` rejects the import as outside its project graph.

The MCP client settings and probe modules, the CLI desktop-host module, and the local-subprocess process-inspector module are supported public subpaths. A deleted MCP invariant companion is not a supported public subpath.

## Decision

### Public subpath tuple

Every public subpath is one unit across both build planes: its source module, TypeScript `paths` mapping, TypeScript project references and direct development dependencies, tsdown output entry, package `exports`, and published `files` entries change together. A type-only workspace import remains a direct `devDependency` and project reference; it does not become a runtime peer merely because a public declaration names its type.

The following public imports are maintained as complete tuples: `@deepseek-ai/dsh-mcp-client/settings`, `@deepseek-ai/dsh-mcp-client/probe`, `@deepseek-ai/dsh/desktop-host`, and `@deepseek-ai/dsh-subprocess-local/process-inspector`. Source-plane paths make static checks resolve workspace source; artifact-plane exports make plain Node resolve built output.

### MCP settings integration

`dsh-mcp-client/settings` injects the Settings service and calls `ctx.settings.installSection`. The Settings package owns that operation; the MCP package does not recreate removed package-level helper exports.

### Invariant omission

The MCP client keeps no `./invariant` export, file entry, build entry, or project reference. Restoring unrelated metadata wholesale would contradict the deliberate omission recorded in the [invariant-companion note](../simplification/2026-08-28-omit-unneeded-invariant-companions.md).

## Testing

The focused MCP and host-runner suite passes with 7 tests, and the focused desktop and CLI suite passes with 12 tests. `pnpm run build` completes all Host, Client, and Web outputs. Plain Node imports each of the four built public subpaths successfully. `pnpm dsh web --no-open --host 127.0.0.1 --port 0` reaches its ready URL; the verified process is then stopped deliberately.

## Alternatives considered

**Restore the pre-refactor metadata unchanged.** Rejected: it would reintroduce the intentionally removed invariant public surface and stale Settings helper API.

**Redirect consumers to a source file or a package root export.** Rejected: profiles and desktop code use the specific public subpaths, and a published package must resolve them from built artifacts without workspace path aliases.

**Leave a public type import undeclared.** Rejected: the source build may inherit the workspace graph, but package metadata must still state the type-only development relationship and TypeScript project graph.

## Consequences

Merge and refactor review treats a public subpath as an atomic integration, not a source file. When a conflict preserves a source module or a bundle entry, reviewers verify its corresponding manifest, source-graph, and built-artifact entries before accepting the result. Focused module-load tests, a full build, and a profile startup smoke exercise the separate failure modes.
