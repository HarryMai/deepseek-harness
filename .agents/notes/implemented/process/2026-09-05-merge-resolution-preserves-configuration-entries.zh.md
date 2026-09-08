# Agent Note: 合并解决保留独立配置项

Status: implemented

[English](2026-09-05-merge-resolution-preserves-configuration-entries.md) | 中文

## 问题

即使 Loader patch 列表中的相邻新增项会按各自的 entry id 独立激活，它们仍可能落在同一个 Git 冲突块中。选择其中一个父分支的新增项，或同时遗漏两者，会让 YAML 和包依赖元数据保持有效，却使消费方在启动时等待从未挂载的提供方服务。同类解决错误还会移除直接的 TypeScript project reference：源代码 import 仍在，但构建图不再包含其所有者。

## 决策

已解决的配置或编译器 reference 冲突块保留两个父分支中的每一项非冲突新增内容。在记录包含此类冲突块的合并前，合并评审者会将合并结果与两个父分支比较，并把独立配置项视为并集；共享同一 id 或设置不兼容值的配置项仍属于需要明确作出的产品决策。

Web bundle 的 `connection` 邻域包含独立挂载的 `mcp-settings-probe`、`file-upload` 和 `ui-settings-mcp` 配置项。包依赖让它们的模块可被解析，但不会挂载 Cordis 服务。[Web roster spec](../../../../packages/bundle/web-app/tests/settings-mcp-roster.spec.ts) 断言这三个配置项全部存在，其中包括 Session Controller 所需的 `file-upload` 提供方。[已发布工具名录决策](../feature/2026-07-31-even-out-shipped-tool-rosters.zh.md)负责 MCP 设置组和探测行为，[通用文件上传决策](../feature/2026-08-26-generic-file-upload.zh.md)负责 file-upload 行为。MCP client 的直接 project reference 和公共子路径源码别名，以及 MCP 设置页面手写的源码路径别名，仍是完整包集成的一部分；[公共包子路径决策](../bug-fix/2026-09-03-public-package-subpaths.zh.md)负责子路径元组。

[增量更新 PR base 分支决策](../../archived/process/2026-07-26-incremental-pr-base-retargeting.md)继续负责合并检查点。本文负责同一检查点中独立新增项的保留与验证。

## 考虑过的替代方案

**从包依赖推断已挂载的服务。** 依赖只允许模块解析，不会创建 Loader 配置项，因此不能证明提供方服务已经激活。

**相邻新增项发生冲突时选择一个父分支的列表。** 这会在没有 TypeScript 或 YAML 错误的情况下移除有效的独立贡献，并可能将失败推迟到依赖插件激活时才暴露。

**自动并集合并中的所有冲突配置项。** 相同 id 或不兼容值需要有意的部署选择；只有在合并评审者确定新增项独立后，自动并集才适用。

## 后果

- Web profile 丢失 file-upload 提供方或任一 MCP 设置配置项时，roster specification 会失败。
- `pnpm run verify-tsconfig-paths` 验证源码别名，`pnpm run build` 验证编译器 reference 的恢复，已构建 Desktop Host snapshot 则验证被激活的 Web profile，而不只验证已解析的配置。
- 合并评审会区分可独立相加的配置项和互斥配置，保留前者，并将后者升级为需要明确决定的问题。
