---
description: "Read-only runtime API discovery for agents developing and configuring installed Harness plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

English | [中文](README.zh.md)

## Summary

Inspect Host and Client runtime APIs before writing plugin code. Creator mode provides these read-only tools alongside Plugin Manager, which owns persistent profile changes. The inspection registry is supplied by the Cordis host runner; browser queries need a connected page.

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

Creator mode includes this toolset. Other compositions mount `@deepseek-ai/dsh-tool-cordis` alongside the host runner that provides `cordisInspect`; use [Plugin Manager](../../boot/plugin-manager/README.md) to install bundles containing persistent plugin code or MCP configuration.

When a composition provides `dynamicCordisRunner`, this plugin also lets a session define and run a temporary model-written tool, service, or browser UI without making it a repository plugin; without that runner, its lifecycle tools do not activate.

Structured arguments remain structured: callers send `cordis_inspect_query.input`, `cordis_define.plugin`, and `cordis_define.code` as JSON objects rather than JSON text. The runtime preserves a valid ordinary string unchanged. If a model accidentally sends JSON text where a Cordis method or Define field requires an object, the Cordis boundary accepts it only when decoding it produces a value that passes the exact declared schema; malformed or mismatched text reports the original validation failure or a field-specific Define error.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-cordis-host-runner'
  config:
    vmTimeoutMs: 5000
- name: '@deepseek-ai/dsh-tool-cordis'
```

The [Web bundle patch](../../bundle/web-app/cordis.patch.yml) mounts the host runner, and the [Creator preset](../../preset/agent-presets/presets/cordis/agent.cordis.yml) adds this tool. A package with a browser half additionally needs the browser runner and the UI package in the client composition; a host-only package needs none of them.

### What the tools do

The three inspect tools are read-only; the four lifecycle tools define and manage packages. All results are JSON rendered as text.

- `cordis_inspect_list` — list the Inspect Providers (host and client) and their query methods.
- `cordis_inspect_query` — run one provider query: exact service methods, event modes, builtin signatures, tool schemas, theme tokens, or live slot trees.
- `cordis_inspect_self` — this session's dynamic plugins: version pointers, latest run, and, for one exact package, its source and runtime diagnostics.
- `cordis_define` — record a package: a new plugin (`plugin.kind: "new"` with a 3–6-letter `idPrefix`) or a new version of an existing plugin (`plugin.kind: "existing"` with its `pluginId`). It validates parameters and syntax only; nothing runs and no approval is requested.
- `cordis_run` — activate one package (`mode: "run"` for the first activation or restart, `mode: "update"` to switch versions). A package with a browser half may return `awaiting-approval` until a person allows it; the tool never waits for the final outcome.
- `cordis_stop` — stop the current run and cancel any pending approval, keeping the plugin and every package version.
- `cordis_undefine` — stop and permanently remove a plugin and all of its packages.

### A typical workflow

Inspect before writing, then define, then run: `cordis_inspect_query` reads the exact contract of the service or slot the package will use, `cordis_define` records the source (and the conversation shows a define card pointing to the panel where the run control lives), and `cordis_run` activates it. When the user types `@pluginId`, this package injects a context message that pins the referenced plugin, its base package, and the update path. After a technical failure, read the diagnostics with `cordis_inspect_self`, append a corrected package to the same plugin, and update to it.

### Boundaries to plan around

Definitions are session-scoped and process-local: a package is visible and controllable only in the session that defined it, stays active across later turns, and can affect other sessions in the same process while running. Stopping, removing, unloading the toolset, or restarting DSH clears it. The sandbox isolates globals but is not a security boundary — treat a dynamic package like bash access, and load this plugin as deliberately as you would grant one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Host providers combine generated Service/Event catalogs and the requesting agent's tool registry. Client providers synchronize their manifests through the existing inspection registry and answer queries from a connected page. The tool plugin owns its registrations through Cordis effects; disposal removes both tools and prompt contributions. No invariant companion is published because inspection reads its providers directly and maintains no independent runtime projection.

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

The [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis) describes two read-only inspection tools. The [prompt](src/prompt.ts) directs persistent changes through Plugin Manager and describes MCP setup. Creator visual requests default to an installed UI plugin displayed in the current Web page; the development skill covers Client packaging and slot registration. Query results contain the requested API declarations or live tool schemas.

#### Token effect

Both tool schemas and the guidance section enter model requests while this plugin is visible. Query results append to the transcript; exact queries avoid loading unrelated declarations.

#### KV Cache effect

Unchanged schemas and guidance remain prefix-stable. Query results append to history; enabling other plugins can change subsequent tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Client queries wait for a responding page or cancellation. Inspection cannot invoke service methods, configure plugins, or execute generated code.

<a id="dev-note"></a>
### Dev Note

None.
