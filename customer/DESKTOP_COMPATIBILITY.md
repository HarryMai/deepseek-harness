# Desktop 启动与兼容

个人分支保留 `pnpm desktop` 工作区启动入口。它使用现有构建产物和正常的 Harness 用户目录；`DSH_HOME` 可以覆盖默认目录。该入口与使用隔离开发数据和调试选项的 `dev:desktop` 不同。使用要求见 [Desktop 开发说明](../apps/desktop/README.md#develop)。

桌面运行还包含启动、打包后资源和跨平台依赖的兼容处理；相关入口与测试位于 [Desktop 脚本](../apps/desktop/scripts/dev.ts)、[Desktop 测试](../apps/desktop/tests/)和 [CLI Host](../apps/cli/src/desktop-host.ts)。上游已有 Desktop，合并时应逐项比较这些行为，而不是整体覆盖上游实现。

Windows 沙箱差异还包括受限进程的错误弹窗处理和可选诊断日志；见 [Windows ACL 运行器](../packages/sandbox/sandbox-windows-acl/src/runner.ts)、[错误模式](../packages/sandbox/sandbox-windows-acl/src/error-mode.ts)和[诊断日志](../packages/sandbox/sandbox-windows-acl/src/debug-log.ts)。仓库中有隐藏桌面的实现与测试，但当前运行器未接入该实现，不能把它视为已启用功能。

## 同步时的检查

Desktop 的旧 Agent Note 记录过不同的启动和打包实现；具体路径以当前代码为准。网络下载重试、发布版本对齐、子进程依赖和打包后启动检查属于该功能的维护配套，合并上游时应保留相应测试。

当前桌面 npm 入口还需核查：发布检查要求 `@deepseek-ai/dsh-desktop/lib/bin.js`，但 Desktop 包标记为私有，当前发布成员集合不包含它。不要仅根据根目录 README 推断该 npm 入口已经可用；核对 [发布成员](../scripts/release/families.ts)与[安装验证](../scripts/release/verify-packed-install.ts)。
