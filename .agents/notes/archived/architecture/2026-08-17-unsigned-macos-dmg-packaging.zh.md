# Agent Note: macOS 桌面打包提供隔离的本地未签名 DMG

Status: implemented
Archived: 2026-09-11

[English](2026-08-17-unsigned-macos-dmg-packaging.md) | 中文

## 问题

具备发布资格的 macOS 打包需要 Developer ID 身份、匹配的 Team ID 与公证凭据。贡献者在这些凭据不可用时，也需要完整 DMG 来验证本地安装。该路径必须保留打包后的 Node.js、pnpm、离线 seed 与私有 Desktop Host，同时不能削弱或覆盖已签名发布路径。

## 决策

仓库命令 `pnpm desktop:make:mac` 委托给 `apps/desktop` 的 `make:mac` 脚本与 `scripts/package-local.ts`。它只接受 macOS 宿主，选择该宿主的 `x64` 或 `arm64` 架构，执行 `build:official`，打包当前 dsh、vendored、私有 Desktop Host 与 Landlock 包，并准备匹配的上游 Node.js、pnpm、包集合和离线 seed。运行时与 seed 准备过程会执行目标 Node.js，因此该命令是宿主原生构建器，而不是跨架构构建器。

本地准备过程拥有 `apps/desktop/.desktop-build/local/<target>/`；已签名发布准备过程继续拥有 `.desktop-build/targets/<target>/`，两者只能共享经过完整性验证的下载缓存。本地入口会从继承给子进程的环境中删除 Apple、electron-builder 证书、Windows 签名器、应用 ID 覆盖与上传凭据字段。`prepare-local-seed.ts` 使用独立的本地专用入口，在不调用发布 Mach-O 签名器的情况下，保留锁文件验证、仅生产依赖安装、离线重新安装、私有 Host 检查、pnpm store 归档与 seed 完整性清单。

`electron-builder-local.config.mjs` 要求内部本地构建选择器，并使用已提交的产品名、bundle 标识符与产物名。其 macOS 配置设置 `identity: null`、`forceCodeSigning: false`、`hardenedRuntime: false`、`notarize: false` 与 `dmg.sign: false`；它只创建 DMG，并禁用更新信息与发布。该配置不包含发布流程的签名后、产物完成、公证、上传或完成记录 hook。已签名的 `package:desktop*` 命令及其遇错即停的发布配置保持不变。

未签名 DMG 是本地验证产物，不是可分发发布。带隔离属性的副本可能需要通过 Finder 的**打开**操作启动，或在接收者确认来源后于**系统设置 → 隐私与安全性**中明确批准。发布上传无法使用本地产物，因为它既不在已签名目标目录中，也不包含经过验证的完成记录与更新元数据。

## 验证

`apps/desktop/tests/package-local.spec.ts` 覆盖宿主目标选择、pnpm 参数透传、签名器与凭据清理、本地专用配置、禁用签名与发布字段，以及发布 hook 不存在。`apps/desktop/tests/desktop-build-paths.spec.ts` 证明本地与发布可变根目录互不重叠，而经过验证的下载缓存保持共享。命令的 dry run 会走通根脚本委托、目标解析与最终 electron-builder 参数，且不写入打包状态。在 Intel macOS 宿主完整执行 `pnpm desktop:make:mac` 会生成 `apps/desktop/out/DeepSeek Harness-x64.dmg`；`hdiutil verify` 接受该镜像，而 `codesign -dv --verbose=4` 会报告 DMG 与解包后的应用均未签名。

## 曾考虑的替代方案

- **在缺少凭据时放宽发布 electron-builder 配置**——否决：发布命令必须在生成未签名或未公证产物前失败。独立配置与输出根目录让两种资格等级保持明确。
- **恢复旧的独立 Packager 与 `hdiutil` 实现**——否决：它会重复当前 electron-builder 应用布局、内嵌发布资源、seed 约束与包选择逻辑。
- **在一台宿主上构建两种 macOS 架构**——否决：seed 准备过程会执行目标 Node.js 二进制文件，并且按平台过滤的依赖会让准备后的 store 成为目标专用内容。每个架构都要在匹配的宿主执行环境中构建和验证。

## 结果

- macOS 贡献者无需 Apple 身份或公证凭据，即可构建完整的宿主原生 DMG。
- 本地与发布产物不能互相覆盖，并且本地路径无法生成具备上传资格的元数据。
- 本地 seed 保留当前打包应用的架构与离线安装行为，但明确不声明任何发布签名属性。
- [Electron 打包与更新 Agent Note](2026-08-25-electron-desktop-packaging-and-updates.zh.md) 负责已签名发布路径与对应的本地未签名 Windows 命令。
