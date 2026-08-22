# Agent Note: 桌面打包延迟加载平台原生依赖

Status: implemented

[English](2026-08-22-desktop-packaging-platform-native-loads.md) | 中文

## 问题

打包后的 macOS 桌面应用会从 `app.asar` 启动 Electron main，但 desktop main 的导入图在任何平台分支执行前就触达了 Windows-only 原生模块。`dsh-subprocess-local` 导入 Windows 进程 inspector，`dsh-sandbox-local` 导入 Windows ACL 包；两者都有顶层 Koffi 导入。macOS 包既不随 Electron shell 携带 Koffi native addon，也不需要它，因此启动会在 window/Host 分离初始化前以 `Cannot find the native Koffi module; did you bundle it correctly?` 失败。

同一条打包路径在 macOS installer 工作之后还有两个本地重建会触发的 staging 假设：当前 `pnpm deploy` 在命令覆盖 `injectWorkspacePackages` 时会拒绝共享 lockfile，而 workspace-runtime 补拷会复制所有本地 optional dependency，包括 Linux-only Landlock 平台包；这些平台包的 `bin/` payload 在 macOS checkout 上不存在。

## 决策

Windows-only Koffi 使用现在改为懒加载。`packages/subprocess/subprocess-local/src/windows-inspector.ts` 与 `packages/sandbox/sandbox-windows-acl/src/ffi.ts` 在模块求值时只导入 Koffi 类型；实际的 Koffi `require()` 和原生类型注册只会从 Win32 绑定路径执行。POSIX 进程 inspector 和非 Windows sandbox runner 选择可以导入各自包，而不会加载 Koffi。

桌面 host-runtime deploy 步骤对临时 ordinary-Node Host 闭包使用 `pnpm deploy --legacy`。这把 pnpm 当前的共享 lockfile 限制局部化在打包脚本里，而不是改变整个 workspace 配置。补充的 workspace-runtime 闭包接收 installer 目标平台，并跳过 npm `os` 或 `cpu` 字段排除全部目标的平台包，因此 macOS 包不会尝试复制 Linux-only 平台 payload；如果未来出现 `darwin-x64` 与 `darwin-arm64` 包，多架构 macOS 构建仍可同时纳入它们。

桌面 build command 解析器会把非 JavaScript 的 `npm_execpath` 视作可直接执行的程序。这支持 `/Users/ming/Library/pnpm/pnpm` 这类原生 pnpm launcher，同时保留 `.js`、`.mjs` 与 `.cjs` launcher 通过 Node 运行的既有路径。

## 验证

回归测试将 `koffi` mock 成抛错，并证明构造 POSIX subprocess inspector、选择非 Windows sandbox runner 都不会加载它。Workspace-runtime 测试证明目标过滤会保留匹配的 `darwin` 包，并跳过 `linux` 或 `!darwin` 包。Desktop build-command 测试覆盖原生包管理器 launcher。

Koffi 路径、Windows ACL FFI 失败路径、workspace-runtime 过滤和 build-command 解析器的 focused 测试均已通过。macOS 打包脚本在 darwin-x64 host 上以 `--skip-build` 完成，产出 x64 与 arm64 DMG，并通过 x64 packaged-Host smoke test。直接启动 `apps/desktop/out/package/DeepSeek Harness-darwin-x64/DeepSeek Harness.app/Contents/MacOS/DeepSeekHarness` 八秒时没有 stderr，也没有报告 Koffi 启动错误。

## 备选方案

**把 Koffi 打进 Electron shell。** 驳回，因为 macOS shell 不应携带或加载 Windows-only 原生绑定。Windows 路径仍会在第一次需要这些绑定的操作处加载 Koffi，届时缺失 addon 会带着正确的平台上下文失败。

**保留 eager import 并依赖 optional dependency 剪裁。** 驳回，因为 Electron 会先求值打包后的 main 图，然后应用才有机会选择平台路径。即使某个 optional 原生包在 macOS 上无关，只要它被顶层导入，仍会变成 fatal 错误。

**在 workspace 配置中设置 `forceLegacyDeploy`。** 驳回，因为这个 workaround 只属于桌面打包的临时 deploy 命令及其瞬时 `injectWorkspacePackages` 覆盖。workspace-wide 设置会让所有 deploy 都走 legacy 行为，但没有证据表明其他 deploy 消费方也需要它。

**复制所有 workspace optional dependency 并忽略缺失文件。** 驳回，因为对兼容平台包来说，缺失已声明 runtime root 仍是真实打包缺陷。过滤应该在复制前移除不可能的平台包，而不是把缺失 payload 降级为警告。

## 后果

- macOS 桌面启动不再依赖 Koffi native addon，Windows-native Koffi 失败会延迟到实际使用 Windows 绑定路径时发生。
- 桌面 workspace-runtime 补拷现在遵循安装包目标集合的 npm `os` 与 `cpu` 约束，而不是构建器自己的单一 host 平台。
- 在 pnpm 的非 legacy deploy 支持这组共享 lockfile 与 `injectWorkspacePackages` 组合前，`--legacy` 会保留在桌面 deploy 命令中；移除它需要一次真实包重建验证。
- 既有 macOS 打包 note 仍然拥有 unsigned DMG 生成和跨架构打包策略；本 note 只拥有懒加载原生依赖与平台感知 runtime 闭包修复的启动和 staging 缺陷。
