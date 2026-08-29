# Agent Note: Classify Node Loader APIs by methods

Status: implemented

[English](2026-08-29-classify-node-loader-apis-by-methods.md) | 中文

## 问题

vendored Node Loader 适配层原先从 Node 主版本推断内部解析器接口。Node 24.9 仍暴露 `getModuleJobForImport()` 与三参数 `resolveSync(specifier, parentURL, attributes)`，但适配层却把它标为请求对象接口。客户端模块组合于是以颠倒的参数调用解析器，将产生的错误捕获为无法解析的包，并生成空的浏览器启动图。HMR 也依据同一标签选择解析器调用。

## 决策

`ModuleLoader.fromInternal()` 保留受支持 Node 版本的守卫，并按原始 Loader 的创建任务方法分类。`getOrCreateModuleJob()` 标识请求对象接口，`getModuleJobForImport()` 标识旧接口。两者都不存在的 Loader 保持不可用。既有客户端模块注册表与 HMR 解析器分支消费该标签，因此各自使用匹配的 `resolveSync()` 参数形式，无需重复版本兼容逻辑。

## 考虑过的替代方案

**保留 Node 主版本分支。**不予采用，因为 Node 发行版本号不承诺私有 Loader 的方法集。Node 24.9 已表明受支持运行时可以在版本阈值之后仍保留旧解析器。

**在每个消费方探测两种解析器签名。**不予采用，因为消费方需要先区分解析失败再决定是否重试，而共享 Loader 适配层已拥有原始内部对象及其方法词汇。

**对所有客户端模块行使用 `createRequire()`。**不予采用，因为 Loader 解析遵循所属 entry tree 与活动 ESM hooks；CommonJS 解析无法为每个已配置插件保留该选择。

## 后果

客户端模块组合会包含 Node 24.9 解析到的包，恢复浏览器 loader 所需的 bootstrap script 与 `__DSH_BOOT__` 行。HMR 对变更插件条目也会取得同一份已修正的解析器标签。node-half 回归在所属 entry tree 中创建包，并通过 `ModuleLoader.fromInternal()` 组合它；今后标签与 `resolveSync()` 签名不匹配时，测试会在 web 壳提供空图之前失败。
