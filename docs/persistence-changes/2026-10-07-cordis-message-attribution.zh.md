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
    previous: "2026-10-13-user-rpc-principal"
    after: "25f6407d8af1cb41716b67a97ed83ac72bfd5dee90140b28a5e968cc9da2f104"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "c8d2384b841a9d20882f3e66be1c190a45c07efbe63789d6cdea9559e74d7424"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "cd1b4dcefb42e445d16ce3124b0ccd5fb6b5376a9c939b234b658b2e5ca38a5f"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "02e259b61aae75ab3190f4fd45310282b45d87c3f3e928a401cdc022212ae1d0"
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
