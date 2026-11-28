# Mobile push notifications (Custom Configuration)

## Purpose and scope

This customization extends **Settings -> Custom Configuration** beyond MCP servers so personal features can live as independent sub-tabs under one extensible slot (`settings.custom-config.item`).

The first extension added on top of this slot is **Mobile notifications** (`@deepseek-ai/dsh-client-ui-settings-notifications`), which sends concise push alerts to mobile devices (iOS, Android, HarmonyOS, etc.) when a task needs attention or finishes. Stage 1 integrates **Bark Server** (`https://api.day.app` or self-hosted Bark instances); the Host provider registry is designed so Android, HarmonyOS, Xiaomi, and other mobile push backends can be added in later stages without changing the lifecycle observer or settings persistence model.

## Shipped behavior

A fresh installation ships with mobile push notifications disabled and no push channel configured (`enabled: false`, `channels: {}`). No outbound HTTP request is sent until the user adds a valid channel, enables that channel, enables the master switch, and saves.

All settings persist in the active profile patch under the `customer-notifications` namespace (`@deepseek-ai/dsh-client-ui-settings-notifications`) using volatile Cordis configuration, so saved changes take effect immediately without restarting the Host and restore automatically on subsequent launches.

## Supported providers and extensibility

- **Stage 1 — Bark Server (`provider: "bark"`):**
  - **Server URL (`serverUrl`):** HTTP or HTTPS Bark server base URL (for example `https://api.day.app` or a self-hosted instance). The adapter posts JSON to `<serverUrl>/push` without doubling a trailing `/push`.
  - **Device Key (`deviceKey`):** Target device key from the Bark mobile app, sent inside the JSON request body (`device_key`) rather than URL paths.
  - **Optional fields:** Channel display name (`name`), notification group (`group`, defaults to `DSH`), sound (`sound`), and urgency level (`level`: automatic, `active`, `timeSensitive`, or `passive`).
  - **Multiple channels:** Any number of channels can be configured. Enabled, valid channels receive notifications concurrently, and a failure on one channel is logged and isolated without blocking others.
- **Stage 2+ — Android / HarmonyOS / Xiaomi:**
  - Additional push backends implement `PushChannelAdapter` in `packages/client/ui-settings-notifications/src/providers/` and register via `PushProviderRegistry` (or at runtime through `ctx.customerNotifications.registerProvider(adapter)`).

## Notification triggers and message content

Four task lifecycle triggers are supported, each individually toggleable in Settings (all four default to enabled once the master switch is turned on):

1. **Human privilege approval required (`approvalRequired`):** Triggered non-blockingly when an active task raises `approval/request` or a `user-questions/request` carrying `intent.kind === 'approval'`.
2. **Manual action required (`manualActionRequired`):** Triggered non-blockingly when an active task raises `user-questions/request` for plan confirmation (`intent.kind === 'plan-review'`) or interactive user input (`ask_user_question`).
3. **Passive task interruption (`passiveInterruption`):** Triggered on top-level session `turn/end` events caused by non-user interruptions (`error`, `max-tokens`, `blocked`, `interrupted`, or `aborted` with cause `hook`, `parent`, or `legacy`). Explicit user cancellations (`aborted` with cause `user`), `disposed`, `forked`, and internal subagent sessions (`origin === 'subagent'`) do not notify.
4. **Task completed (`taskCompleted`):** Triggered on top-level session `turn/end` with `kind === 'completed'` when the turn executed at least one step and has no queued follow-up/steering work waiting in the agent inbox.

Push notifications intentionally stay concise: each message carries only the reason title, a one-line cause summary (plus tool/subject name or error code when applicable), and the short session title (or short session ID prefix fallback). Full conversation transcripts, command bodies, and stack traces are never sent.

## Loopback test push

Each channel card provides a **Send test** (**测试推送**) button backed by a loopback-only Host RPC endpoint (`POST /customer-notifications/test`, `{ access: 'owner-loopback' }`). Testing sends a single verification notification using the staged draft fields without saving the form or enabling the channel.

## Implementation map for upstream merges

When merging `upstream/master`, check these locations:

- **Notifications package:** `packages/client/ui-settings-notifications/` (Host service, Bark provider, concise message builders, Client settings panel, tests, and package docs).
- **Custom Configuration sub-tab host:** `packages/client/ui-settings-mcp/src/client/` (declares child slot `settings.custom-config.item` and renders the sub-tab bar when extensions register).
- **Web/Desktop bundle wiring:** `packages/bundle/web-app/package.json`, `packages/bundle/web-app/cordis.patch.yml`, and `packages/bundle/web-app/tests/settings-mcp-roster.spec.ts`.
- **Workspace TypeScript wiring:** `tsconfig.base.json`, `tsconfig.host.json`, and `tsconfig.client.json`.
- **README model-experience audit entry:** `scripts/verify-package-readme-model-experience.ts` (`packages/client/ui-settings-notifications`).

## Upstream precedence

When `upstream/master` introduces an official notification settings surface or Custom Configuration extension host, compare configuration schema, trigger semantics, and UI behavior before deciding whether to adopt upstream or keep this personal implementation.
