---
description: "为开发和配置已安装 Harness 插件的 agent 提供只读运行时 API 查询。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

[English](README.md) | 中文

## 概述

编写插件代码前查询 Host 和 Client 的运行时 API。创造模式同时提供这些只读工具与 Plugin Manager，后者负责持久化 profile 变更。检查注册表由 Cordis host runner 提供；浏览器查询需要已连接的页面。

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

创造模式包含这组工具。其他组合需要同时挂载 `@deepseek-ai/dsh-tool-cordis` 和提供 `cordisInspect` 的 host runner；通过 [Plugin Manager](../../boot/plugin-manager/README.zh.md) 安装包含持久插件代码或 MCP 配置的组合包。

当组合还提供 `dynamicCordisRunner` 时，本插件也允许会话定义并运行临时的模型编写工具、服务或浏览器 UI，而无需将其变为仓库插件；没有该 runner 时，生命周期工具不会激活。

结构化参数仍应保持结构化：调用方将 `cordis_inspect_query.input`、`cordis_define.plugin` 和 `cordis_define.code` 作为 JSON 对象传入，而不是 JSON 文本。运行时不会改写本来就合法的普通字符串。若模型误把 Cordis 方法或 Define 字段所需的对象写成 JSON 文本，Cordis 边界只有在解码结果通过该字段精确声明的 schema 时才接受它；格式错误或不匹配的文本会报告原有校验失败，或报告该 Define 字段专属的错误。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-cordis-host-runner'
  config:
    vmTimeoutMs: 5000
- name: '@deepseek-ai/dsh-tool-cordis'
```

[Web bundle patch](../../bundle/web-app/cordis.patch.yml) 挂载 host runner，[Creator preset](../../preset/agent-presets/presets/cordis/agent.cordis.yml) 添加本工具。带浏览器半的包还额外需要客户端组合里的浏览器 runner 与 UI 包；纯 host 包则两者都不需要。

### 工具能做什么

三个检查工具只读；四个生命周期工具定义并管理包。所有结果都是渲染成文本的 JSON。

- `cordis_inspect_list`——列出 Inspect Provider（host 与 client）及其查询方法。
- `cordis_inspect_query`——执行一次提供方查询：精确的服务方法、事件模式、builtin 签名、工具 schema、主题 token 或实时 slot 树。
- `cordis_inspect_self`——本会话的动态插件：版本指针、最近一次运行，以及（对某个精确包而言）源码与运行时诊断。
- `cordis_define`——登记一个包：新插件（`plugin.kind: "new"`，配 3–6 个字母的 `idPrefix`），或既有插件的新版本（`plugin.kind: "existing"`，配其 `pluginId`）。它只校验参数与语法；不运行任何东西，也不请求审批。
- `cordis_run`——激活一个包（首次激活或重启用 `mode: "run"`，切换版本用 `mode: "update"`）。带浏览器半的包可能先返回 `awaiting-approval`，直到有人允许；工具从不等待最终结果。
- `cordis_stop`——停止当前运行并取消任何待审批请求，保留插件与全部包版本。
- `cordis_undefine`——停止并彻底移除一个插件及其全部包。

### 典型工作流

先检查、再定义、后运行：`cordis_inspect_query` 读取包要用的服务或 slot 的精确约定，`cordis_define` 记录源码（会话里会出现一张 define 卡片，指向存放运行控件的面板），`cordis_run` 激活它。当用户输入 `@pluginId` 时，本包注入一条上下文消息，钉住所引用的插件、其基准包与更新路径。技术性失败之后，用 `cordis_inspect_self` 读取诊断，向同一插件追加修正版，再更新到该版本。

### 需要规划的边界

定义以会话为界、以进程为本：包只在定义它的会话里可见可控，可跨后续轮次保持活跃，运行时也可能影响同一进程中的其他会话。停止、移除、卸载工具集或重启 DSH 都会清除它。沙箱隔离全局变量，但不是安全边界——对待动态包要像对待 bash 访问一样，加载本插件时也要像授予 bash 工具那样慎重。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host provider 结合生成的 Service/Event 目录与请求 agent 的工具注册表。Client provider 通过现有检查注册表同步清单，并从已连接页面回答查询。工具插件通过 Cordis effect 持有注册；释放时移除工具和提示词贡献。检查直接读取 provider，不维护独立运行时投影，因此不发布不变式配套插件。

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

[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-cordis) 描述两个只读检查工具。[提示词](src/prompt.ts) 指引模型通过 Plugin Manager 进行持久化变更并说明 MCP 设置方式。创造模式的视觉请求默认通过已安装的 UI 插件显示在当前 Web 页面；开发技能说明 Client 打包和 slot 注册方法。查询结果包含所请求的 API 声明或当前工具 schema。

#### Token 影响

插件可见时，两个工具 schema 和指导段落进入模型请求。查询结果追加到转录中；精确查询避免加载无关声明。

#### KV Cache 影响

未改变的 schema 和指导保持前缀稳定。查询结果追加到历史中；启用其他插件可能改变后续工具 schema。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Client 查询等待页面响应或取消。检查不能调用服务方法、配置插件或执行生成代码。

<a id="dev-note"></a>
### 开发备注

无。
