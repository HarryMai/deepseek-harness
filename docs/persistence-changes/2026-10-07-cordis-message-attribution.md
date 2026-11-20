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
## Compatibility

Existing records remain readable. The tool-cordis source identifies the producer of instruction messages. Readers preserve the message and source metadata without this plugin; the source does not control validation, replay, or authority. The message fields and Session writer version remain unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/extensions/tool-cordis/tests/arguments.spec.ts: 3 tests passed. Source-consumer review found no reader using the tool-cordis kind or form for validation, replay, or authority.

<a id="dev-note"></a>
## Dev Note

None.
