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
## Compatibility

Existing records remain readable. The tool-cordis source identifies the producer of instruction messages. Readers preserve the message and source metadata without this plugin; the source does not control validation, replay, or authority. The message fields and Session writer version remain unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/extensions/tool-cordis/tests/arguments.spec.ts: 3 tests passed. Source-consumer review found no reader using the tool-cordis kind or form for validation, replay, or authority.

<a id="dev-note"></a>
## Dev Note

None.
