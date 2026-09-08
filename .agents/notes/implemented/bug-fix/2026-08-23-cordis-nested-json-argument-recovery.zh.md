# Agent Note：按 schema 恢复 Cordis 嵌套 JSON 参数

Status: implemented

[English](2026-08-23-cordis-nested-json-argument-recovery.md) | 中文

## 问题

agent-loop 只解析一次工具调用最外层的参数文档。因此，即使 Cordis Inspect 方法或 `cordis_define` 需要对象，嵌套字段仍可能以 JSON 文本到达。动态 Inspect 方法随后会按 provider schema 拒绝该字段；而 `cordis_define` 的 selector 是精确对象联合，所以它会在执行主体之前被拒绝。

## 决策

将恢复逻辑保留在 Cordis 边界，而不是改变通用工具解析。`CordisInspectRegistryService` 先校验原始输入；仅当该校验失败时才尝试解析字符串，并且只有解析结果通过所选方法声明的 schema 时才转发它。`cordis_define` 为 selector 和源码对象接受兼容性字符串分支，随后在调用动态 runner 前按原对象 schema 重新解析并校验每个字段。

面向模型的指引仍要求传入结构化对象。兼容路径用于恢复已经在途的错误调用，而不是一种新的常规表示。Cordis 调用 presenter 和浏览器 Define 卡片只为显示而解码兼容的序列化源码对象。

## 考虑过的替代方案

- 在 agent loop 或 `defineTool` 中递归解码每个看似 JSON 的字符串。这会在所属工具解释它们之前改写合法的源码、路径和文本字段。
- 将结构化字段替换为扁平化的替代字段。这会复制 Cordis schema，并削弱它们与 provider 约定的关联。
- 不恢复而直接拒绝编码字段。模型能在下一次调用中纠正它，但有效值已经跨越最外层 JSON 边界，且可以在不削弱声明对象 schema 的前提下恢复。

## 后果

合法输入为字符串的 Inspect 方法会保持原始输入，因为原始 schema 校验优先执行。格式错误的 Inspect 文本保留普通校验错误；格式错误或不匹配的 Define 文本会报告失败字段。通用校验机制仍然保持严格，如[运行时参数校验 Note](../../archived/architecture/2026-06-11-runtime-arg-validation.md)所述。
