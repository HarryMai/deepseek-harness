---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-07-cordis-message-attribution

English | [中文](2026-10-07-cordis-message-attribution.zh.md)

## Summary

Records Cordis instruction message sources as producer attribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain readable. The tool-cordis source identifies the producer of instruction messages. Readers preserve the message and source metadata without this plugin; the source does not control validation, replay, or authority. The message fields and Session writer version remain unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/extensions/tool-cordis/tests/arguments.spec.ts: 3 tests passed. Source-consumer review found no reader using the tool-cordis kind or form for validation, replay, or authority.

<a id="dev-note"></a>
## Dev Note

None.
