---
description: "Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。"
kind: "package-reference"
---
# Workspace Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-controller` 让 Client 通过 API 网关创建和排序 Workspace、初始化默认 Workspace、排序 Session、置顶或归档 Session、恢复活动回收站条目，并跟随 Host 状态。除非调用方请求提供方停止工作，否则归档会拒绝仍有工作运行的 Session。本包也拥有 `ctx.directoryPickerController` 和 `ctx.remote.directoryPicker`；选目录仍是抽象接缝，不是 Loader entry。

## 目录

- [使用本包](#use-this-package)
  - [首次使用工作区](#first-use-workspace)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会串行执行依赖当前注册表状态的变更，并通过带稳定错误码的 `RemoteError` 报告预期失败。它的 `follow()` 流先发送完整 baseline，再按顺序发送 `upsert`、`remove`、`order`、`archived` 和 `pinned` 增量。每个归档增量都携带完整归档集合与活动回收站条目；置顶增量携带完整置顶集合，最近置顶的 id 排在最前。重连会以替换 baseline 开始新一代。

不带 `stopActivity` 的 `archiveSession` 会以 `workspace/session-active` 拒绝仍有工作的会话，并按族（`turn`、`subagent`、`job`、`schedule`）列出工作及各项 id 和名称。带 `stopActivity: true` 时，注册表先提交归档，再请求提供方停止工作；停止请求发出后调用即返回，工作在后台收敛。已确认的恢复和清空操作管理活动回收站条目；清空或到期会使 Session 保持隐藏，且无法通过本包恢复。

Client 入口提供 `ClientWorkspaceModel` 和 `createWorkspaceStateStream()`。该模型拥有 Workspace 行、registry 顺序、归档 Session id、活动恢复条目、置顶 id、一元变更回显，以及流与一元调用的竞态处理。较新的 Host 行按 `updatedAt` 获胜；已提交的流顺序优先于较旧的一元响应；已移除的 Workspace id 不会被延迟数据复活，置顶快照仅在身份或顺序变化时更新。该包公开与框架无关的快照和订阅，把导航策略与 React 钩子留给 UI owner。`WorkspaceController.archiveSession(sessionId, { stopActivity })` 抛出携带 Host `rpcError` 的 `WorkspaceArchiveError`，界面因此可以在工作活动导致拒绝时提议停止工作。

<a id="first-use-workspace"></a>
### 首次使用工作区

`workspace.initializeDefault({ directoryName, title })` 返回持久化的默认工作区；Client service 通过 `workspaces.initializeDefault(request, signal?)` 提供同一请求。[Workspace Client](../../client/ui-workspace/README.zh.md)按启动时的语言解析这些名称。Host 将目录放在其账户的 `<Documents>/deepseek-harness` 下，远程 Web Host 也遵循此规则。目录名必须是非空的单个片段，不能含分隔符、冒号、NUL、首尾空白或末尾句点；标题不能为空。操作系统的文件名限制同样适用。Linux 系统查询要求存在 `xdg-user-dir` 且启用了 Documents 目录；不具备该条件的 Host 必须配置 `documentsDirectory` 或使用文件夹选择器。

[Workspace 注册表](../../workspace/workspace/README.zh.md#first-use-workspace)负责资格判断、目录创建和持久化初始化。已有默认工作区直接返回，不再查询 Documents；请求中的名称不会将其重命名。不满足首次使用条件时返回 `undefined`，启动流程可将目录选择留给用户。名称无效时以 `gateway/bad-request` 拒绝；查询和创建失败遵循标准 Remote 错误处理。初始化不创建 Session，也不发送消息。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `documentsDirectory` | 系统 Documents 目录 | 完全限定的 Host 目录覆盖值 |
| `documentsLookupTimeoutMs` | `10000` | 操作系统目录查询的正数最大时长，单位为毫秒 |

Documents 查询占用注册表变更队列，因此其他 Workspace 变更（包括登记已选目录）最多可能等待 `documentsLookupTimeoutMs`。取消可以停止查询；解析成功后，取消不会回滚创建或登记。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 `ctx.workspaceController` 只管理浏览器和 Host 控制状态，不注册提示词、工具或 Session 事件。

#### KV Cache 影响

无直接影响；Workspace 变更不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `follow()` 在重连后替换完整投影，不提供持久 cursor 或增量追赶协议。
- 回收站恢复只以 Host 投影为准；已清空或到期的条目保持隐藏，但不能通过此 Remote 恢复。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Workspace 注册表负责持久化，每次流生成都是完整投影。
