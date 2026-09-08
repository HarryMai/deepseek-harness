# Agent Note: Even out the shipped tool rosters

Status: implemented

English | [中文](2026-07-31-even-out-shipped-tool-rosters.zh.md)

## Problem

The two shipped `dsh` surfaces offered different tools for no recorded reason. Session checkpoints, tool-result pruning, the goal tools, and Ralph were in `tui.cordis.yml`; `tool-todo` and, later, web search were in `web.cordis.yml`. Neither surface offered session search, a string-replacement editor, or a repeat-tool guard, though all three exist as packages and none is surface-specific.

The result was a user-visible difference nobody had decided: the same model, asked the same thing, could set a goal on the terminal but not in the browser, and could search the web in the browser but not on the terminal.

## Decision

The rows that are not surface-specific move into [`base.cordis.yml`](../../../../packages/bundle/base/cordis.patch.yml), and three more join them: `tool-session-query`, `tool-str-replace-editor`, and `repeat-tool-reminder`. Web search moves there too; its [deployment decision](2026-07-31-web-default-search.md) owns the security boundary while the shared base owns its surface-neutral mount. Both surfaces assemble the same roster, including fixed `glob` and `grep` members because `dsh-tool-fs-search` spawns the [packaged ripgrep binary](../../archived/architecture/2026-08-01-packaged-ripgrep-search.md). Two later decisions narrow that roster: the [session-search decision](../../archived/feature/2026-08-02-session-search-not-shipped-default.md) keeps `tool-session-query` opt-in, and the [single-editor decision](../../archived/simplification/2026-08-10-default-presets-single-editor.md) keeps `tool-str-replace-editor` out of the general-purpose presets while retaining it in `minimal`.

Two rows stay surface-specific. `tmux-context` is TUI-only because a browser surface has no terminal multiplexer to describe. `session-reference` is TUI-only because it drives the shared session-query index from the launcher's process-local path, and the browser sidebar reconciles that index on its own first search.

**This roster decision added only at the time.** No tool row was removed from either surface when it landed, and a catalog comparison found additions and nothing else. The later session-search and single-editor decisions own their respective default-roster exceptions. The shared executors, sandbox composition, and access default are owned independently by the [workspace-write default decision](../../archived/feature/2026-07-31-workspace-write-surface-default.md).

### What stays unmounted, and why

Two capabilities stay out on the evidence their own packages record, and are listed here so "we forgot" and "we decided against" stay distinguishable.

**`dsh-tool-cordis`** lets the model write JavaScript and mount it as a temporary plugin. Its README states the limit: "The sandbox is containment for honest code, not a security boundary — host-realm helpers on the sandbox global are reachable, so mount code can reach Node" ([Known limitations](../../../../packages/extensions/tool-cordis/README.md)). The `node:vm` realm lives inside the harness process while `dsh-sandbox-local` confines only the argv it spawns, so on the Web surface both the sandbox and the approval seam are bypassed rather than enforced.

**The LSP trio** stays out for an operational reason rather than a security one: `command` resolves from `PATH` at plugin load, so a missing language server fails the whole boot rather than one tool. It becomes mountable once absence degrades to a skipped registration.

### MCP is an opt-in settings group

`@deepseek-ai/dsh-mcp-client` is a runtime dependency and `dsh-base` mounts its `mcp-settings` Loader group, but the shipped row has an empty child list and the `mcp-client` section defaults to `enabled: false`. It therefore names no third-party server, starts no local child process, and contributes no MCP tools on a fresh launch.

The group reads the user's keyed MCP records and creates one client per valid entry only when the user enables both the section and that record. Every new record starts disabled; the Web Settings **Custom Configuration** page persists the master switch, each record, and its individual switch. Disabling the master switch unloads every dynamic child, while disabling one record unloads only that child. A local executable such as CodeGraph is a `stdio` record; a remote server is a `streamable-http` record. The records are still user-selected processes outside `ctx.shell` and its sandbox policy; the opt-in and absence of a baked command are the product boundary here.

The same page can import a pasted `mcpServers`, `mcp_servers`, or `servers` JSON map, a bare map, or one record. Import changes only the unsaved draft, preserves the master-switch state, and forces every imported record off. Stdio `env` maps are retained as string key-value settings; HTTP `headers` are rejected because the settings page does not expose request-header fields. The stdio editor presents arguments and environment variables as repeatable rows, with a blank starter row for each collection; the saved form keeps argument order and passes the environment map to the child process.

For one staged record, **Test connection** calls a loopback-only Host endpoint that creates a temporary MCP client, initializes it, lists its tools, and closes it before replying. The probe reports only a count or a generic failure category; it never saves or enables the record, registers tools, or starts the long-lived reconnect supervisor.

## Testing

`apps/cli/tests/shipped-composition.e2e.ts` booted the shipped tree through the real Loader in a pseudo-terminal and read the tool names out of the `request/header` the session log persisted, so the assertion was the catalog the model was actually sent. Its `--config` overlay, `composition-keyless-tail.cordis.yml`, provided test isolation only: a network-free adapter and workspace-local session artifacts.

That tail also inserted `composition-settled.ts`, which announced settled Loader activation on the terminal stream. The TUI rendered as soon as its own fiber started, so a prompt typed at the banner could reach the loop while tool rows and persistence were still activating and assemble a partial catalog; gating the smoke's first prompt on that marker made the assertion deterministic.

The same smoke also pins the TUI execution posture from the same artifact. Those sandbox-schema and initial-permission assertions belong to the [workspace-write default decision](../../archived/feature/2026-07-31-workspace-write-surface-default.md), independently of this roster.

[`apps/web/tests/shipped-composition.e2e.ts`](../../../../apps/web/tests/shipped-composition.e2e.ts) covers the Web surface in the built lane, asserting its catalog, that its access default is untouched, and that `workspace-write`'s writable roots include the temp directories — a trap that makes sandbox tests lie when the workspace sits under `/tmp` ([`roots.ts`](../../../../packages/sandbox/sandbox/src/roots.ts)).

`glob` and `grep` are asserted as fixed members rather than a host-dependent pair: `dsh-tool-fs-search` spawns the packaged ripgrep binary and registers both tools unconditionally, so the pair is always present.

Beyond the committed tests, both surfaces were driven against a real key from the built `apps/cli/lib/bin.js` under plain Node. Every mounted tool executed successfully, including `ralph` and `web_search`; the model never reached `cordis_*` or `mcp_*`, fell back to `grep` when asked for LSP navigation, and used a background `bash` task when asked for a persistent terminal.

## Alternatives considered

**Duplicate the shared rows into both overlays instead of promoting them.** Rejected on the one-home rule: three of the new rows would exist twice with no reason for the copies to diverge, and the next roster change would have to remember both.

**Sandbox the TUI in the same change.** Rejected as a separate decision that does not belong in a roster change: the TUI mounts unrestricted executors, and replacing them alters what an existing surface does rather than what it offers. That decision needs its own evidence — not least because the TUI has no `approval/request` answerer, so an escalation there fails closed instead of prompting.

**Enable PTC mode.** Its trust posture is bash-equivalent by design and its tool calls pass the same `tools/pre-execute` gate as bash, so it is not the same call as the model-code tools above. Rejected here anyway: `both` changes every model-visible request on both surfaces, and `ptc` replaces the wire rather than adding to it — either is a presentation decision, not a roster one.

**Mount a fixed MCP server by default.** Rejected because a shipped default would have to name one, and any choice spawns a third-party child process on every user's machine outside the sandbox. The settings group ships instead, remains empty and disabled until the user enters records, and never bakes a server choice into the application.

## Consequences

The same model gets the same tools on both surfaces, and the difference that existed for no recorded reason is gone. The tests assert the twenty unconditional names exactly and pin `glob` and `grep` as fixed members on both sides, so a later change that alters only one surface fails a check instead of shipping quietly; the [session-search-not-shipped-default decision](../../archived/feature/2026-08-02-session-search-not-shipped-default.md) is exactly such a later change, and both tests moved with it.

`dsh-base` now depends on `dsh-mcp-client` and mounts the empty `mcp-settings` group. That is a stable settings seam rather than a new default tool roster: only a complete record with both the master and individual switches enabled adds the server-qualified tools it discovers. Four of the historical workspace dependencies remain — the [session-search-not-shipped-default decision](../../archived/feature/2026-08-02-session-search-not-shipped-default.md) removed `@deepseek-ai/dsh-tool-session-query` along with its row.

Execution policy stays independent of the roster. The [shared workspace-write decision](../../archived/feature/2026-07-31-workspace-write-surface-default.md) owns both surfaces' sandboxed executors and default permission; changing that policy does not add or remove a tool.
