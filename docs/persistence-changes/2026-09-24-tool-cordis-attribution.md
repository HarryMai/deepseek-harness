---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-24-tool-cordis-attribution

English | [中文](2026-09-24-tool-cordis-attribution.zh.md)

## Summary

Qualifies Cordis context messages as attribution-only source records.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing Session format 4 messages remain readable. The new tool-cordis source kind is JSON attribution only; format 4 readers preserve unknown producer kinds and retain their content without this plugin. No validation, replay, or authority depends on the kind.

<a id="verification"></a>
## Verification

CI=true pnpm exec vitest run packages/extensions/tool-cordis/tests: 4 files and 20 tests passed. CI=true pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/message-sources.spec.ts packages/client/ui-chat/tests/chat-node-source.client.spec.ts: 2 files and 12 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
