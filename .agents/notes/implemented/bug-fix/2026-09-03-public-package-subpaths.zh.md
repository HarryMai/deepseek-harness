# Agent Note：公开包子路径保持完整集成

状态：已实现

[English](2026-09-03-public-package-subpaths.md) | 中文

## 问题

配置文件或应用程序可能导入某个既未由包 manifest（元数据清单）导出、也未被 TypeScript 源码图表示的包子路径。源码模块及其 tsdown 条目仍可能存在，因此不完整的集成能通过本地源码检查，但受支持的配置文件会在 Node 包解析器下失败，或者 `tsc` 以导入不在项目图中为由拒绝它。

MCP 客户端的 settings 与 probe 模块、CLI 的 desktop-host 模块、以及 local-subprocess 的 process-inspector 模块都是受支持的公开子路径。已删除的 MCP invariant 伴随模块不是受支持的公开子路径。

## 决定

### 公开子路径的完整组成

每个公开子路径在两个构建平面上都是一个整体：其源码模块、TypeScript `paths` 映射、TypeScript 项目引用与直接开发依赖、tsdown 产物条目、包 `exports` 以及发布 `files` 条目必须一同变更。仅类型的工作区导入仍是直接 `devDependency` 与项目引用；不能只因公开声明提及其类型，就把它变为运行时 peer。

以下公开导入保持为完整组成：`@deepseek-ai/dsh-mcp-client/settings`、`@deepseek-ai/dsh-mcp-client/probe`、`@deepseek-ai/dsh/desktop-host` 与 `@deepseek-ai/dsh-subprocess-local/process-inspector`。源码平面的路径映射让静态检查解析工作区源码；产物平面的导出让普通 Node 解析已构建的输出。

### MCP settings 集成

`dsh-mcp-client/settings` 注入 Settings 服务后调用 `ctx.settings.installSection`。Settings 包拥有此操作；MCP 包不重建已移除的包级 helper 导出。

### 不保留 invariant

MCP 客户端不保留 `./invariant` 导出、文件条目、构建条目或项目引用。原样恢复无关元数据会违背[invariant 伴随模块笔记](../simplification/2026-08-28-omit-unneeded-invariant-companions.zh.md)记录的刻意省略。

## 测试

聚焦的 MCP 与 host-runner 套件通过了 7 个测试，聚焦的 desktop 与 CLI 套件通过了 12 个测试。`pnpm run build` 完成全部 Host、Client 和 Web 产物。普通 Node 已成功导入四个构建后的公开子路径。`pnpm dsh web --no-open --host 127.0.0.1 --port 0` 已到达就绪 URL；验证后的进程随后被有意停止。

## 曾考虑的替代方案

**不变地恢复重构前的元数据。** 否决：这会重新引入刻意移除的 invariant 公开表面与过时的 Settings helper API。

**把消费者改指向源码文件或包根导出。** 否决：配置文件与 desktop 代码使用这些特定公开子路径，已发布包必须在没有工作区路径别名时从构建产物解析它们。

**不声明公开类型导入。** 否决：源码构建可能继承工作区图，但包元数据仍必须声明仅类型的开发关系和 TypeScript 项目图。

## 后果

合并与重构评审把公开子路径视为原子集成，而不是单个源码文件。冲突保留源码模块或 bundle 条目时，评审者会在接受结果前核对对应的 manifest、源码图与构建产物条目。聚焦的模块加载测试、完整构建和配置文件启动冒烟测试覆盖了不同的失败模式。
