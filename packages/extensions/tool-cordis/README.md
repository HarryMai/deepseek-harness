---
description: "Read-only runtime API discovery for agents developing and configuring installed Harness plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

English | [中文](README.zh.md)

## Summary

Inspect Host and Client runtime APIs before writing plugin code, and use temporary dynamic lifecycle tools when the composition provides a runner. Creator mode provides these tools alongside Plugin Manager, which owns persistent profile changes. The inspection registry is supplied by the Cordis host runner; browser queries need a connected page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Creator mode includes this toolset. Other compositions mount `@deepseek-ai/dsh-tool-cordis/host` once in the host composition beside the host runner that provides `cordisInspect`, and mount `@deepseek-ai/dsh-tool-cordis` in each agent preset that exposes the tools; a preset row alone registers no Host providers. Use [Plugin Manager](../../boot/plugin-manager/README.md) to install bundles containing persistent plugin code or MCP configuration.

When a composition provides `dynamicCordisRunner`, this plugin also lets a session define and run a temporary model-written tool, service, or browser UI without making it a repository plugin; without that runner, its lifecycle tools do not activate.

Structured arguments remain structured: callers send `cordis_inspect_query.input`, `cordis_define.plugin`, and `cordis_define.code` as JSON objects rather than JSON text. The runtime preserves a valid ordinary string unchanged. If a model accidentally sends JSON text where a Cordis method or Define field requires an object, the Cordis boundary accepts it only when decoding it produces a value that passes the exact declared schema; malformed or mismatched text reports the original validation failure or a field-specific Define error.

The Host `Config` provider lists live Loader entries in pages (`offset`, `limit` up to 100, optional exact plugin `name`; `total` and `nextOffset` bound the walk) with each entry's Loader id, the tree-local id patches address, and its Config status (`schema`, `absent`, `unsupported`, `tree` for group and include carriers, `inactive` for disabled, never imported, or disposed entries). It projects one entry's native Config into a self-contained JSON Schema document and includes its resolved `packageDir` when the profile package lookup finds the package directory.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-cordis-host-runner'
  config:
    vmTimeoutMs: 5000
- name: '@deepseek-ai/dsh-tool-cordis/host'
- name: '@deepseek-ai/dsh-tool-cordis'
```

The [Web bundle patch](../../bundle/web-app/cordis.patch.yml) mounts the host runner and Host providers; the [cordis preset patch](../../bundle/web-app/presets/cordis.patch.yml) adds this tool. A package with a browser half additionally needs the browser runner and the UI package in the client composition; a host-only package needs none of them.

### What the tools do

The three inspection tools are read-only; the four lifecycle tools define and manage temporary packages. All results are JSON rendered as text.

- `cordis_inspect_list` — list the Inspect Providers (host and client) and their query methods.
- `cordis_inspect_query` — run one provider query: exact service methods, event modes, plugin Config schemas, tool schemas, theme tokens, or live slot trees.
- `cordis_inspect_self` — list this session's dynamic plugins or inspect one package's source and runtime diagnostics.
- `cordis_define` — record a package: a new plugin (`plugin.kind: "new"` with a 3–6-letter `idPrefix`) or a new version of an existing plugin (`plugin.kind: "existing"` with its `pluginId`). It validates parameters and syntax only; nothing runs and no approval is requested.
- `cordis_run` — activate one package (`mode: "run"` for the first activation or restart, `mode: "update"` to switch versions). A package with a browser half may return `awaiting-approval` until a person allows it; the tool never waits for the final outcome.
- `cordis_stop` — stop the current run and cancel any pending approval, keeping the plugin and every package version.
- `cordis_undefine` — stop and permanently remove a plugin and all of its packages.

### A typical workflow

Inspect before writing, then define, then run: `cordis_inspect_query` reads the exact contract of the service or slot the package will use, `cordis_define` records the source, and `cordis_run` activates it. When the user types `@pluginId`, this package injects a context message that pins the referenced plugin, its base package, and the update path. After a technical failure, read the diagnostics with `cordis_inspect_self`, append a corrected package to the same plugin, and update to it.

### Boundaries to plan around

Definitions are session-scoped and process-local: a package is visible and controllable only in the session that defined it, stays active across later turns, and can affect other sessions in the same process while running. Stopping, removing, unloading the toolset, or restarting DSH clears it. The sandbox isolates globals but is not a security boundary — treat a dynamic package like bash access, and load this plugin as deliberately as you would grant one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Host providers combine generated Service/Event catalogs, the live Loader tree projected through the app-boot Config projector, and the requesting agent's tool registry. Client providers synchronize their manifests through the existing inspection registry and answer queries from a connected page. The `/host` entry owns process-global provider registrations, while each preset row owns inspection and optional lifecycle tools through Cordis effects; the registry rejects duplicate provider ids, so providers register once per process. No invariant companion is published because inspection reads its providers directly and maintains no independent runtime projection.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin Manager](../../boot/plugin-manager/README.md) — persistent bundle installation and enablement.
- [Cordis host runner](../cordis-host-runner/README.md) — inspection registry and existing runtime consumers.

<a id="model-experience"></a>
## Model Experience

### Runtime inspection

#### What the model sees

The [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis) describes the inspection and lifecycle tools. The prompt section directs model calls to Inspect before writing and preserves the JSON-text compatibility rule for Define fields. In the `cordis` preset, the first-turn skill catalog carries the descriptions of the shipped skills, which route plugin, MCP, composition, and destination-less visual requests to the relevant development guidance. Query results contain the requested API declarations, live tool schemas, the live entry directory with Config status, or one entry's projected Config JSON Schema.

#### Token effect

The tool schemas and dynamic-plugin guidance enter model requests while this plugin is visible. Query results append to the transcript; exact queries avoid loading unrelated declarations.

#### KV Cache effect

Unchanged tool schemas and guidance remain prefix-stable. Query results append to history; enabling other plugins can change subsequent tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Client queries wait for a responding page or cancellation. Inspection cannot invoke service methods, configure plugins, or execute generated code.
- `Config.listConfigs` walks the profile Loader tree only. Agent preset `plugins` lists mount in detached preset trees, so a plugin present only inside a preset declaration is not listed unless the profile tree also mounts it.
- Dynamic packages are session-scoped and process-local. They can affect other sessions while running, and they disappear when stopped, unloaded, or when DSH restarts.

<a id="dev-note"></a>
### Dev Note

None.
