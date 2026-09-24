---
description: "Host and Client workspace control: mutate workspace navigation and follow its complete projection."
kind: "package-reference"
---
# Workspace Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-workspace-controller` lets Clients create and order Workspaces, initialize a default Workspace, order Sessions, pin or archive Sessions, recover active recycle-bin entries, and follow Host state through API Gateway. Archiving refuses running work unless the caller requests provider stops. The package also owns `ctx.directoryPickerController` and `ctx.remote.directoryPicker`; directory picking remains an abstract seam, not a Loader entry.

## Table of Contents

- [Use this package](#use-this-package)
  - [First-use Workspace](#first-use-workspace)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Host controller serializes state-dependent mutations and reports expected failures through `RemoteError` with stable codes. Its `follow()` stream sends a complete baseline, then ordered `upsert`, `remove`, `order`, `archived`, and `pinned` increments. Each archive increment carries the complete archive set and active recycle-bin entries; pin increments carry the complete pin set, with the most recently pinned id first. A reconnect starts a new generation with a replacement baseline.

Without `stopActivity`, `archiveSession` refuses running work as `workspace/session-active` and lists it by family (`turn`, `subagent`, `job`, `schedule`) with item ids and labels. With `stopActivity: true`, the registry commits the archive before requesting providers to stop; the call resolves after the stop requests are issued while work settles in the background. Confirmed restore and clear operations manage active recycle-bin entries; clear or expiry leaves the Session hidden and unrecoverable through this package.

The Client entry provides `ClientWorkspaceModel` and `createWorkspaceStateStream()`. The model owns Workspace rows, registry order, archived Session ids and active recovery entries, pinned ids, unary mutation echoes, and stream/unary race resolution. A newer Host row wins by `updatedAt`; a committed stream order outranks an older unary response; removed Workspace ids cannot be resurrected by delayed data, and pin snapshots change only when their identities or order change. The package exposes framework-neutral snapshots and subscriptions, leaving navigation policy and React hooks to the UI owner. `WorkspaceController.archiveSession(sessionId, { stopActivity })` throws `WorkspaceArchiveError` with the Host `rpcError`, so a surface can offer to stop work after a running-work refusal.

<a id="first-use-workspace"></a>
### First-use Workspace

`workspace.initializeDefault({ directoryName, title })` returns the durable default Workspace; the Client service exposes the same request as `workspaces.initializeDefault(request, signal?)`. The [Workspace Client](../../client/ui-workspace/README.md) resolves these names from its startup language. The Host places the directory under its account's `<Documents>/deepseek-harness`, including on remote Web hosts. The directory name must be one non-blank segment without separators, colon, NUL, surrounding whitespace, or a trailing dot; the title must be non-blank. OS filename restrictions also apply. Linux system lookup requires `xdg-user-dir` with an enabled Documents directory; hosts without it must configure `documentsDirectory` or use the folder picker.

The [Workspace registry](../../workspace/workspace/README.md#first-use-workspace) owns eligibility, directory creation, and durable initialization. An existing default Workspace is returned without another Documents lookup; request names do not rename it. Ineligible first use returns `undefined`, so startup can leave directory selection to the user. Invalid names reject with `gateway/bad-request`; lookup and creation failures use standard Remote error handling. Initialization creates no Session and sends no message.

| Configuration | Default | Purpose |
| --- | --- | --- |
| `documentsDirectory` | System Documents directory | Fully qualified Host directory override |
| `documentsLookupTimeoutMs` | `10000` | Positive maximum duration of OS directory lookup, in milliseconds |

Documents lookup holds the registry mutation queue, so other Workspace mutations, including registration of a picked directory, can wait up to `documentsLookupTimeoutMs`. Cancellation can stop the lookup; after resolution succeeds, it does not roll back creation or registration.

-----

<a id="model-experience"></a>
## Model Experience

None, as `ctx.workspaceController` manages browser and Host control state and registers no prompt, tool, or Session event.

#### KV Cache effect

No direct effect; Workspace mutations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `follow()` replaces the whole projection after reconnect and has no durable cursor or incremental catch-up protocol.
- Recycle-bin recovery is authoritative only in the Host projection; a cleared or expired entry remains hidden but cannot be restored through this Remote.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Workspace Registry owns persistence; every stream generation is a full projection.
