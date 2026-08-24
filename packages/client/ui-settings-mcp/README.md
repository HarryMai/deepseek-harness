# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

Registers the top-level **Custom Configuration** Settings section for user-managed MCP servers. The section is ordered after **Models** and **Agent Presets**, binds the Host `mcp-client` settings namespace, and stages edits until the user saves. A user can keep any number of records while the master switch is off; every new record has an independent switch that starts off, and the Host loads a record only when both switches are on. Saving server records before enabling the master switch ensures the Host only reconciles the intended configuration. Disabling the master switch saves it first and unloads every dynamic client before the retained records are updated.

Each record selects either **Local program (stdio)** or **Streamable HTTP**. The local form holds a server name, executable or runtime command, line-separated arguments, and an optional working directory; a locally installed CodeGraph executable is one example. The HTTP form holds a server name and an `http:` or `https:` endpoint. The page marks incomplete, malformed, and duplicate enabled server names, commands, and URLs before save, but preserves unfinished records so a user can finish them later. The Host persists the master switch, records, and individual switches, and remains the authority for validation and live loading.

The page also accepts a pasted `mcpServers`, `mcp_servers`, or `servers` JSON map, a bare map, or a single record. Imported records are added only to the draft and start off; the master switch is never changed by an import. `env` and `headers` are rejected because this settings format cannot persist them safely. **Test connection** sends one complete staged record to a loopback-only Host endpoint. The Host initializes a temporary client and lists its tools before closing it, so testing neither saves nor enables the record, registers tools, or starts a reconnect loop. The result is transient and reports only a tool count or a generic failure.

## Model Experience

None, as this browser settings package renders only draft configuration; the Host-owned MCP clients own every model-visible tool registration.

#### KV Cache effect

None directly. Tool definitions and their cache effect are owned by the loaded MCP clients.

## Known Limitations and Deferred Work

- **No credential support yet** — the settings-backed manager intentionally accepts neither stdio environment variables nor HTTP headers. Credential references need a dedicated secret-management design before authenticated records can load.
- **Only Streamable HTTP is exposed** — legacy MCP HTTP/SSE transports are not a selectable record type.
- **Local programs are user-managed host processes** — a stdio record starts the executable directly; the application does not bundle CodeGraph or other MCP programs, and they do not run through the harness shell tool's sandbox policy.
