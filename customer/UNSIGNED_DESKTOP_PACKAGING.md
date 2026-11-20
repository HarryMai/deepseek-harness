# 无证书桌面打包

桌面应用可以生成供本机测试的未签名安装包。上游已有显式未签名打包；个人分支还根据配置中的签名标识选择模式，并把最终产物放到 `apps/desktop/out/targets/<target>/`。

## 模式与配置

普通平台打包入口先读取对应的 `.env.macos`、`.env.windows` 或选定的机器 preset。macOS 的 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` 或 Windows 的 `DSH_DESKTOP_WINDOWS_CER_FILE` 非空时选择签名模式；没有对应标识时选择未签名模式。配置文件仍须能够读取，机器 preset 的签名文件读取规则见[桌面打包指南](../apps/desktop/packaging/README.md#configuration-and-local-builds)。

显式 `:unsigned` 入口强制选择未签名模式。macOS 显式未签名构建不读取 `.env.macos`，使用本地默认配置；Windows 显式未签名构建仍读取 `.env.windows` 或机器 preset。未签名构建不要求证书、应用 ID 或强制更新服务；如果配置中提供应用 ID，仍须通过校验。平台构建工具和运行环境仍是必要条件。

macOS 本地构建使用 ad-hoc 签名，不进行 Developer ID 签名或 Apple 公证。未签名产物不配置正式更新源，也不生成发布完成记录。macOS、Windows 的具体入口、平台要求和使用步骤见[桌面打包指南](../apps/desktop/packaging/README.md#unsigned-windows-test-installer)。

## 产物与维护

未签名产物位于 `apps/desktop/out/targets/<target>/unsigned-artifacts/`；正式签名和未公证产物分别使用同一目标目录下的 `artifacts/` 和 `unnotarized-artifacts/`。准备过程、缓存和日志仍位于 `.desktop-build/`，不要把准备目录当作最终产物目录。

维护时核对[打包入口](../apps/desktop/scripts/package-target.ts)、[目录解析](../apps/desktop/scripts/desktop-build-paths.mjs)、[环境读取](../apps/desktop/scripts/desktop-package-environment.mjs)和[未签名构建测试](../apps/desktop/tests/unsigned-packaging.spec.ts)。`pnpm run test:desktop:unsigned` 检查相关回归，不能代替目标系统上的实际打包和安装验证。

旧的 [macOS 打包 Agent Note](../.agents/notes/implemented/architecture/2026-08-17-unsigned-macos-dmg-packaging.md) 保留历史决策；其中早期脚本和产物路径不能作为当前操作步骤。
