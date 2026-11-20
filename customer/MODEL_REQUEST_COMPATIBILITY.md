# 模型请求兼容性设置

自定义模型供应商可以在设置页面调整网关请求的兼容选项，无需仅依赖手工编辑配置。上游已有底层 `compat` 配置；个人分支把部分选项加入创建和编辑供应商的界面。

OpenAI Chat Completions 支持设置 `supportsDeveloperRole` 和输出 token 参数字段；OpenAI Responses 只显示前者；Anthropic Messages 不显示这组控件。选择自动会移除对应的用户覆盖，恢复继承配置或适配器检测；保存时保留其他兼容字段和模型级覆盖。

使用说明见[模型供应商指南](../docs/user/guide/providers.md#request-compatibility)。合并时核对[界面控件](../packages/client/ui-settings-models/src/client/RequestCompatibility.tsx)及[供应商表单测试](../packages/client/ui-settings-models/tests/provider-form.client.spec.tsx)，避免上游相同功能出现后产生两套冲突配置。
