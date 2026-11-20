---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-07-cordis-message-attribution

[English](2026-10-07-cordis-message-attribution.md) | 中文

## 概述

将 Cordis 指令消息的来源记录为写入方归属标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-cordis-message-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "f751b675af367b8853879c8b2f25360e09c4492547e5ca5b45d7625af6b6ad7b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "d1ba983ab53cb257cd90c80c8a844a01ab91be388ad4d6bbe459b1d464402047"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "f7268de78a1a5bcb80a60bba5c53d3a03e021ca096eea96ff760f3bbbb7433e4"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "a9df5ad244445813f4c42e51d1a39ed499ff3528ee16376921587f6b1d6c9ef0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍可读取。tool-cordis 来源标记指令消息的写入方。即使没有本插件，读取方仍保留消息及其来源元数据；来源标记不决定校验、回放或权限。消息字段和 Session 写入版本保持不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/extensions/tool-cordis/tests/arguments.spec.ts：3 个测试通过。来源使用方审查未发现读取方使用 tool-cordis 的 kind 或 form 决定校验、回放或权限。

<a id="dev-note"></a>
## 开发备注

无。
