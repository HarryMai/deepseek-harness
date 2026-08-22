# Agent Note: The declared files view must be import-closed

Status: implemented

English | [中文](2026-08-21-declared-lib-import-closure.zh.md)

## Problem

`pnpm deploy` and `npm pack` copy a package by its manifest `files` list, and this repository's convention enumerates built entries one file at a time (`lib/index.js`, `lib/invariant.js`, …) instead of a `lib` directory. Rolldown splits modules shared between a package's entries into content-hashed sibling chunks such as `lib/process-inspector-DNK_Zw9B.js`, and no manifest names a hash that changes with content. When `@deepseek-ai/dsh-subprocess-local` gained a second rolldown entry, its chunk fell outside the `files` list, so the desktop packager staged an `index.js` that imports a file the tarball never carried; the failure surfaced only as a Cordis loader `ERR_MODULE_NOT_FOUND` during the packaged-Host smoke test ([macOS packaging Agent Note](../architecture/2026-08-17-unsigned-macos-dmg-packaging.md)).

The `verify-built-package-invariants` gate was built for exactly this class — it stages the manifest-declared lib view precisely so an undeclared runtime chunk fails — but it imported only the `./invariant` companion, which shares no chunk with the main entries, so it passed.

## Decision

The `files` list of every package must cover the runtime chunks its entries import, expressed as a prefix glob (`lib/process-inspector-*.js`), following the existing `lib/types-*.js` precedent in `dsh-sandbox-windows-acl`; `dsh-subprocess-local` adopts that glob.

`verify-built-package-invariants` now proves the declared lib view import-closed: after staging only the manifest-declared `lib` files, it statically scans every staged `.js` file's relative static and dynamic imports and fails when a target inside `lib/` is missing. Only `.js`/`.mjs`/`.cjs` specifiers count — client bundles embed type-metadata strings such as `import('./workspaces/service.ts')` that name sources, not runtime files — and imports escaping `lib/` (assets, scripts) stay outside the check. The `./invariant` probe through plain Node is unchanged. The check is static, so it neither executes native dependencies nor loads browser bundles, and it runs wherever the gate already runs (`pnpm run hygiene`, the CI built-package lane).

## Alternatives considered

- **Probe every export entry through plain Node** — rejected: importing arbitrary entries executes top-level native loads (`koffi`, `node-pty`) and browser bundles under plain Node, turning a packaging check into an environment-sensitive execution matrix. The static scan covers the same closure with no execution.
- **List the whole `lib` directory in `files`** — rejected: it abandons the per-entry enumeration convention and packs stale build residue, since tsdown does not clean `lib` between builds (a renamed chunk's predecessor would ship forever).
- **Fix it in the desktop staging layer** — rejected: `stageMissingWorkspaceRuntimePackages` already copies whole `files` roots, so the desktop failure was only the first consumer to hit the gap; any `npm pack`/`pnpm deploy` consumer of the same manifest would lose the chunk. The manifest is the place the contract lives.

## Consequences

- The missing-chunk class now fails at gate time with the exact `file -> specifier` pair, instead of at packaged-Host boot inside the Cordis loader; removing the glob from `dsh-subprocess-local` fails `verify-built-package-invariants` with `lib/index.js -> ./process-inspector-DNK_Zw9B.js`.
- Any package that gains a multi-entry rolldown build must declare its chunk glob; the gate names the missing file, so the fix is mechanical.
- The gate reads every staged lib file's source, which adds negligible time to a gate that already imports 226 companions.
- The [package invariant contracts Agent Note](../architecture/2026-07-19-package-invariant-runtime-contracts.md) keeps owning what companions assert; this note owns only the declared-files closure the gate now enforces.
