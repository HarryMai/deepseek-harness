# Agent Note: 会话回收站保留

Status: implemented

[English](2026-09-18-session-recycle-bin.md) | 中文

## 问题

归档会把 Session 从所有 Workspace 分组界面移除，却没有恢复路径。仅在浏览器中提供撤销无法跨重连和重启保持一致，而删除已归档的会话日志会违反[删除 Workspace 注册记录决策](2026-07-27-workspace-registration-deletion.zh.md)与[会话持久化决策](../architecture/2026-06-14-session-persistence.zh.md)保留的持久化归属边界。

## 决策

`WorkspaceRegistry` 保留已有归档过滤，并为每个已归档 Session 记录带时间戳的可恢复条目。`restoreArchivedSessions()` 会在一次持久写入前校验全部请求条目，再移除归档过滤和全部所选条目，因此批量操作不会只恢复其中一部分。`clearRecycleBin()` 移除恢复条目但保留其归档 id；到期条目遵循同一规则。两项操作都不删除 Session 日志、文件系统数据或 Workspace 记账。

### 持久记录

`workspace` 领域状态包含 `archivedSessionIds`、`recycleBinEntries` 和 `clearedArchivedSessionIds`。启动时，旧归档 id 会变为可恢复条目，除非已清空 id 墓碑记录其恢复资格已被移除。墓碑在保留归档过滤的同时，防止已到期或已清空的条目在重启后重新出现。

### 设置与保留期

可选的 `@deepseek-ai/dsh-settings` seam 安装带正整数日 `retentionDays` 字段的 `workspace-recycle-bin` namespace，默认值为 30。由 `@deepseek-ai/dsh-settings-file` 提供该 seam 时，它会在[配置来源归属决策](../architecture/2026-08-04-configuration-source-ownership.zh.md)下与 MCP 共用 `$DSH_HOME/settings.yaml` 文档。设置变更会立刻重新计算到期时间，注册表只安排最早的活动到期时间，且不会阻止进程退出。到期写入失败会以有上限的指数退避重试。

### Remote 与 UI

Workspace Controller 会在归档结果、baseline 和 `archived` 流增量中投影可恢复条目。它的恢复和清空请求都带有 `confirmed: true`。Workspace 设置插件将回收站注册在自定义配置之后，显示归档时间，恢复单个或多个所选 Session，并清空活动条目。两项操作都使用 `RiskConfirmation`；用户确认操作前，命令不可用。

## 考虑过的替代方案

**清空时删除 Session 日志。** 未采用，因为归档元数据不拥有 Session 持久化或源文件，已发布的会话代际仍是持久记录。未来破坏性的 Session 生命周期需要独立的数据归属和确认决策。

**清空时移除已归档 id。** 未采用，因为移除过滤会让已清空的 Session 再次可见，而不是令其永久无法通过应用恢复。

**只在浏览器状态保留保留期。** 未采用，因为浏览器状态无法在重连、多客户端和重启之间保持保留期一致，也不能共享 Host 所有的配置文档。

## 验证

Workspace Registry 测试覆盖旧状态协调、原子批量恢复、跨重启保留清空结果、默认和配置后的到期，以及共享设置持久化。Workspace Controller 的 model、transport 和 Host 测试覆盖完整归档投影和流帧。UI 组件测试覆盖单条和所选批量恢复确认、清空确认、保留期提交及 slot 排序。连接夹具测试覆盖对应的 Remote 调用。

## 影响

归档只会在其条目仍处于活动状态时可恢复。清空或到期在产品内不可逆，但保留隐藏的 Session 与其持久历史。保留归档过滤和墓碑会增加注册表元数据，以避免旧归档集合悄然撤销用户的清空操作。
