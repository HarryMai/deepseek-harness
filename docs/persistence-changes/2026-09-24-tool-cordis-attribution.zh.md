---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-24-tool-cordis-attribution

[English](2026-09-24-tool-cordis-attribution.md) | 中文

## 概述

将 Cordis 上下文消息标记为仅用于归属的消息来源记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-24-tool-cordis-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "ecc7341523e43e5f84380aff5c317021c4f58916223e09441fe56f03bf82db6d"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "f086562b3f6192de3bd7bd3c3ca706a0f14eb450e00861f674893cfbf50bb960"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "12629e173d37576216f800bfecb28234896123e5be2cdc4230c01fcef91f5801"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "e72aafe05624c6f74ac5cba974c338983f437da2dd505e4f06a8e7a1abeb1840"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 Session format 4 消息仍可读取。新增的 tool-cordis source kind 仅携带 JSON 归属信息；format 4 读取器会保留未知生产者 kind 及其内容，无需加载本插件。该 kind 不承担校验、回放或授权职责。

<a id="verification"></a>
## 验证

CI=true pnpm exec vitest run packages/extensions/tool-cordis/tests：4 个文件、20 个测试通过。CI=true pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/message-sources.spec.ts packages/client/ui-chat/tests/chat-node-source.client.spec.ts：2 个文件、12 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
