---
description: "供用户在 DSH Web Host 中管理 MCP stdio 与 Streamable HTTP 服务器记录的自定义配置设置页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

## 概述

使用此页面可以暂存、校验、保存和测试用户自行管理的 MCP 服务器，而不必把配置写入随应用发布的组合。它位于 Settings 的模型与 Agent 预设之后，并在保存前保留草稿。只有集合总开关和该记录的开关都启用时服务器才会启动；已保存但关闭的记录仍可留待以后使用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

从 Settings 打开**自定义配置**，添加服务器记录、填写字段、保存草稿，并在需要加载时启用集合和该记录。

### 配置服务器

若要在 Host 上运行命令，选择**本地程序（stdio）**；若要连接 `http:` 或 `https:` 端点，选择 **Streamable HTTP**。本地表单包含服务器名称、命令、可增删的参数、可增删的环境变量键值对和可选工作目录；它开始时会显示一个空白参数行和一个空白环境变量行。HTTP 表单包含服务器名称和端点。页面会保留未完成的记录，但会在保存前标出不完整字段、格式错误的命令或 URL、无效环境变量条目和重复的已启用服务器名称。

### 导入并测试草稿

粘贴 `mcpServers`、`mcp_servers` 或 `servers` JSON 映射、裸映射或单条记录，即可把关闭的记录添加到当前草稿。导入绝不会启用集合，会保留 stdio `env` 映射，并拒绝 HTTP `headers`，因为页面无法编辑它们。**测试连接**会把完整的暂存记录发送到仅限环回地址的 Host 端点；该端点创建临时客户端、列出工具并关闭它，不会保存、启用、注册工具或启动重连工作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器控制器从 Host 的 `mcp-client` settings namespace 派生草稿，并通过共享 settings scope 串行化写入。Host 设置组会校验已保存记录，只把已启用且有效的记录解析为动态 `mcp-client` Loader 子项，并保留无效或关闭的记录但不加载。页面拥有本地校验和临时连接测试状态，而 Host 仍是持久化和实时加载的权威。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 设置指南](../../../MCP_SETTINGS.md)——面向用户的配置示例与运行限制。
- [mcp-client](../../mcp/mcp-client/README.zh.md)——从已保存记录加载的 Host 客户端实现。
- [ui-settings](../ui-settings/README.zh.md)——共享浏览器 settings scope 与分区注册表。
- [settings](../../settings/settings/README.zh.md)——持久化用户设置与 Host 侧存储。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响。该浏览器 settings 包只渲染暂存配置；Host 所有的 MCP 客户端负责每一项模型可见的工具注册。

#### KV Cache 影响

无直接影响。工具定义及其缓存影响由已加载的 MCP 客户端负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了页面当前的传输与机密处理覆盖范围。

- **环境变量值是普通 settings**——stdio 环境变量会按输入持久化并传给子进程。需要保护的密钥应使用受保护的凭据机制；HTTP 请求头仍需要未来的配置界面。
- **只公开 Streamable HTTP**——传统 MCP HTTP/SSE 传输不是可选记录类型。
- **本地程序由用户在 Host 上管理**——stdio 记录会直接启动其可执行文件；应用不打包 CodeGraph 或其他 MCP 程序，它们也不会经过 harness shell 工具的沙箱策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

不变式伴生项只保留包所有权。此页面把一个 settings namespace 投影为浏览器表单，不拥有可被独立观察的跨插件关系。

</details>
