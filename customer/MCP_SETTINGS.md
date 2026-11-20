# User-managed MCP settings

## Shipped behavior

The application ships MCP support but ships no MCP server definition, command, endpoint, or credential. A fresh installation has the integration disabled and starts no MCP client or local child process.

Settings contains a top-level **Custom Configuration** tab alongside **Models** and **Agent Presets**. The tab lets a user save any number of MCP server records, control the collection with a master switch, and control each record with its own switch.

Every new record starts with its own switch off. A record loads only when the master switch and that record's switch are both on and its fields are valid. The master switch, every record, and every record switch are persisted in the user's settings document, so the next application launch restores their saved state. Turning the master switch off unloads every dynamic MCP client; turning one record off unloads only that client while retaining its configuration.

## Supported records

Each record has a user-chosen `serverName`, which namespaces its tools as `mcp__<serverName>__<toolName>`.

- **Local program (stdio):** an executable or runtime command, repeatable arguments, repeatable key-value environment variables, and an optional fallback working directory. Arguments and environment rows can be added or removed; an empty starter row is shown for each array editor. A locally installed program such as CodeGraph is configured this way; the application does not bundle that program.
  - **Working directory resolution:** A new stdio process uses the session's current recorded workspace directory, including a restored workspace change. If the session has no workspace, it uses the directory configured for the server; if both are blank, the server cannot start for that session (reported as unavailable with reason code `missing-cwd`). Changing the workspace does not restart a process that is already running; a new process uses the updated directory.
  - **Per-session process allocation:** Rather than sharing a single global process instance, an independent child process is started for each session. When a session terminates, its associated MCP child process is automatically cleaned up.
- **Streamable HTTP:** an `http:` or `https:` MCP endpoint URL.

Incomplete, malformed, duplicate server-name, missing working directory (when both session and configuration directories are blank), or invalid-environment records stay saved but do not load. A valid enabled record continues to load when another enabled record is invalid. Stdio environment variables are saved as a string map and passed to the child process; values are written to the settings file as supplied, so do not use this field for secrets that require protected credential storage. HTTP headers are not exposed by the settings page.

## JSON import and connection test

Use **Import JSON** to paste a common MCP document with an `mcpServers`, `mcp_servers`, or `servers` service map. A single service object and a bare service map also work. Imports add records only to the unsaved draft: every imported record is off, the current master-switch value is left unchanged, and nothing takes effect until **Save** is selected. Stdio `env` objects are retained as key-value settings; HTTP `headers` are rejected instead of silently dropping them.

Each record has a **Test connection** action. The Host accepts this action only from an authenticated owner over a direct loopback connection; do not expose the test route through a proxy that conceals the remote source. Because the Settings page runs globally outside of any specific session context, connection testing for local programs requires a configured working directory in the record. If the working directory is blank, testing is blocked and prompts the user to enter a directory first (`missing-cwd`). When configured, testing starts a temporary stdio process or connects to the HTTP endpoint, completes MCP initialization, lists its tools, and then closes the connection. Testing does not save the draft, turn on either switch, register tools, or leave a reconnect loop running. The result shows only a tool count or a generic failure category; command and endpoint details stay local to the Host.

## Upstream precedence

The upstream MCP manager keeps a separate global server list with its own Settings controls, connection status, and authorization. The Custom Configuration records described here remain session-scoped and are not synchronized with that list. Give servers different names across the two lists: when names and tool names overlap, the session-scoped tools can shadow global tools, while other tools from both servers remain visible. Disabling a server in one list does not disable its counterpart in the other.

When `upstream/master` provides an official implementation or extension of this feature, the upstream design, configuration model, and UI behavior are authoritative. Local work adopts that implementation and retains only additions that do not conflict with it.
