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
    previous: "2026-09-21-user-question-reply"
    after: "57b5640cd67def99ca3051fccf6bf7e81aeb5e85525116885b770be8d2da67e4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "d131da52df515c639ce0f6ef11d0f88418ddd32815426f211e5fd2dc0fab559e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "161028cb171200c50014d3330c921f2970f359285640e93333c4eb62d3393314"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "2365aab775beda0152ffc25f0b971f6cf2f0bd89bde3ac3e6270fbbf51f67a6f"
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
