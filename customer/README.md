# Personal customizations

English | [中文](README.zh.md)

This directory records the features the personal branch retains relative to `upstream/master` and the areas to check when merging upstream. Each implementation remains owned by its code and package documentation; this directory contains no accounts, secrets, or machine-specific configuration.

## Feature index

| Feature | Description | Relationship to upstream |
| --- | --- | --- |
| [MCP settings](MCP_SETTINGS.md) | Manage, import, and test MCP servers in Settings. | Upstream already has an MCP client; this branch adds settings and dynamic management. |
| [MCP test route troubleshooting](MCP_SETTINGS_ROUTE_INCIDENT.md) | Diagnose connection tests, route mounting, and local program working directories. | A troubleshooting record for MCP settings. |
| [Certificate-free Desktop packaging](UNSIGNED_DESKTOP_PACKAGING.md) | Local builds without certificates, signing mode selection, and artifact directories. | Upstream already has explicit unsigned builds; this branch extends mode selection and output locations. |
| [Desktop startup and compatibility](DESKTOP_COMPATIBILITY.md) | Launch Desktop from existing workspace artifacts and maintain related compatibility fixes. | Upstream already has Desktop; this note records this branch's differences. |
| [Model request compatibility settings](MODEL_REQUEST_COMPATIBILITY.md) | Adjust request compatibility for a custom model provider in Settings. | Upstream already has underlying compatibility configuration; this branch adds UI controls. |
| [Cordis dynamic tools and argument compatibility](CORDIS_COMPATIBILITY.md) | Retain temporary dynamic plugin tools and recover JSON-string arguments that satisfy the schema. | Upstream moved to Plugin Manager; assess whether to retain this behavior during merges. |
| [Branch Agent Notes](BRANCH_AGENT_NOTES.md) | Find the branch's existing decision records. | Some records describe earlier or shared behavior, not current branch-only features. |

## Syncing upstream

The comparison on 2026-11-18 used the local `upstream/master` and `personal/feature-2026-10-03` references; that upstream commit is an ancestor of the personal branch. After updating the upstream reference, compare the branches and each feature's implementation, tests, and documentation, then update this directory. When upstream provides an equivalent capability, check configuration, data compatibility, and user behavior before deciding whether to keep the personal implementation.

The repository's formal Agent Notes, package READMEs, and generated documentation remain in their repository-defined locations; they can describe general decisions or older implementations and are not a current list of personal features. The relevant feature notes link to decisions about personal differences.
