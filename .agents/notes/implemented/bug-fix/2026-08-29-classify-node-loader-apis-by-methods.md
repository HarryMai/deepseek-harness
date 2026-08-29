# Agent Note: Classify Node Loader APIs by methods

Status: implemented

English | [中文](2026-08-29-classify-node-loader-apis-by-methods.zh.md)

## Problem

The vendored Node Loader adapter originally inferred its internal resolver interface from Node's major version. Node 24.9 still exposes `getModuleJobForImport()` and the three-argument `resolveSync(specifier, parentURL, attributes)` method, even though the adapter tagged it as the request-object interface. Client-module composition then called the resolver with reversed arguments, caught the resulting error as an unresolvable package, and emitted an empty browser boot graph. HMR selects its resolver call from the same tag.

## Decision

`ModuleLoader.fromInternal()` retains the supported-Node guard and classifies the raw Loader by its job-creation method. `getOrCreateModuleJob()` identifies the request-object interface and `getModuleJobForImport()` identifies the legacy interface. A Loader exposing neither method remains unavailable. The existing client-module registry and HMR resolver branches consume that tag, so each uses the matching `resolveSync()` argument form without duplicating version compatibility logic.

## Alternatives considered

**Keep the Node-major branch.** Rejected because a Node release number does not promise the private Loader method set. Node 24.9 demonstrates that the supported runtime can retain the legacy resolver after the version threshold.

**Probe both resolver signatures at every consumer.** Rejected because consumers would need to classify resolver failures before deciding whether to retry, and the shared Loader adapter already owns the raw internal object and its method vocabulary.

**Use `createRequire()` for all client-module rows.** Rejected because Loader resolution follows the owning entry tree and active ESM hooks; CommonJS resolution cannot preserve that selection for every configured plugin.

## Consequences

Client-module composition includes packages resolved by Node 24.9, restoring the bootstrap script and `__DSH_BOOT__` rows that the browser loader requires. HMR receives the same corrected resolver tag for changed plugin entries. The node-half regression creates a package in an owning entry tree and composes it through `ModuleLoader.fromInternal()`, so a future mismatch between the tag and `resolveSync()` signature fails before the web shell serves an empty graph.
