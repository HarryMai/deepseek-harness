# Agent Note: Schema-Aware Cordis Nested JSON Argument Recovery

Status: implemented

English | [中文](2026-08-23-cordis-nested-json-argument-recovery.zh.md)

## Problem

The agent-loop parses a tool call's outer argument document once. A nested field can therefore arrive as JSON text even when a Cordis Inspect method or `cordis_define` expects an object. Dynamic Inspect methods then reject the field against their provider schema, while `cordis_define` rejects it before its execution body because its selector is an exact object union.

## Decision

Keep the recovery at the Cordis boundary rather than changing generic tool parsing. `CordisInspectRegistryService` first validates the original input, then parses a string only after that validation fails, and forwards the parsed value only when it satisfies the selected method's declared schema. `cordis_define` accepts a compatibility string branch for its selector and source object, then parses and revalidates each field against its original object schema before calling the dynamic runner.

The model guidance continues to require structured objects. The compatibility path exists for a malformed call already in flight, not as an alternate normal representation. The Cordis call presenter and the browser Define card decode compatible serialized source objects only for display.

## Alternatives considered

- Recursively decode every JSON-looking string in the agent loop or `defineTool`. That would change legitimate source code, paths, and text fields before their owning tool can interpret them.
- Replace structured fields with flattened alternatives. This would duplicate Cordis schemas and weaken their relationship to provider contracts.
- Reject encoded fields without recovery. The model can correct the next call, but a valid value has already crossed the outer JSON boundary and can be recovered without weakening the declared object schema.

## Consequences

Valid string-valued Inspect methods retain their original input because original-schema validation runs first. Malformed Inspect text retains its ordinary validation error; malformed or mismatched Define text reports the field that failed. The generic validation mechanism remains strict, as established by the [runtime argument validation note](../../archived/architecture/2026-06-11-runtime-arg-validation.md).
