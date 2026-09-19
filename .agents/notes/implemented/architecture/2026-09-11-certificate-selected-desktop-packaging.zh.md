# Agent Note: Desktop package signing follows certificate availability

Status: implemented

[English](2026-09-11-certificate-selected-desktop-packaging.md) | 中文

## 问题

Desktop 打包需要在平台证书不可用时生成宿主原生安装包，同时保持一条固定目标的准备和打包流程。

## 决策

固定目标命令将准备状态保留在 `apps/desktop/.desktop-build/targets/<target>`。`pnpm run package:desktop:mac:arm64`、`pnpm run package:desktop:mac:x64` 和 `pnpm run package:desktop:win:x64` 会显式选择目标。只有当 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` 非空时才签署 macOS 包；只有当 `DSH_DESKTOP_WINDOWS_CER_FILE` 非空时才签署 Windows 包。

当目标 Node.js 运行时不能在 macOS 构建宿主上执行时，seed 准备会通过宿主 Node.js 运行内置 pnpm，并显式选择目标操作系统和 CPU。其离线验证会继续禁用生命周期脚本，因此构建宿主不会执行目标 CPU 代码；目标运行时会在首次安装 profile 时执行这些脚本。

证书选择器缺失或设置 `DSH_DESKTOP_UNSIGNED=1` 时，会明确禁用证书发现、签名、公证、强制更新元数据、发布 hook 和更新部署解析。它会省略策略，并且除非提供可选的反向域名值，否则 electron-builder 应用标识保持未设置。`DSH_DESKTOP_UNSIGNED=0` 与已选择的证书要求提供应用标识和完整的平台签名输入。只有已签名打包会写入上传验证所需的完成记录。

## 验证

聚焦的 Desktop 测试覆盖目标本地准备路径、不带应用 ID 或策略变量的 macOS 与 Windows 未签名配置、显式未签名输出隔离，以及由证书选择的上传资格。

## 考虑过的替代方案

- **第二条未签名实现流水线** — 拒绝，因为它会重复目标准备和打包行为，而不是从发布环境选择签名。
- **环境中的证书自动发现** — 拒绝，因为未选择的本地证书不能悄悄将未签名构建变为已签名构建。
- **要求未签名打包提供应用 ID 变量** — 拒绝，因为它与证书选择无关，且 electron-builder 提供默认应用标识。
- **只按平台命名的打包命令** — 拒绝，因为运行时准备、签名和产物记录必须指向一个明确目标。

## 后果

- 已签名安装包使用各目标的 `artifacts` 目录；未签名安装包使用该目标的 `unsigned-artifacts` 目录。
- 固定目标命令公开平台和架构，发布记录保留相同的目标名称。
- `DSH_DESKTOP_APP_ID` 不选择已签名或未签名路径。
- 已归档的[隔离未签名打包记录](../../archived/architecture/2026-08-17-unsigned-macos-dmg-packaging.md)只作为历史背景。
- 未签名安装包不适合更新上传，因为它们没有完成记录。
