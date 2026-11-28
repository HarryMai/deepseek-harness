---
description: "Custom Configuration mobile push notification runtime and Settings panel for Bark Server and future mobile push providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-notifications

English | [中文](README.zh.md)

## Summary

Use this dual-face package to configure mobile push channels inside **Settings -> Custom Configuration** and send concise alerts when a task needs approval, requires manual action, stops due to a non-user passive interruption, or finishes. Stage 1 supports Bark Server (`http:`/`https:` server URL and device key) and exposes a provider registry for adding Android, HarmonyOS, Xiaomi, and other mobile backends later.

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

Open **Settings -> Custom Configuration**, switch to **Mobile notifications**, add a push channel, fill in the Bark server URL and Device Key, test delivery if desired, enable the channel and master switch, and select **Save**.

### Configure channels and triggers

The panel separates the master switch, the four task lifecycle trigger switches (approval required, manual action required, non-user passive interruption, and task completed), and the list of push channels. Every newly added channel starts disabled so partial drafts never dispatch notifications. **Send test** exercises a loopback-only Host RPC endpoint against the staged fields without saving or enabling the channel.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half (`CustomerNotificationsService`) registers a live volatile Cordis configuration under the `customer-notifications` namespace, observes `approval/request` and `user-questions/request` waterfalls non-blockingly while always delegating via `next()`, and observes `session/event` (`turn/start`, `step/start`, `turn/end`) for top-level sessions while ignoring subagent sessions, explicit user cancellations, `disposed`/`forked` turns, empty no-op turns, and turns with queued follow-up work. The Client half registers into the `settings.custom-config.item` slot provided by `@deepseek-ai/dsh-client-ui-settings-mcp`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Mobile push notifications guide](../../../customer/MOBILE_NOTIFICATIONS.md) — personal customization overview, trigger rules, and merge checklist.
- [ui-settings-mcp](../ui-settings-mcp/README.md) — Custom Configuration settings page hosting the `settings.custom-config.item` sub-tab slot.
- [ui-settings](../ui-settings/README.md) — shared browser configuration forms and settings slot contracts.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package observes Host lifecycle events out of band and contributes no tools, prompt sections, or session events to model requests.

#### KV Cache effect

None. Notification delivery never modifies model prompts, tool catalogs, or conversation history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the package's current provider and credential scope.

- **Stage 1 ships Bark Server only** — Android, HarmonyOS, and Xiaomi push backends plug into `PushProviderRegistry` in later stages.
- **Device keys are stored in profile settings** — channel keys persist in the active profile configuration document rather than an OS keychain credential backend.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Push delivery failures are contained and logged through `ctx.logger.warn` without interrupting the agent loop or blocking waterfall delegation.

</details>
