---
description: "为开发和配置已安装 Harness 插件的 agent 提供只读运行时 API 查询。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

[English](README.md) | 中文

## 概述

编写插件代码前查询 Host 和 Client 的运行时 API；组合提供 runner 时，还可使用临时的动态生命周期工具。创造模式同时提供这些工具与 Plugin Manager，后者负责持久化 profile 变更。检查注册表由 Cordis host runner 提供；浏览器查询需要已连接的页面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

创造模式包含这组工具。其他组合需要在宿主组合里、提供 `cordisInspect` 的 host runner 旁挂载一次 `@deepseek-ai/dsh-tool-cordis/host`，并在每个要暴露工具的 agent preset 里挂载 `@deepseek-ai/dsh-tool-cordis`；仅有 preset 条目不会注册 Host provider。通过 [Plugin Manager](../../boot/plugin-manager/README.zh.md) 安装包含持久插件代码或 MCP 配置的组合包。

当组合还提供 `dynamicCordisRunner` 时，本插件也允许会话定义并运行临时的模型编写工具、服务或浏览器 UI，而无需将其变为仓库插件；没有该 runner 时，生命周期工具不会激活。

结构化参数仍应保持结构化：调用方将 `cordis_inspect_query.input`、`cordis_define.plugin` 和 `cordis_define.code` 作为 JSON 对象传入，而不是 JSON 文本。运行时不会改写本来就合法的普通字符串。若模型误把 Cordis 方法或 Define 字段所需的对象写成 JSON 文本，Cordis 边界只有在解码结果通过该字段精确声明的 schema 时才接受它；格式错误或不匹配的文本会报告原有校验失败，或报告该 Define 字段专属的错误。

Host 的 `Config` provider 分页列出运行中的 Loader entry（`offset`、最多 100 的 `limit`、可选的精确插件 `name`；`total` 与 `nextOffset` 界定遍历），每个 entry 带 Loader id、patch 所寻址的树内 id 及其 Config 状态（`schema`、`absent`、`unsupported`、group 与 include 载体为 `tree`、禁用、未导入或已销毁的 entry 为 `inactive`）。它把单个 entry 的原生 Config 投影为自包含的 JSON Schema 文档，并在 profile 包查找找到包目录时给出其 `packageDir`。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-cordis-host-runner'
  config:
    vmTimeoutMs: 5000
- name: '@deepseek-ai/dsh-tool-cordis/host'
- name: '@deepseek-ai/dsh-tool-cordis'
```

[Web bundle patch](../../bundle/web-app/cordis.patch.yml) 挂载 host runner 和 Host provider；[cordis preset patch](../../bundle/web-app/presets/cordis.patch.yml) 添加本工具。带浏览器半的包还额外需要客户端组合里的浏览器 runner 与 UI 包；纯 host 包则两者都不需要。

### 工具能做什么

三个检查工具只读；四个生命周期工具定义并管理临时包。所有结果都是渲染成文本的 JSON。

- `cordis_inspect_list`——列出 Inspect Provider（host 与 client）及其查询方法。
- `cordis_inspect_query`——执行一次提供方查询：精确的服务方法、事件模式、插件 Config schema、工具 schema、主题 token 或实时 slot 树。
- `cordis_inspect_self`——列出本会话的动态插件，或检查一个包的源码与运行时诊断。
- `cordis_define`——登记一个包：新插件（`plugin.kind: "new"`，配 3–6 个字母的 `idPrefix`），或既有插件的新版本（`plugin.kind: "existing"`，配其 `pluginId`）。它只校验参数与语法；不运行任何东西，也不请求审批。
- `cordis_run`——激活一个包（首次激活或重启用 `mode: "run"`，切换版本用 `mode: "update"`）。带浏览器半的包可能先返回 `awaiting-approval`，直到有人允许；工具从不等待最终结果。
- `cordis_stop`——停止当前运行并取消任何待审批请求，保留插件与全部包版本。
- `cordis_undefine`——停止并彻底移除一个插件及其全部包。

### 典型工作流

先检查、再定义、后运行：`cordis_inspect_query` 读取包要用的服务或 slot 的精确约定，`cordis_define` 记录源码，`cordis_run` 激活它。当用户输入 `@pluginId` 时，本包注入一条上下文消息，钉住所引用的插件、其基准包与更新路径。技术性失败之后，用 `cordis_inspect_self` 读取诊断，向同一插件追加修正版，再更新到该版本。

### 需要规划的边界

定义以会话为界、以进程为本：包只在定义它的会话里可见可控，可跨后续轮次保持活跃，运行时也可能影响同一进程中的其他会话。停止、移除、卸载工具集或重启 DSH 都会清除它。沙箱隔离全局变量，但不是安全边界——对待动态包要像对待 bash 访问一样慎重，加载本插件时也要像授予 bash 工具那样慎重。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host provider 结合生成的 Service/Event 目录、经 app-boot Config 投影器投影的运行中 Loader 树，以及请求 agent 的工具注册表。Client provider 通过现有检查注册表同步清单，并从已连接页面回答查询。`/host` 条目负责进程级 provider 注册，每个 preset 条目通过 Cordis effect 持有检查工具和可选的生命周期工具；注册表拒绝重复的 provider id，所以 provider 按进程注册一次。检查直接读取 provider，不维护独立运行时投影，因此不发布不变式配套插件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Plugin Manager](../../boot/plugin-manager/README.zh.md) — 持久化组合包安装和启停。
- [Cordis host runner](../cordis-host-runner/README.zh.md) — 检查注册表和现有运行时消费者。

<a id="model-experience"></a>
## 模型体验

### 运行时检查

#### 模型所见

[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-cordis) 描述检查工具和生命周期工具。prompt 段落指导模型先检查再编写，并保留 Define 字段的 JSON 文本兼容规则。在 `cordis` preset 中，首轮 skill catalog 携带随附技能的描述，把插件、MCP、组合编辑和未指定去向的视觉请求路由到对应的开发指南。查询结果包含所请求的 API 声明、当前工具 schema、带 Config 状态的运行中 entry 目录，或单个 entry 投影后的 Config JSON Schema。

#### Token 影响

插件可见时，工具 schema 和动态插件指南进入模型请求。查询结果追加到转录中；精确查询避免加载无关声明。

#### KV Cache 影响

未改变的工具 schema 和指南保持前缀稳定。查询结果追加到历史中；启用其他插件可能改变后续工具 schema。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Client 查询等待页面响应或取消。检查不能调用服务方法、配置插件或执行生成代码。
- `Config.listConfigs` 只遍历 profile 的 Loader 树。Agent preset 的 `plugins` 列表挂载在独立的 preset 树中，所以只出现在 preset 声明里的插件不会被列出，除非 profile 树也挂载了它。
- 动态包以会话为界、以进程为本。运行时可能影响同一进程中的其他会话，停止、卸载或 DSH 重启后会消失。

<a id="dev-note"></a>
### 开发备注

无。
