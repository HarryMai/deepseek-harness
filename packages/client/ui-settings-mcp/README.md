---
description: "Custom Configuration settings page for users managing MCP stdio and Streamable HTTP server records in a DSH Web Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

## Summary

Use this page to stage, validate, save, and test user-managed MCP servers without putting their configuration in the shipped composition. It appears after Models and Agent Presets in Settings, and holds drafts until Save. A server starts only when both the collection switch and that record's switch are enabled; saved disabled records remain available for later use.

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

Open **Custom Configuration** from Settings, add a server record, complete its fields, save the draft, and then enable the collection and the record when it should load.

### Configure servers

Choose **Local program (stdio)** for a command run on the Host or **Streamable HTTP** for an `http:` or `https:` endpoint. The local form has a server name, command, repeatable arguments, repeatable key-value environment variables, and an optional working directory; it starts with one blank argument row and one blank environment-variable row. The HTTP form has a server name and endpoint. The page preserves unfinished records, but marks incomplete fields, malformed commands or URLs, invalid environment entries, and duplicate enabled server names before Save.

### Import and test a draft

Paste an `mcpServers`, `mcp_servers`, or `servers` JSON map, a bare map, or one record to append disabled records to the current draft. Imports never enable the collection, retain stdio `env` maps, and reject HTTP `headers` because the page cannot edit them. **Test connection** sends a complete staged record to a loopback-only Host endpoint, which creates a temporary client, lists its tools, and closes it without saving, enabling, registering tools, or starting reconnect work.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser controller derives its draft from the Host `mcp-client` settings namespace and serializes writes through the shared settings scope. The Host settings group validates saved records, resolves only enabled valid records into dynamic `mcp-client` Loader children, and leaves invalid or disabled records stored but unloaded. The page owns local validation and transient connection-test state, while the Host remains authoritative for persistence and live loading.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP settings guide](../../../MCP_SETTINGS.md) — user-facing configuration examples and operational limits.
- [mcp-client](../../mcp/mcp-client/README.md) — the Host client implementation loaded from saved records.
- [ui-settings](../ui-settings/README.md) — the shared browser settings scope and section registry.
- [settings](../../settings/settings/README.md) — durable user settings and Host-side persistence.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser settings package renders only draft configuration; the Host-owned MCP clients own every model-visible tool registration.

#### KV Cache effect

None directly. Tool definitions and their cache effect are owned by the loaded MCP clients.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the page's current transport and secret-handling coverage.

- **Environment values are plain settings** — stdio environment variables are persisted as entered and passed to the child process. Use a protected credential mechanism for secrets; HTTP headers still require a future settings surface.
- **Only Streamable HTTP is exposed** — legacy MCP HTTP/SSE transports are not selectable record types.
- **Local programs are user-managed Host processes** — a stdio record starts its executable directly; the application does not bundle CodeGraph or other MCP programs, and they do not run through the harness shell tool's sandbox policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No invariant companion is published because this page projects one settings namespace into a browser form and owns no independently observable cross-plugin relationship.

</details>
