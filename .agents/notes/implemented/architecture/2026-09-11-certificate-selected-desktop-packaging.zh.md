# Agent Note: Desktop package signing follows certificate availability

Status: implemented

[English](2026-09-11-certificate-selected-desktop-packaging.md) | 中文

## 问题

Desktop 打包需要在平台证书不可用时生成宿主原生安装包，同时不维护第二条准备流水线或第二套输出目录。

## 决策

所有 Desktop make 命令都将目标准备状态保留在 `apps/desktop/.desktop-build/<target>`，并将每个 electron-builder 产物写入 `apps/desktop/out`。公开的根命令为 `pnpm desktop:make:mac` 和 `pnpm desktop:make:win`；`mac` 在 macOS 构建宿主上解析为 `mac-arm64` 和 `mac-x64`，`win` 解析为 Windows x64。只有当 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` 非空时才签署 macOS 包；只有当 `DSH_DESKTOP_WINDOWS_CER_FILE` 非空时才签署 Windows 包。

当目标 Node.js 运行时不能在 macOS 构建宿主上执行时，seed 准备会通过宿主 Node.js 运行内置 pnpm，并显式选择目标操作系统和 CPU。其离线验证会继续禁用生命周期脚本，因此构建宿主不会执行目标 CPU 代码；目标运行时会在首次安装 profile 时执行这些脚本。

证书选择器缺失时，会明确禁用证书发现、签名、公证、已签名更新元数据、发布 hook 和更新部署解析。除非提供可选的反向域名形式 `DSH_DESKTOP_APP_ID` 覆盖值，否则它还会让 electron-builder 应用标识保持未设置。已选择的证书要求提供该应用标识和完整的平台签名输入。只有已签名打包会写入上传验证所需的完成记录。

## 验证

聚焦的 Desktop 测试覆盖共用输出目录、目标本地准备路径、平台命令在两种 macOS 架构上选择的两个 macOS 目标、不带应用 ID 变量的 macOS 与 Windows 未签名配置，以及由证书选择的上传资格。

## 考虑过的替代方案

- **独立的未签名命令和准备目录** — 拒绝，因为它们会重复打包流水线，并让输出位置取决于命令而不是可用证书。
- **环境中的证书自动发现** — 拒绝，因为未选择的本地证书不能悄悄将未签名构建变为已签名构建。
- **要求未签名打包提供应用 ID 变量** — 拒绝，因为它与证书选择无关，且 electron-builder 提供默认应用标识。
- **以架构命名的打包命令** — 拒绝，因为 macOS make 命令公开两个受支持的 macOS 目标，而不公开架构选择器。

## 后果

- 已签名和未签名安装包共用 `apps/desktop/out`。
- 两条 make 命令只暴露平台选择；macOS 命令创建两份架构专用的发布记录，上传元数据仍保留架构专用的目标名称。
- `DSH_DESKTOP_APP_ID` 不选择已签名或未签名路径。
- 已归档的[隔离未签名打包记录](../../archived/architecture/2026-08-17-unsigned-macos-dmg-packaging.md)只作为历史背景。
- 未签名安装包不适合更新上传，因为它们没有完成记录。
