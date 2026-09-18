# Agent Note: Session recycle-bin retention

Status: implemented

English | [中文](2026-09-18-session-recycle-bin.zh.md)

## Problem

Archiving removed Sessions from every Workspace grouping surface without a recovery path. A browser-only undo could not survive reconnects or restarts, and removing archived session logs would violate the persistence ownership boundaries retained by the [Workspace registration deletion decision](2026-07-27-workspace-registration-deletion.md) and the [session persistence decision](../architecture/2026-06-14-session-persistence.md).

## Decision

`WorkspaceRegistry` keeps the existing archive filter and records a timestamped recoverable entry for each archived Session. `restoreArchivedSessions()` validates every requested entry before one durable write removes the archive filter and all selected entries, so a batch never restores only a subset. `clearRecycleBin()` removes recovery entries while retaining their archived ids; expired entries follow the same rule. Neither operation deletes a Session log, filesystem data, or Workspace accounting.

### Durable records

The `workspace` domain state contains `archivedSessionIds`, `recycleBinEntries`, and `clearedArchivedSessionIds`. Legacy archive ids become recoverable entries during startup unless a cleared-id tombstone records that recovery was removed. The tombstones prevent an expired or cleared entry from reappearing after restart while preserving the archive filter.

### Settings and retention

The optional `@deepseek-ai/dsh-settings` seam installs the `workspace-recycle-bin` namespace with a positive whole-day `retentionDays` field and a default of 30. When `@deepseek-ai/dsh-settings-file` provides that seam, it shares MCP's `$DSH_HOME/settings.yaml` document under the [configuration-source ownership decision](../architecture/2026-08-04-configuration-source-ownership.md). Changes recalculate expiry immediately, and the registry schedules the earliest active expiry without keeping the process alive. A failed expiry write retries with bounded exponential backoff.

### Remote and UI

Workspace Controller projects recoverable entries in archive results, baselines, and `archived` stream increments. Its restore and clear requests carry `confirmed: true`. The Workspace settings plugin registers Recycle Bin after Custom Configuration, shows archive timestamps, restores one or several selected Sessions, and clears the active entries. Both actions use `RiskConfirmation`; the command is unavailable until the user acknowledges the operation.

## Alternatives considered

**Delete Session logs when clearing.** Rejected because archive metadata does not own Session persistence or source files, and released session generations remain durable records. A future destructive Session lifecycle needs its own data-ownership and confirmation decision.

**Remove archived ids when clearing.** Rejected because removing the filter would make a cleared Session visible again instead of making it permanently unavailable for application recovery.

**Keep retention only in browser state.** Rejected because browser state cannot make retention consistent across reconnects, multiple clients, and restart, nor can it share the host-owned configuration document.

## Verification

Workspace Registry tests cover legacy-state reconciliation, atomic batch restore, clear persistence across restart, default and configured expiration, and shared settings persistence. Workspace Controller model, transport, and Host tests cover the complete archive projection and stream frames. UI component tests cover individual and selected-batch restore confirmation, clear confirmation, retention submission, and slot ordering. Connection fixture tests cover the corresponding remote calls.

## Consequences

An archive is recoverable only while its entry remains active. Clearing or expiry is irreversible through the product but preserves the hidden Session and its durable history. The retained archive filter and tombstones increase registry metadata in exchange for preventing an old archive set from silently undoing a user's clear action.
