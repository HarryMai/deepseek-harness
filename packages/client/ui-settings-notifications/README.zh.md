---
description: "在设置-自定义配置中提供移动端消息通知推送运行时与配置面板，当前支持 Bark Server 并预留后续推送通道扩展。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-notifications

[English](README.md) | 中文

## 概述

使用此双端包可以在**设置 → 自定义配置**中管理移动端消息推送通道，并在任务需人工提权、需人工操作、发生非人为被动中断或正常完成时发送简洁提醒。第一阶段支持 Bark Server（`http:`/`https:` 服务地址与 Device Key），并通过提供方注册表预留后续安卓、鸿蒙、小米等移动端推送扩展。

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

打开**设置 → 自定义配置**，切换到**消息通知**页签，添加推送通道并填写 Bark 服务地址与 Device Key；可按需点击**测试推送**验证连通性，随后开启通道开关和总开关并点击**保存**。

### 配置推送通道与时机

页面将总开关、四类任务推送时机（需人工提权、需人工操作、任务被动中断、任务已完成）与推送通道列表分区展示。新增通道默认关闭，避免未填写完成的草稿误触发推送。**测试推送**会通过仅限环回地址的 Host RPC 端点向当前暂存字段发送单次测试通知，不会保存草稿或开启通道开关。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 侧（`CustomerNotificationsService`）在 `customer-notifications` 命名空间下注册可热更新的 Cordis 配置；以非阻塞方式观察 `approval/request` 与 `user-questions/request` 瀑布流并始终通过 `next()` 向下游委派；监听顶层会话的 `session/event`（`turn/start`、`step/start`、`turn/end`），并跳过子 Agent 会话、用户主动取消、`disposed`/`forked` 结束、空步轮次以及仍有待执行后续消息的轮次。Client 侧将配置面板注册到 `@deepseek-ai/dsh-client-ui-settings-mcp` 提供的 `settings.custom-config.item` 插槽。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [移动端消息通知说明](../../../customer/MOBILE_NOTIFICATIONS.md)——个人定制功能说明、推送时机规则与合并核对清单。
- [ui-settings-mcp](../ui-settings-mcp/README.zh.md)——承载 `settings.custom-config.item` 子页签插槽的自定义配置页面。
- [ui-settings](../ui-settings/README.zh.md)——共享浏览器配置表单与设置插槽契约。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响。本包仅在带外观察 Host 生命周期事件，不向模型请求添加工具、提示词段或会话事件。

#### KV Cache 影响

无直接影响。消息通知不会修改模型提示词、工具目录或对话历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制说明本包当前的推送提供方与凭据范围。

- **第一阶段仅内置 Bark Server**——安卓、鸿蒙、小米等移动端推送后端将在后续阶段接入 `PushProviderRegistry`。
- **Device Key 保存在 profile 配置中**——通道密钥随当前 profile 配置持久化，暂未接入系统钥匙串凭据存储。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

推送失败会在后台被隔离并通过 `ctx.logger.warn` 记录日志，不会中断 Agent 循环或阻塞瀑布流委派。

</details>
