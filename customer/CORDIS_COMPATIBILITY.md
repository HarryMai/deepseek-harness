# Cordis 动态工具与参数兼容

个人分支在具备 `dynamicCordisRunner` 的组合中保留会话级临时插件能力：模型可定义、运行、停止、移除和检查动态插件。Creator 预设启用这些工具，Standard 预设仅提供上游的只读 `cordis_inspect`。定义保存在当前进程内并由会话管理；浏览器部分可能需要用户授权。具体工具和限制见 [Cordis 工具说明](../packages/extensions/tool-cordis/README.md#what-the-tools-do)。

当前上游已移除这些动态工具并转向 Plugin Manager 管理持久插件。它们是需要主动维护的分支差异；同步上游时应核对上游设计、授权行为和数据兼容性，再决定是否继续保留。

Cordis 工具还接受误以 JSON 字符串形式传入的对象参数：只有解析结果通过对应 schema 校验时才恢复为结构化值，普通字符串保持原样。该行为的范围和限制见 [Cordis 工具说明](../packages/extensions/tool-cordis/README.md#use-this-package)及[参数恢复决策记录](../.agents/notes/implemented/bug-fix/2026-08-23-cordis-nested-json-argument-recovery.md)。合并时核对[工具实现](../packages/extensions/tool-cordis/src/index.ts)、[参数测试](../packages/extensions/tool-cordis/tests/arguments.spec.ts)以及 Web 和 preset 的挂载配置。
